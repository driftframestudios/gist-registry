import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, opendir, rename, rm, rmdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import {
  OBSERVER_RESOURCE_LIMITS,
  ObserverError,
  readBoundedRegularFile,
  sha256,
  stableStringify,
  validateReceipt,
} from "./contracts.mjs";
import { validateReceiptSchema } from "./receipt-schema.mjs";

const reservationWaitMilliseconds = 10_000;
const reservationPollMilliseconds = 10;
const pointerVerificationAttempts = 16;

function contained(root, candidate) {
  const absoluteRoot = resolve(root);
  const absoluteCandidate = resolve(root, candidate);
  if (absoluteCandidate !== absoluteRoot && !absoluteCandidate.startsWith(`${absoluteRoot}${sep}`)) {
    throw new ObserverError("PATH_ESCAPE", "Publication path must remain inside the receipt root.", { candidate, restartFrom: "candidate" });
  }
  return absoluteCandidate;
}

function publicationRecoveryCoordinate(boundary) {
  if (boundary === "temporary_pointer" || boundary === "accepted_pointer") return "pointer";
  if (
    boundary === "candidate"
    || boundary === "destination_reservation"
    || boundary === "accepted_destination"
    || boundary.startsWith("candidate_")
    || boundary.startsWith("accepted_file.")
  ) return "candidate";
  return "publication_root";
}

function publicationBoundaryError(boundary, reason) {
  return new ObserverError(
    "PUBLICATION_BOUNDARY_INVALID",
    "Receipt publication requires a stable, directly addressed ownership boundary.",
    { boundary, reason, restartFrom: publicationRecoveryCoordinate(boundary) },
  );
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
    throw publicationBoundaryError(boundary, error.code ?? "unreadable");
  }
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw publicationBoundaryError(boundary, "regular_directory_required");
  }
  if (privateMode && (entry.mode & 0o077) !== 0) {
    if (!create) throw publicationBoundaryError(boundary, "private_directory_required");
    // Earlier observer versions created this durable parent with the process
    // default mode. Tighten the captured directory in place so an existing
    // receipt workspace can resume under the stronger publication contract.
    entry = await tightenPrivateDirectoryMode(path, boundary, entry, mode);
  }
  return { path, boundary, dev: entry.dev, ino: entry.ino, privateMode };
}

async function assertDirectoryIdentity(identity) {
  let entry;
  try {
    entry = await lstat(identity.path);
  } catch (error) {
    throw publicationBoundaryError(identity.boundary, error.code ?? "unreadable");
  }
  if (
    !entry.isDirectory()
    || entry.isSymbolicLink()
    || entry.dev !== identity.dev
    || entry.ino !== identity.ino
    || (identity.privateMode && (entry.mode & 0o077) !== 0)
  ) {
    throw publicationBoundaryError(identity.boundary, "directory_identity_changed");
  }
}

async function assertDirectoryIdentities(identities) {
  for (const identity of identities) await assertDirectoryIdentity(identity);
}

async function requireRegularFileIdentity(path, boundary) {
  let entry;
  try {
    entry = await lstat(path);
  } catch (error) {
    throw publicationBoundaryError(boundary, error.code ?? "unreadable");
  }
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw publicationBoundaryError(boundary, "regular_file_required");
  }
  return { path, boundary, dev: entry.dev, ino: entry.ino };
}

async function assertFileIdentity(identity) {
  let entry;
  try {
    entry = await lstat(identity.path);
  } catch (error) {
    throw publicationBoundaryError(identity.boundary, error.code ?? "unreadable");
  }
  if (
    !entry.isFile()
    || entry.isSymbolicLink()
    || entry.dev !== identity.dev
    || entry.ino !== identity.ino
  ) {
    throw publicationBoundaryError(identity.boundary, "file_identity_changed");
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
    throw publicationBoundaryError(identity.boundary, error.code ?? "file_bytes_unreadable");
  }
  if (!observed.equals(expectedBytes)) {
    throw publicationBoundaryError(identity.boundary, "file_bytes_changed");
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
        throw publicationBoundaryError("destination_reservation", readError.code ?? "unreadable");
      });
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

async function walkFiles(root, { maxDepth, maxEntries }) {
  const paths = [];
  const rootEntry = await lstat(root);
  if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
    throw new ObserverError("ACCEPTED_INTEGRITY_MISMATCH", "Accepted receipt storage requires one regular directory.", { restartFrom: "candidate" });
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
          throw new ObserverError("ACCEPTED_INTEGRITY_MISMATCH", "Accepted receipt inventory exceeds its declared finite envelope.", { maxEntries, restartFrom: "candidate" });
        }
        const path = resolve(directory, entry.name);
        const pathEntry = await lstat(path);
        const receiptPath = relative(root, path).replaceAll("\\", "/");
        if (pathEntry.isSymbolicLink()) throw new ObserverError("ACCEPTED_INTEGRITY_MISMATCH", "Accepted receipt bytes require regular files and directories; a symbolic link was found.", { path: receiptPath, restartFrom: "candidate" });
        if (pathEntry.isDirectory()) {
          const nextDepth = depth + 1;
          if (nextDepth > maxDepth) {
            throw new ObserverError("ACCEPTED_INTEGRITY_MISMATCH", "Accepted receipt inventory exceeds its declared directory depth.", { path: receiptPath, maxDepth, restartFrom: "candidate" });
          }
          pending.push({ directory: path, depth: nextDepth });
        } else if (pathEntry.isFile()) paths.push(receiptPath);
        else throw new ObserverError("ACCEPTED_INTEGRITY_MISMATCH", "Accepted receipt bytes must be regular files and directories.", { path: receiptPath, restartFrom: "candidate" });
      }
    } finally {
      await handle.close().catch(error => {
        if (error.code !== "ERR_DIR_CLOSED") throw error;
      });
    }
  }
  return paths.sort();
}

async function readAcceptedBytes(destination, path, expectedBytes) {
  try {
    return await readBoundedRegularFile(contained(destination, path), {
      boundary: `accepted.${path}`,
      maxBytes: expectedBytes,
      expectedBytes,
      restartFrom: "candidate",
    });
  } catch (error) {
    throw new ObserverError("ACCEPTED_INTEGRITY_MISMATCH", "Accepted receipt bytes differ from the verified candidate.", {
      path,
      causeCode: error.code,
      reason: error.message,
      restartFrom: "candidate",
    });
  }
}

async function verifyAcceptedDestination(destination, expectedFiles) {
  const expectedInventory = [...expectedFiles.keys()].sort();
  let observedInventory;
  try {
    observedInventory = await walkFiles(destination, inventoryEnvelope(expectedInventory));
  } catch (error) {
    if (error instanceof ObserverError) throw error;
    throw new ObserverError("ACCEPTED_INTEGRITY_MISMATCH", "Accepted receipt inventory is unreadable.", { reason: error.message, restartFrom: "candidate" });
  }
  if (stableStringify(observedInventory) !== stableStringify(expectedInventory)) {
    throw new ObserverError("ACCEPTED_INTEGRITY_MISMATCH", "Accepted receipt inventory differs from the verified candidate.", { expectedInventory, observedInventory, restartFrom: "candidate" });
  }
  for (const [path, expectedBytes] of expectedFiles) {
    const bytes = await readAcceptedBytes(destination, path, expectedBytes.byteLength);
    if (!bytes.equals(expectedBytes)) {
      throw new ObserverError("ACCEPTED_INTEGRITY_MISMATCH", "Accepted receipt bytes differ from the verified candidate.", { path, restartFrom: "candidate" });
    }
  }
}

async function captureAcceptedFileIdentities(destination, expectedFiles) {
  const identities = [];
  for (const path of expectedFiles.keys()) {
    identities.push(await requireRegularFileIdentity(
      contained(destination, path),
      `accepted_file.${path}`,
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

export async function publishReceipt(root, inputReceipt, { injectFault = null, artifactSources = {} } = {}) {
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
  const destination = contained(acceptedRoot, receiptSha256);
  const reservationPath = contained(acceptedRoot, `.reservation-${receiptSha256}`);
  const publicationRoot = await requireRegularDirectory(absoluteRoot, "root", { create: true });
  const candidateParent = await requireRegularDirectory(candidateParentPath, ".candidates", {
    create: true,
    mode: 0o700,
    privateMode: true,
  });
  const acceptedParent = await requireRegularDirectory(acceptedRoot, "accepted", { create: true });
  const candidateDirectories = [];
  const candidateFiles = [];
  const candidateDirectoryByPath = new Map();
  const expectedFiles = new Map();
  const candidateFileByPath = new Map();
  let candidate = null;
  let candidatePromoted = false;
  let reservationIdentity = null;
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
    const acceptedDestination = await requireRegularDirectory(destination, "accepted_destination");
    await assertDirectoryIdentities([publicationRoot, acceptedParent, acceptedDestination]);
    await verifyAcceptedDestination(destination, expectedFiles);
    const acceptedFileIdentities = await captureAcceptedFileIdentities(destination, expectedFiles);
    if (reservationIdentity) {
      await assertOwnedFileBytes(
        reservationIdentity,
        reservationBytes,
        [publicationRoot, acceptedParent],
      );
      await removeOwnedFile(
        reservationIdentity,
        [publicationRoot, acceptedParent],
        { strict: true },
      );
      reservationIdentity = null;
    }
    if (injectFault === "before_pointer") throw new ObserverError("INJECTED_INTERRUPTION", "Pointer interruption requested by the test fixture.", { checkpoint: "accepted_bytes_verified", restartFrom: "pointer" });
    const pointer = { schemaVersion: "0.1.0", receiptId: receipt.receiptId, receiptSha256, path: `accepted/${receiptSha256}/receipt.json` };
    const pointerBytes = Buffer.from(stableStringify(pointer));
    const temporaryPointer = resolve(dirname(pointerPath), `.accepted-pointer.${process.pid}.${randomUUID()}.tmp`);
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
    await verifyAcceptedDestination(destination, expectedFiles);
    await assertDirectoryIdentities([publicationRoot, acceptedParent, acceptedDestination]);
    await assertFileIdentities(acceptedFileIdentities);
    await rename(temporaryPointer, pointerPath);
    temporaryPointerIdentity = null;
    const acceptedPointerBytes = await readSettledPointerBytes(pointerPath, pointerBytes);
    if (!acceptedPointerBytes.equals(pointerBytes)) {
      throw publicationBoundaryError("accepted_pointer", "file_bytes_changed");
    }
    return pointer;
  } catch (error) {
    await removeOwnedFile(temporaryPointerIdentity, [publicationRoot]);
    await removeOwnedFile(reservationIdentity, [publicationRoot, acceptedParent]);
    if (!candidatePromoted) {
      await removeOwnedTree(
        candidate,
        [publicationRoot, candidateParent],
        candidateDirectories,
        candidateFiles,
      );
    }
    if (error instanceof ObserverError) throw error;
    throw new ObserverError(
      "PUBLICATION_FAILED",
      "Receipt publication stopped at a recoverable coordinate.",
      {
        causeCode: error.code,
        reason: error.message,
        restartFrom: candidatePromoted ? "pointer" : "candidate",
      },
    );
  }
}
