import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, opendir, rename, rm, rmdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { types as utilTypes } from "node:util";
import {
  OBSERVER_RESOURCE_LIMITS,
  ObserverError,
  clonePlainData,
  readBoundedRegularFile,
  sha256,
  stableStringify,
  validateReceipt,
} from "./contracts.mjs";
import { validateReceiptSchema } from "./receipt-schema.mjs";

const reservationWaitMilliseconds = 10_000;
const reservationPollMilliseconds = 10;
const pointerVerificationAttempts = 16;
const admittedFailureDetailFields = Object.freeze([
  "stage",
  "checkpoint",
  "boundary",
  "reason",
  "restartFrom",
  "restartAt",
  "action",
  "acceptedCoordinate",
]);

function contained(root, candidate) {
  const absoluteRoot = resolve(root);
  const absoluteCandidate = resolve(root, candidate);
  if (absoluteCandidate !== absoluteRoot && !absoluteCandidate.startsWith(`${absoluteRoot}${sep}`)) {
    throw new ObserverError("PATH_ESCAPE", "Publication path must remain inside the receipt root.", { candidate, restartFrom: "candidate" });
  }
  return absoluteCandidate;
}

function publicationRecoveryCoordinate(boundary) {
  if (
    boundary === "temporary_pointer"
    || boundary === "accepted_pointer"
    || boundary === "pointer_reservation"
  ) return "pointer";
  if (boundary === "accepted_destination" || boundary.startsWith("accepted_file.")) {
    return "accepted_coordinate_recovery";
  }
  if (
    boundary === "candidate"
    || boundary === "destination_reservation"
    || boundary.startsWith("candidate_")
  ) return "candidate";
  return "publication_root";
}

function publicationBoundaryError(boundary, reason, acceptedCoordinate = null) {
  const restartFrom = publicationRecoveryCoordinate(boundary);
  return new ObserverError(
    "PUBLICATION_BOUNDARY_INVALID",
    "Receipt publication requires a stable, directly addressed ownership boundary.",
    {
      boundary,
      reason,
      restartFrom,
      ...(restartFrom === "accepted_coordinate_recovery"
        ? { action: "inspect_or_quarantine", acceptedCoordinate }
        : {}),
    },
  );
}

function acceptedIntegrityMismatch(message, acceptedCoordinate, details = {}) {
  return new ObserverError("ACCEPTED_INTEGRITY_MISMATCH", message, {
    restartFrom: "accepted_coordinate_recovery",
    action: "inspect_or_quarantine",
    acceptedCoordinate,
    ...details,
  });
}

function ownDataValue(value, key) {
  if (
    value === null
    || (typeof value !== "object" && typeof value !== "function")
    || utilTypes.isProxy(value)
  ) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function boundedOwnString(value, key, fallback, maxBytes = 512) {
  const candidate = ownDataValue(value, key);
  return typeof candidate === "string"
    && candidate.length > 0
    && candidate.length <= maxBytes
    && Buffer.byteLength(candidate, "utf8") <= maxBytes
    ? candidate
    : fallback;
}

function admittedFailureDetails(error) {
  const details = ownDataValue(error, "details");
  if (details === null || typeof details !== "object" || utilTypes.isProxy(details)) {
    return Object.freeze({});
  }
  try {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(details))) return Object.freeze({});
  } catch {
    return Object.freeze({});
  }
  const admitted = {};
  for (const key of admittedFailureDetailFields) {
    const value = boundedOwnString(details, key, null, 1_024);
    if (value !== null) admitted[key] = value;
  }
  return Object.freeze(admitted);
}

function admittedObserverErrorDetails(error) {
  const details = ownDataValue(error, "details");
  let snapshot;
  try {
    snapshot = clonePlainData(details, {
      boundary: "publication_failure.details",
      restartFrom: "caller_boundary",
    });
  } catch {
    return null;
  }
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;

  // clonePlainData already owns topology, depth, and node count. Bound the
  // remaining string allocation before the snapshot crosses publication.
  const pending = [snapshot];
  let stringBytes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "string") {
      stringBytes += Buffer.byteLength(current, "utf8");
    } else if (Array.isArray(current)) {
      pending.push(...current);
    } else if (current && typeof current === "object") {
      for (const [key, value] of Object.entries(current)) {
        stringBytes += Buffer.byteLength(key, "utf8");
        pending.push(value);
      }
    }
    if (stringBytes > OBSERVER_RESOURCE_LIMITS.proseBytes * 2) return null;
  }
  return snapshot;
}

function admittedObserverError(error) {
  if (
    error === null
    || (typeof error !== "object" && typeof error !== "function")
    || utilTypes.isProxy(error)
  ) return null;
  try {
    if (Object.getPrototypeOf(error) !== ObserverError.prototype) return null;
  } catch {
    return null;
  }
  const code = boundedOwnString(error, "code", null);
  const message = boundedOwnString(error, "message", null, 4_096);
  const details = admittedObserverErrorDetails(error);
  if (code === null || message === null || details === null) return null;
  return Object.freeze({ code, message, details });
}

function boundedFailureContext(error, fallbackCode, fallbackBoundary) {
  const details = ownDataValue(error, "details");
  return Object.freeze({
    code: boundedOwnString(error, "code", fallbackCode),
    boundary: boundedOwnString(details, "boundary", fallbackBoundary),
    recovery: boundedOwnString(details, "restartFrom", "accepted_coordinate_recovery"),
  });
}

function retainReservationCleanupFailure(primaryError, cleanupError, acceptedCoordinate, {
  checkpoint = "destination_reservation_release",
  cleanupBoundary = "destination_reservation",
} = {}) {
  const cleanupFailure = boundedFailureContext(
    cleanupError,
    "PUBLICATION_RESERVATION_RELEASE_FAILED",
    cleanupBoundary,
  );
  const admittedPrimary = admittedObserverError(primaryError);
  if (admittedPrimary) {
    const retained = new ObserverError(admittedPrimary.code, admittedPrimary.message, {
      ...admittedPrimary.details,
      checkpoint,
      restartFrom: "accepted_coordinate_recovery",
      action: "inspect_or_quarantine",
      acceptedCoordinate,
      cleanupFailure,
    });
    return retained;
  }
  const retained = new ObserverError(
    "PUBLICATION_FAILED",
    "Receipt publication stopped, and its publication reservation requires inspection.",
    {
      checkpoint,
      restartFrom: "accepted_coordinate_recovery",
      action: "inspect_or_quarantine",
      acceptedCoordinate,
      primaryFailure: boundedFailureContext(primaryError, "PUBLICATION_FAILED", "publication"),
      cleanupFailure,
    },
  );
  return retained;
}

async function tightenPrivateDirectoryMode(path, boundary, expectedEntry, mode) {
  let handle;
  let primaryError = null;
  try {
    const flags = fsConstants.O_RDONLY
      | (fsConstants.O_DIRECTORY ?? 0)
      | (fsConstants.O_NOFOLLOW ?? 0);
    handle = await open(path, flags);
    const openedEntry = await handle.stat();
    if (
      !openedEntry.isDirectory()
      || openedEntry.dev !== expectedEntry.dev
      || openedEntry.ino !== expectedEntry.ino
    ) {
      throw publicationBoundaryError(boundary, "directory_identity_changed_before_mode_update");
    }
    await handle.chmod(mode);
    const settledEntry = await handle.stat();
    if (
      !settledEntry.isDirectory()
      || settledEntry.dev !== expectedEntry.dev
      || settledEntry.ino !== expectedEntry.ino
      || (settledEntry.mode & 0o077) !== 0
    ) {
      throw publicationBoundaryError(boundary, "private_directory_mode_update_failed");
    }
  } catch (error) {
    primaryError = error instanceof ObserverError
      ? error
      : publicationBoundaryError(boundary, error.code ?? "private_directory_mode_update_failed");
    throw primaryError;
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch (error) {
        if (primaryError === null) {
          throw publicationBoundaryError(boundary, error.code ?? "directory_close_failed");
        }
      }
    }
  }

  let pathEntry;
  try {
    pathEntry = await lstat(path);
  } catch (error) {
    throw publicationBoundaryError(boundary, error.code ?? "unreadable_after_mode_update");
  }
  if (
    !pathEntry.isDirectory()
    || pathEntry.isSymbolicLink()
    || pathEntry.dev !== expectedEntry.dev
    || pathEntry.ino !== expectedEntry.ino
    || (pathEntry.mode & 0o077) !== 0
  ) {
    throw publicationBoundaryError(boundary, "directory_identity_changed_after_mode_update");
  }
  return pathEntry;
}

async function requireRegularDirectory(path, boundary, {
  create = false,
  mode = 0o755,
  privateMode = false,
  acceptedCoordinate = null,
} = {}) {
  if (create) {
    try {
      await mkdir(path, { mode });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  let entry;
  try {
    entry = await lstat(path);
  } catch (error) {
    throw publicationBoundaryError(boundary, error.code ?? "unreadable", acceptedCoordinate);
  }
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw publicationBoundaryError(boundary, "regular_directory_required", acceptedCoordinate);
  }
  if (privateMode && (entry.mode & 0o077) !== 0) {
    if (!create) throw publicationBoundaryError(boundary, "private_directory_required");
    // Earlier observer versions created this durable parent with the process
    // default mode. Tighten the captured directory in place so an existing
    // receipt workspace can resume under the stronger publication contract.
    entry = await tightenPrivateDirectoryMode(path, boundary, entry, mode);
  }
  return { path, boundary, dev: entry.dev, ino: entry.ino, privateMode, acceptedCoordinate };
}

async function assertDirectoryIdentity(identity) {
  if (identity.ancestors) {
    await assertDirectoryIdentities(identity.ancestors);
  }
  let entry;
  try {
    entry = await lstat(identity.path);
  } catch (error) {
    throw publicationBoundaryError(identity.boundary, error.code ?? "unreadable", identity.acceptedCoordinate);
  }
  if (
    !entry.isDirectory()
    || entry.isSymbolicLink()
    || entry.dev !== identity.dev
    || entry.ino !== identity.ino
    || (identity.privateMode && (entry.mode & 0o077) !== 0)
  ) {
    throw publicationBoundaryError(identity.boundary, "directory_identity_changed", identity.acceptedCoordinate);
  }
}

async function provisionPublicationRoot(ownerRoot, publicationRoot, injectFault) {
  const absoluteOwner = resolve(ownerRoot);
  const absoluteRoot = resolve(publicationRoot);
  const pathFromOwner = relative(absoluteOwner, absoluteRoot);
  if (
    pathFromOwner === ".."
    || pathFromOwner.startsWith(`..${sep}`)
    || isAbsolute(pathFromOwner)
  ) {
    throw publicationBoundaryError("root", "path_outside_owner");
  }

  const segments = pathFromOwner.split(sep).filter(Boolean);
  if (segments.length > 64) {
    throw publicationBoundaryError("root", "path_depth_exceeded");
  }

  const identities = [await requireRegularDirectory(absoluteOwner, "root_owner")];
  await invokeFaultHook(injectFault, "after_publication_owner_capture", {
    ownerRoot: absoluteOwner,
    root: absoluteRoot,
  });
  await assertDirectoryIdentities(identities);

  if (segments.length === 0) {
    return { ...identities[0], boundary: "root", ancestors: [] };
  }

  let current = absoluteOwner;
  for (let index = 0; index < segments.length; index += 1) {
    current = resolve(current, segments[index]);
    await assertDirectoryIdentities(identities);
    let created = false;
    try {
      await mkdir(current, { mode: 0o700 });
      created = true;
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw publicationBoundaryError("root", error.code ?? "create_failed");
      }
    }
    const relativeDirectory = relative(absoluteOwner, current).split(sep).join("/");
    const isPublicationRoot = index === segments.length - 1;
    const identity = await requireRegularDirectory(
      current,
      isPublicationRoot ? "root" : `root_ancestor.${relativeDirectory}`,
      { privateMode: created },
    );
    identities.push(identity);
    await invokeFaultHook(injectFault, "after_publication_directory_capture", {
      ownerRoot: absoluteOwner,
      root: absoluteRoot,
      directoryPath: current,
      relativeDirectory,
      isPublicationRoot,
    });
    await assertDirectoryIdentities(identities);
  }

  const rootIdentity = identities.at(-1);
  return { ...rootIdentity, ancestors: identities.slice(0, -1) };
}

async function assertDirectoryIdentities(identities) {
  for (const identity of identities) await assertDirectoryIdentity(identity);
}

async function requireRegularFileIdentity(path, boundary, acceptedCoordinate = null) {
  let entry;
  try {
    entry = await lstat(path);
  } catch (error) {
    throw publicationBoundaryError(boundary, error.code ?? "unreadable", acceptedCoordinate);
  }
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw publicationBoundaryError(boundary, "regular_file_required", acceptedCoordinate);
  }
  return { path, boundary, dev: entry.dev, ino: entry.ino, acceptedCoordinate };
}

async function assertFileIdentity(identity) {
  let entry;
  try {
    entry = await lstat(identity.path);
  } catch (error) {
    throw publicationBoundaryError(identity.boundary, error.code ?? "unreadable", identity.acceptedCoordinate);
  }
  if (
    !entry.isFile()
    || entry.isSymbolicLink()
    || entry.dev !== identity.dev
    || entry.ino !== identity.ino
  ) {
    throw publicationBoundaryError(identity.boundary, "file_identity_changed", identity.acceptedCoordinate);
  }
}

async function assertFileIdentities(identities) {
  for (const identity of identities) await assertFileIdentity(identity);
}

async function createOwnedDirectory(path, boundary, owners, { mode = 0o700 } = {}) {
  await assertDirectoryIdentities(owners);
  await mkdir(path, { mode });
  const identity = await requireRegularDirectory(path, boundary, {
    privateMode: (mode & 0o077) === 0,
  });
  await assertDirectoryIdentities(owners);
  await assertDirectoryIdentity(identity);
  return identity;
}

async function createOwnedFile(path, boundary, bytes, owners, {
  mode = 0o600,
  identities = null,
} = {}) {
  const payload = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  await assertDirectoryIdentities(owners);
  let handle;
  let identity = null;
  let primaryError = null;
  try {
    const flags = fsConstants.O_WRONLY
      | fsConstants.O_CREAT
      | fsConstants.O_EXCL
      | (fsConstants.O_NOFOLLOW ?? 0);
    handle = await open(path, flags, mode);
    const entry = await handle.stat();
    if (!entry.isFile()) throw publicationBoundaryError(boundary, "regular_file_required");
    identity = { path, boundary, dev: entry.dev, ino: entry.ino };
    identities?.push(identity);
    await handle.writeFile(payload);
    await handle.sync();
    const settledEntry = await handle.stat();
    if (
      !settledEntry.isFile()
      || settledEntry.dev !== identity.dev
      || settledEntry.ino !== identity.ino
      || settledEntry.size !== payload.byteLength
    ) {
      throw publicationBoundaryError(boundary, "file_identity_changed_during_write");
    }
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch (error) {
        if (primaryError === null) {
          throw new ObserverError(
            "PUBLICATION_FILE_CLOSE_FAILED",
            "Receipt publication requires operator recovery after closing a staged file.",
            { boundary, reason: error.message, restartFrom: "candidate" },
          );
        }
      }
    }
  }
  await assertDirectoryIdentities(owners);
  await assertFileIdentity(identity);
  return identity;
}

async function assertOwnedFileBytes(identity, expectedBytes, owners, restartFrom = "candidate") {
  await assertDirectoryIdentities(owners);
  await assertFileIdentity(identity);
  let observed;
  try {
    observed = await readBoundedRegularFile(identity.path, {
      boundary: identity.boundary,
      maxBytes: expectedBytes.byteLength,
      expectedBytes: expectedBytes.byteLength,
      restartFrom,
    });
  } catch (error) {
    if (error instanceof ObserverError && error.code === "PUBLICATION_BOUNDARY_INVALID") throw error;
    throw publicationBoundaryError(
      identity.boundary,
      error.code ?? "file_bytes_unreadable",
      identity.acceptedCoordinate,
    );
  }
  if (!observed.equals(expectedBytes)) {
    throw publicationBoundaryError(identity.boundary, "file_bytes_changed", identity.acceptedCoordinate);
  }
  await assertDirectoryIdentities(owners);
  await assertFileIdentity(identity);
}

async function invokeFaultHook(injectFault, checkpoint, coordinates) {
  if (typeof injectFault === "function") {
    await injectFault({ checkpoint, ...coordinates });
  }
}

async function removeOwnedFile(identity, owners, { strict = false } = {}) {
  if (!identity) return true;
  try {
    await assertDirectoryIdentities(owners);
    await assertFileIdentity(identity);
    await rm(identity.path);
    return true;
  } catch (error) {
    if (strict) throw error;
    return false;
  }
}

async function releaseDestinationReservation(identity, owners, acceptedCoordinate) {
  if (!identity) return;
  try {
    await removeOwnedFile(identity, owners, { strict: true });
  } catch (error) {
    throw new ObserverError(
      "PUBLICATION_RESERVATION_RELEASE_FAILED",
      "The digest reservation remains available for inspection before pointer promotion resumes.",
      {
        checkpoint: "destination_reservation_release",
        restartFrom: "accepted_coordinate_recovery",
        action: "inspect_or_quarantine",
        acceptedCoordinate,
        failure: boundedFailureContext(error, "RESERVATION_RELEASE_FAILED", "destination_reservation"),
      },
    );
  }
}

async function removeOwnedTree(rootIdentity, owners, directoryIdentities, fileIdentities, { strict = false } = {}) {
  if (!rootIdentity) return true;
  try {
    await assertDirectoryIdentities(owners);
    await assertDirectoryIdentity(rootIdentity);
    for (const identity of [...fileIdentities].reverse()) {
      await assertDirectoryIdentities([...owners, rootIdentity]);
      await assertFileIdentity(identity);
      await rm(identity.path);
    }
    for (const identity of [...directoryIdentities].reverse()) {
      if (identity.path === rootIdentity.path) continue;
      await assertDirectoryIdentities([...owners, rootIdentity]);
      await assertDirectoryIdentity(identity);
      await rmdir(identity.path);
    }
    await assertDirectoryIdentities(owners);
    await assertDirectoryIdentity(rootIdentity);
    await rmdir(rootIdentity.path);
    return true;
  } catch (error) {
    if (strict) throw error;
    // Changed ownership keeps cleanup on the safe side of the boundary. The
    // captured publication root remains the operator recovery coordinate.
    return false;
  }
}

async function ensureOwnedDirectoryPath({
  rootPath,
  directoryPath,
  rootIdentity,
  owners,
  identitiesByPath,
  createdDirectories,
}) {
  const relativePath = relative(rootPath, directoryPath);
  if (relativePath === "") return rootIdentity;
  const segments = relativePath.split(sep).filter(Boolean);
  let currentPath = rootPath;
  let parentIdentity = rootIdentity;
  for (const segment of segments) {
    currentPath = contained(rootPath, resolve(currentPath, segment));
    let identity = identitiesByPath.get(currentPath);
    if (!identity) {
      identity = await createOwnedDirectory(
        currentPath,
        `candidate_directory.${relative(rootPath, currentPath).split(sep).join("/")}`,
        [...owners, rootIdentity, parentIdentity],
      );
      identitiesByPath.set(currentPath, identity);
      createdDirectories.push(identity);
    } else {
      await assertDirectoryIdentities([...owners, rootIdentity, parentIdentity, identity]);
    }
    parentIdentity = identity;
  }
  return parentIdentity;
}

async function acquireDestinationReservation({ reservationPath, reservationBytes, destination, owners }) {
  const deadline = Date.now() + reservationWaitMilliseconds;
  while (true) {
    try {
      return await createOwnedFile(
        reservationPath,
        "destination_reservation",
        reservationBytes,
        owners,
      );
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const destinationEntry = await lstat(destination).catch(readError => {
        if (readError.code === "ENOENT") return null;
        throw readError;
      });
      if (destinationEntry) return null;
      const reservationEntry = await lstat(reservationPath).catch(readError => {
        if (readError.code === "ENOENT") return null;
        throw publicationBoundaryError("destination_reservation", readError.code ?? "unreadable");
      });
      if (reservationEntry === null) continue;
      if (!reservationEntry.isFile() || reservationEntry.isSymbolicLink()) {
        throw publicationBoundaryError("destination_reservation", "regular_file_required");
      }
      if (Date.now() >= deadline) {
        throw new ObserverError(
          "PUBLICATION_RESERVATION_BUSY",
          "Receipt publication could not acquire the digest destination within the bounded wait.",
          { boundary: "destination_reservation", restartFrom: "candidate" },
        );
      }
      await new Promise(resolveDelay => setTimeout(resolveDelay, reservationPollMilliseconds));
    }
  }
}

async function acquirePointerReservation({ reservationPath, reservationBytes, owners }) {
  const deadline = Date.now() + reservationWaitMilliseconds;
  while (true) {
    try {
      return await createOwnedFile(
        reservationPath,
        "pointer_reservation",
        reservationBytes,
        owners,
      );
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const reservationEntry = await lstat(reservationPath).catch(readError => {
        if (readError.code === "ENOENT") return null;
        throw publicationBoundaryError("pointer_reservation", readError.code ?? "unreadable");
      });
      if (reservationEntry === null) continue;
      if (!reservationEntry.isFile() || reservationEntry.isSymbolicLink()) {
        throw publicationBoundaryError("pointer_reservation", "regular_file_required");
      }
      if (Date.now() >= deadline) {
        throw new ObserverError(
          "PUBLICATION_POINTER_BUSY",
          "Receipt publication could not acquire the accepted-pointer reservation within the bounded wait.",
          { boundary: "pointer_reservation", restartFrom: "pointer" },
        );
      }
      await new Promise(resolveDelay => setTimeout(resolveDelay, reservationPollMilliseconds));
    }
  }
}

async function releasePointerReservation(identity, owners, acceptedCoordinate) {
  if (!identity) return;
  try {
    await removeOwnedFile(identity, owners, { strict: true });
  } catch (error) {
    throw new ObserverError(
      "PUBLICATION_POINTER_RESERVATION_RELEASE_FAILED",
      "The accepted-pointer reservation remains available for inspection before publication resumes.",
      {
        checkpoint: "pointer_reservation_release",
        restartFrom: "accepted_coordinate_recovery",
        action: "inspect_or_quarantine",
        acceptedCoordinate,
        failure: boundedFailureContext(error, "RESERVATION_RELEASE_FAILED", "pointer_reservation"),
      },
    );
  }
}

async function capturePointerState(pointerPath, owner) {
  await assertDirectoryIdentity(owner);
  const entry = await lstat(pointerPath).catch(error => {
    if (error.code === "ENOENT") return null;
    throw publicationBoundaryError("accepted_pointer", error.code ?? "unreadable");
  });
  if (entry === null) return Object.freeze({ present: false });
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw publicationBoundaryError("accepted_pointer", "regular_file_required");
  }
  const identity = {
    path: pointerPath,
    boundary: "accepted_pointer",
    dev: entry.dev,
    ino: entry.ino,
  };
  const bytes = await readBoundedRegularFile(pointerPath, {
    boundary: "accepted_pointer",
    maxBytes: 4_096,
    restartFrom: "pointer",
  });
  await assertDirectoryIdentity(owner);
  await assertFileIdentity(identity);
  return Object.freeze({ present: true, dev: entry.dev, ino: entry.ino, bytes });
}

function pointerStateMatches(expected, observed) {
  return expected.present === observed.present
    && (!expected.present || (
      expected.dev === observed.dev
      && expected.ino === observed.ino
      && expected.bytes.equals(observed.bytes)
    ));
}

async function requirePointerCommitAuthority(pointerPath, owner, expected, desiredBytes) {
  const observed = await capturePointerState(pointerPath, owner);
  if (observed.present && observed.bytes.equals(desiredBytes)) return "commit";
  if (pointerStateMatches(expected, observed)) return "commit";
  throw new ObserverError(
    "PUBLICATION_POINTER_CONFLICT",
    "The accepted pointer changed after this publication captured its prior state.",
    { boundary: "accepted_pointer", restartFrom: "pointer" },
  );
}

export function humanReceipt(inputReceipt) {
  const receipt = validateReceipt(inputReceipt);
  const scalar = value => {
    const line = String(value).replace(/[\u0000-\u001f\u007f]/gu, character => {
      const code = character.codePointAt(0).toString(16).padStart(2, "0");
      return `\\u${code}`;
    });
    const longestFence = Math.max(0, ...[...line.matchAll(/`+/gu)].map(match => match[0].length));
    const fence = "`".repeat(longestFence + 1);
    return `${fence}${line}${fence}`;
  };
  return `# Observation ${scalar(receipt.receiptId)}\n\n- Target: ${scalar(receipt.targetId)}\n- Decision: ${scalar(receipt.decisionBoundary)}\n- Oracle: ${scalar(receipt.observation)}\n- Result: ${scalar(receipt.result.status)}\n- Source: ${scalar(`${receipt.source.semanticId}@${receipt.source.version}`)} (${scalar(receipt.source.manifestKind)} ${scalar(receipt.source.manifestSha256)})\n- Receiver: ${scalar(`${receipt.receiver.semanticId}@${receipt.receiver.version}`)} (${scalar(receipt.receiver.manifestKind)} ${scalar(receipt.receiver.manifestSha256)})\n- Observed subject: ${scalar(receipt.subject.path)} (${scalar(receipt.subject.sha256)})\n- Environment: ${scalar(receipt.environment.coordinateKind)}\n- Browser: ${scalar(`${receipt.environment.browserName} ${receipt.environment.browserVersion}`)} (${scalar(receipt.environment.browserRevision)})\n- Standing: ${scalar(receipt.standing)}\n- Restart: ${scalar(receipt.restartFrom)}\n`;
}

function inventoryEnvelope(paths) {
  const directories = new Set();
  let maxDepth = 0;
  for (const entryPath of paths) {
    const segments = entryPath.split("/");
    maxDepth = Math.max(maxDepth, segments.length - 1);
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join("/"));
    }
  }
  return { maxDepth, maxEntries: paths.length + directories.size };
}

async function walkFiles(root, { maxDepth, maxEntries }, acceptedCoordinate) {
  const paths = [];
  const rootEntry = await lstat(root);
  if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
    throw acceptedIntegrityMismatch("Accepted receipt storage requires one regular directory.", acceptedCoordinate);
  }
  const pending = [{ directory: root, depth: 0 }];
  let observedEntries = 0;
  while (pending.length > 0) {
    const { directory, depth } = pending.pop();
    const handle = await opendir(directory);
    try {
      for await (const entry of handle) {
        observedEntries += 1;
        if (observedEntries > maxEntries) {
          throw acceptedIntegrityMismatch("Accepted receipt inventory exceeds its declared finite envelope.", acceptedCoordinate, { maxEntries });
        }
        const path = resolve(directory, entry.name);
        const pathEntry = await lstat(path);
        const receiptPath = relative(root, path).replaceAll("\\", "/");
        if (pathEntry.isSymbolicLink()) throw acceptedIntegrityMismatch("Accepted receipt bytes require regular files and directories; a symbolic link was found.", acceptedCoordinate, { path: receiptPath });
        if (pathEntry.isDirectory()) {
          const nextDepth = depth + 1;
          if (nextDepth > maxDepth) {
            throw acceptedIntegrityMismatch("Accepted receipt inventory exceeds its declared directory depth.", acceptedCoordinate, { path: receiptPath, maxDepth });
          }
          pending.push({ directory: path, depth: nextDepth });
        } else if (pathEntry.isFile()) paths.push(receiptPath);
        else throw acceptedIntegrityMismatch("Accepted receipt bytes must be regular files and directories.", acceptedCoordinate, { path: receiptPath });
      }
    } finally {
      await handle.close().catch(error => {
        if (error.code !== "ERR_DIR_CLOSED") throw error;
      });
    }
  }
  return paths.sort();
}

async function readAcceptedBytes(destination, path, expectedBytes, acceptedCoordinate) {
  try {
    return await readBoundedRegularFile(contained(destination, path), {
      boundary: `accepted.${path}`,
      maxBytes: expectedBytes,
      expectedBytes,
      restartFrom: "accepted_coordinate_recovery",
    });
  } catch (error) {
    throw acceptedIntegrityMismatch("Accepted receipt bytes differ from the verified candidate.", acceptedCoordinate, {
      path,
      causeCode: error.code,
      reason: error.message,
    });
  }
}

async function verifyAcceptedDestination(destination, expectedFiles, acceptedCoordinate) {
  const expectedInventory = [...expectedFiles.keys()].sort();
  let observedInventory;
  try {
    observedInventory = await walkFiles(destination, inventoryEnvelope(expectedInventory), acceptedCoordinate);
  } catch (error) {
    if (error instanceof ObserverError) throw error;
    throw acceptedIntegrityMismatch("Accepted receipt inventory is unreadable.", acceptedCoordinate, { reason: error.message });
  }
  if (stableStringify(observedInventory) !== stableStringify(expectedInventory)) {
    throw acceptedIntegrityMismatch("Accepted receipt inventory differs from the verified candidate.", acceptedCoordinate, { expectedInventory, observedInventory });
  }
  for (const [path, expectedBytes] of expectedFiles) {
    const bytes = await readAcceptedBytes(destination, path, expectedBytes.byteLength, acceptedCoordinate);
    if (!bytes.equals(expectedBytes)) {
      throw acceptedIntegrityMismatch("Accepted receipt bytes differ from the verified candidate.", acceptedCoordinate, { path });
    }
  }
}

async function captureAcceptedFileIdentities(destination, expectedFiles, acceptedCoordinate) {
  const identities = [];
  for (const path of expectedFiles.keys()) {
    identities.push(await requireRegularFileIdentity(
      contained(destination, path),
      `accepted_file.${path}`,
      acceptedCoordinate,
    ));
  }
  return identities;
}

async function readSettledPointerBytes(pointerPath, expectedBytes) {
  let lastError = null;
  for (let attempt = 1; attempt <= pointerVerificationAttempts; attempt += 1) {
    try {
      return await readBoundedRegularFile(pointerPath, {
        boundary: "accepted_pointer",
        maxBytes: expectedBytes.byteLength,
        expectedBytes: expectedBytes.byteLength,
        restartFrom: "pointer",
      });
    } catch (error) {
      lastError = error;
      const concurrentReplacement = error instanceof ObserverError
        && ["SOURCE_FILE_CHANGED", "SOURCE_FILE_UNREADABLE"].includes(error.code);
      if (!concurrentReplacement || attempt === pointerVerificationAttempts) throw error;
      await new Promise(resolveDelay => setTimeout(resolveDelay, 1));
    }
  }
  throw lastError;
}

function artifactSourceFor(artifactSources, artifactPath) {
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(artifactSources, artifactPath);
  } catch {
    throw new ObserverError(
      "ARTIFACT_SOURCE_REQUIRED",
      "Each declared artifact requires one directly addressed source path.",
      { artifactPath, reason: "descriptor_inspection_failed", restartFrom: "candidate" },
    );
  }
  if (
    !descriptor
    || descriptor.enumerable !== true
    || !Object.hasOwn(descriptor, "value")
    || typeof descriptor.value !== "string"
    || descriptor.value.length === 0
  ) {
    throw new ObserverError(
      "ARTIFACT_SOURCE_REQUIRED",
      "Each declared artifact requires one directly addressed source path.",
      { artifactPath, restartFrom: "candidate" },
    );
  }
  return descriptor.value;
}

export async function publishReceipt(root, inputReceipt, {
  injectFault = null,
  artifactSources = {},
  ownerRoot = null,
} = {}) {
  const receipt = validateReceipt(inputReceipt);
  validateReceiptSchema(receipt);
  const acceptedReceipt = validateReceipt({ ...receipt, standing: "accepted" });
  validateReceiptSchema(acceptedReceipt);
  const acceptedReceiptBytes = Buffer.from(stableStringify(acceptedReceipt));
  const acceptedHumanBytes = Buffer.from(humanReceipt(acceptedReceipt));
  const receiptSha256 = sha256(acceptedReceiptBytes);
  const absoluteRoot = resolve(root);
  const candidateParentPath = contained(absoluteRoot, ".candidates");
  const candidateRoot = contained(absoluteRoot, `.candidates/${receipt.receiptId}.${randomUUID()}`);
  const acceptedRoot = contained(absoluteRoot, "accepted");
  const pointerPath = contained(absoluteRoot, "accepted-pointer.json");
  const pointerReservationPath = contained(absoluteRoot, ".accepted-pointer.reservation");
  const destination = contained(acceptedRoot, receiptSha256);
  const reservationPath = contained(acceptedRoot, `.reservation-${receiptSha256}`);
  // A caller may either provision the directly addressed root or name the
  // stable owner from which this publisher creates and captures every
  // descendant. Both routes establish publication authority before a
  // candidate is allocated.
  const publicationRoot = ownerRoot === null
    ? await requireRegularDirectory(absoluteRoot, "root")
    : await provisionPublicationRoot(ownerRoot, absoluteRoot, injectFault);
  const candidateParent = await requireRegularDirectory(candidateParentPath, ".candidates", {
    create: true,
    mode: 0o700,
    privateMode: true,
  });
  const acceptedParent = await requireRegularDirectory(acceptedRoot, "accepted", { create: true });
  const pointerExpectation = await capturePointerState(pointerPath, publicationRoot);
  const pointerReservationBytes = Buffer.from(`${process.pid}-${randomUUID()}\n`);
  const candidateDirectories = [];
  const candidateFiles = [];
  const candidateDirectoryByPath = new Map();
  const expectedFiles = new Map();
  const candidateFileByPath = new Map();
  let candidate = null;
  let candidatePromoted = false;
  let reservationIdentity = null;
  let pointerReservationIdentity = null;
  let temporaryPointerIdentity = null;
  try {
    candidate = await createOwnedDirectory(
      candidateRoot,
      "candidate",
      [publicationRoot, candidateParent, acceptedParent],
    );
    candidateDirectoryByPath.set(candidateRoot, candidate);

    const assertCandidateState = async () => {
      await assertDirectoryIdentities([
        publicationRoot,
        candidateParent,
        acceptedParent,
        candidate,
        ...candidateDirectories,
      ]);
      await assertFileIdentities(candidateFiles);
    };

    const assertCandidateBytes = async () => {
      await assertCandidateState();
      for (const [path, expectedBytes] of expectedFiles) {
        const identity = candidateFileByPath.get(path);
        await assertOwnedFileBytes(
          identity,
          expectedBytes,
          [publicationRoot, candidateParent, candidate, ...candidateDirectories],
        );
      }
      await assertCandidateState();
    };

    const stageFile = async (path, bytes) => {
      const filePath = contained(candidateRoot, path);
      const parentIdentity = await ensureOwnedDirectoryPath({
        rootPath: candidateRoot,
        directoryPath: dirname(filePath),
        rootIdentity: candidate,
        owners: [publicationRoot, candidateParent, acceptedParent],
        identitiesByPath: candidateDirectoryByPath,
        createdDirectories: candidateDirectories,
      });
      await invokeFaultHook(injectFault, "before_candidate_file_write", {
        root: absoluteRoot,
        candidateParent: candidateParentPath,
        candidate: candidateRoot,
        path: filePath,
        receiptPath: path,
      });
      await assertCandidateState();
      const identity = await createOwnedFile(
        filePath,
        `candidate_file.${path}`,
        bytes,
        [
          publicationRoot,
          candidateParent,
          acceptedParent,
          candidate,
          ...candidateDirectories,
          parentIdentity,
        ],
        { identities: candidateFiles },
      );
      candidateFileByPath.set(path, identity);
      expectedFiles.set(path, Buffer.from(bytes));
      await invokeFaultHook(injectFault, "after_candidate_file_write", {
        root: absoluteRoot,
        candidateParent: candidateParentPath,
        candidate: candidateRoot,
        path: filePath,
        receiptPath: path,
      });
      // The candidate envelope is intentionally small. Rechecking every owned
      // leaf after each write makes a cross-write replacement observable.
      await assertCandidateBytes();
    };

    for (const artifact of receipt.artifacts) {
      const sourcePath = artifactSourceFor(artifactSources, artifact.path);
      const bytes = await readBoundedRegularFile(sourcePath, {
        boundary: `artifact_source.${artifact.path}`,
        maxBytes: OBSERVER_RESOURCE_LIMITS.artifactBytes,
        expectedBytes: artifact.bytes,
        restartFrom: "candidate",
      });
      if (sha256(bytes) !== artifact.sha256) {
        throw new ObserverError("ARTIFACT_DIGEST_MISMATCH", "Artifact bytes must match the declared size and digest before promotion.", { artifactPath: artifact.path, restartFrom: "candidate" });
      }
      await stageFile(artifact.path, bytes);
    }
    await stageFile("receipt.json", acceptedReceiptBytes);
    await stageFile("receipt.md", acceptedHumanBytes);
    if (injectFault === "after_candidate") throw new ObserverError("INJECTED_INTERRUPTION", "Candidate interruption requested by the test fixture.", { checkpoint: "candidate_written", restartFrom: "candidate" });
    await invokeFaultHook(injectFault, "before_candidate_rename", {
      root: absoluteRoot,
      candidateParent: candidateParentPath,
      candidate: candidateRoot,
      accepted: acceptedRoot,
      destination,
    });
    await assertCandidateBytes();
    const reservationBytes = Buffer.from(`${process.pid}-${randomUUID()}\n`);
    reservationIdentity = await acquireDestinationReservation({
      reservationPath,
      reservationBytes,
      destination,
      owners: [publicationRoot, acceptedParent],
    });
    if (reservationIdentity) {
      await assertOwnedFileBytes(
        reservationIdentity,
        reservationBytes,
        [publicationRoot, acceptedParent],
      );
    }
    const existingDestination = await lstat(destination).catch(error => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (existingDestination === null) {
      await assertCandidateBytes();
      if (reservationIdentity) {
        await assertOwnedFileBytes(
          reservationIdentity,
          reservationBytes,
          [publicationRoot, acceptedParent],
        );
      }
      try {
        await rename(candidateRoot, destination);
        candidatePromoted = true;
      } catch (error) {
        if (!["EEXIST", "EISDIR", "ENOTDIR", "ENOTEMPTY"].includes(error.code)) throw error;
      }
    }
    if (!candidatePromoted) {
      await removeOwnedTree(
        candidate,
        [publicationRoot, candidateParent],
        candidateDirectories,
        candidateFiles,
        { strict: true },
      );
      candidate = null;
    }
    const acceptedDestination = await requireRegularDirectory(destination, "accepted_destination", {
      acceptedCoordinate: receiptSha256,
    });
    await assertDirectoryIdentities([publicationRoot, acceptedParent, acceptedDestination]);
    await verifyAcceptedDestination(destination, expectedFiles, receiptSha256);
    const acceptedFileIdentities = await captureAcceptedFileIdentities(
      destination,
      expectedFiles,
      receiptSha256,
    );
    if (reservationIdentity) {
      await assertOwnedFileBytes(
        reservationIdentity,
        reservationBytes,
        [publicationRoot, acceptedParent],
      );
      let releasePrimaryError = null;
      try {
        await invokeFaultHook(injectFault, "before_reservation_release", {
          root: absoluteRoot,
          accepted: acceptedRoot,
          destination,
          reservationPath,
        });
      } catch (error) {
        releasePrimaryError = error;
      }
      const acquiredReservation = reservationIdentity;
      reservationIdentity = null;
      try {
        await releaseDestinationReservation(
          acquiredReservation,
          [publicationRoot, acceptedParent],
          receiptSha256,
        );
      } catch (cleanupError) {
        if (releasePrimaryError) {
          throw retainReservationCleanupFailure(releasePrimaryError, cleanupError, receiptSha256);
        }
        throw cleanupError;
      }
      if (releasePrimaryError) throw releasePrimaryError;
    }
    if (injectFault === "before_pointer") throw new ObserverError("INJECTED_INTERRUPTION", "Pointer interruption requested by the test fixture.", { checkpoint: "accepted_bytes_verified", restartFrom: "pointer" });
    const pointer = { schemaVersion: "0.1.0", receiptId: receipt.receiptId, receiptSha256, path: `accepted/${receiptSha256}/receipt.json` };
    const pointerBytes = Buffer.from(stableStringify(pointer));
    const temporaryPointer = resolve(dirname(pointerPath), `.accepted-pointer.${process.pid}.${randomUUID()}.tmp`);
    await invokeFaultHook(injectFault, "before_pointer_reservation_acquire", {
      root: absoluteRoot,
      accepted: acceptedRoot,
      destination,
      pointer: pointerPath,
      pointerReservationPath,
    });
    pointerReservationIdentity = await acquirePointerReservation({
      reservationPath: pointerReservationPath,
      reservationBytes: pointerReservationBytes,
      owners: [publicationRoot],
    });
    let pointerPrimaryError = null;
    try {
      await assertOwnedFileBytes(
        pointerReservationIdentity,
        pointerReservationBytes,
        [publicationRoot],
        "pointer",
      );
      await invokeFaultHook(injectFault, "after_pointer_reservation_acquired", {
        root: absoluteRoot,
        accepted: acceptedRoot,
        destination,
        pointer: pointerPath,
        pointerReservationPath,
      });
      const disposition = await requirePointerCommitAuthority(
        pointerPath,
        publicationRoot,
        pointerExpectation,
        pointerBytes,
      );
      if (disposition === "commit") {
        await invokeFaultHook(injectFault, "before_pointer_rename", {
          root: absoluteRoot,
          accepted: acceptedRoot,
          destination,
          pointer: pointerPath,
          temporaryPointer,
        });
        await assertDirectoryIdentities([publicationRoot, acceptedParent, acceptedDestination]);
        await assertFileIdentities(acceptedFileIdentities);
        temporaryPointerIdentity = await createOwnedFile(
          temporaryPointer,
          "temporary_pointer",
          pointerBytes,
          [publicationRoot, acceptedParent, acceptedDestination],
        );
        await invokeFaultHook(injectFault, "after_pointer_write", {
          root: absoluteRoot,
          accepted: acceptedRoot,
          destination,
          pointer: pointerPath,
          temporaryPointer,
        });
        await assertDirectoryIdentities([publicationRoot, acceptedParent, acceptedDestination]);
        await assertFileIdentities(acceptedFileIdentities);
        await assertOwnedFileBytes(
          temporaryPointerIdentity,
          pointerBytes,
          [publicationRoot, acceptedParent, acceptedDestination],
          "pointer",
        );
        await verifyAcceptedDestination(destination, expectedFiles, receiptSha256);
        await assertDirectoryIdentities([publicationRoot, acceptedParent, acceptedDestination]);
        await assertFileIdentities(acceptedFileIdentities);
        await assertOwnedFileBytes(
          pointerReservationIdentity,
          pointerReservationBytes,
          [publicationRoot],
          "pointer",
        );
        await rename(temporaryPointer, pointerPath);
        temporaryPointerIdentity = null;
        const acceptedPointerBytes = await readSettledPointerBytes(pointerPath, pointerBytes);
        if (!acceptedPointerBytes.equals(pointerBytes)) {
          throw publicationBoundaryError("accepted_pointer", "file_bytes_changed");
        }
      }
    } catch (error) {
      pointerPrimaryError = error;
    }
    const acquiredPointerReservation = pointerReservationIdentity;
    pointerReservationIdentity = null;
    try {
      await releasePointerReservation(acquiredPointerReservation, [publicationRoot], receiptSha256);
    } catch (cleanupError) {
      if (pointerPrimaryError) {
        throw retainReservationCleanupFailure(pointerPrimaryError, cleanupError, receiptSha256, {
          checkpoint: "pointer_reservation_release",
          cleanupBoundary: "pointer_reservation",
        });
      }
      throw cleanupError;
    }
    if (pointerPrimaryError) throw pointerPrimaryError;
    return pointer;
  } catch (error) {
    await removeOwnedFile(temporaryPointerIdentity, [publicationRoot]);
    let failure = error;
    if (pointerReservationIdentity) {
      try {
        await releasePointerReservation(pointerReservationIdentity, [publicationRoot], receiptSha256);
      } catch (cleanupError) {
        failure = retainReservationCleanupFailure(error, cleanupError, receiptSha256, {
          checkpoint: "pointer_reservation_release",
          cleanupBoundary: "pointer_reservation",
        });
      }
      pointerReservationIdentity = null;
    }
    if (reservationIdentity) {
      try {
        await releaseDestinationReservation(
          reservationIdentity,
          [publicationRoot, acceptedParent],
          receiptSha256,
        );
      } catch (cleanupError) {
        failure = retainReservationCleanupFailure(error, cleanupError, receiptSha256);
      }
      reservationIdentity = null;
    }
    if (!candidatePromoted) {
      await removeOwnedTree(
        candidate,
        [publicationRoot, candidateParent],
        candidateDirectories,
        candidateFiles,
      );
    }
    const admittedFailure = admittedObserverError(failure);
    // Admission reads only bounded own data descriptors. Reconstruct the
    // exported failure so caller-controlled identity and extra properties stay
    // outside the publication result. Bounded details carry the diagnostic
    // context across this boundary.
    if (admittedFailure) {
      const retained = new ObserverError(
        admittedFailure.code,
        admittedFailure.message,
        admittedFailure.details,
      );
      throw retained;
    }
    const retained = new ObserverError(
      "PUBLICATION_FAILED",
      "Receipt publication stopped at a recoverable coordinate.",
      {
        causeCode: boundedOwnString(failure, "code", "PUBLICATION_FAILED"),
        reason: boundedOwnString(failure, "message", "Publication failed at the selected coordinate.", 4_096),
        restartFrom: candidatePromoted ? "pointer" : "candidate",
      },
    );
    throw retained;
  }
}
