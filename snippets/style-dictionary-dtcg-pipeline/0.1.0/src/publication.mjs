import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, opendir, rename, rm, rmdir } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { types as utilTypes } from "node:util";
import {
  DEFAULT_LIMITS,
  compareOrdinal,
  PipelineError,
  readBoundedFile,
  sha256,
  snapshotJsonTree,
  stableStringify,
  validateTokenGraph,
} from "./contract.mjs";

const digestPattern = /^[a-f0-9]{64}$/u;
const rootManifestFields = new Set([
  "schemaVersion",
  "formatProfile",
  "compiler",
  "sourceDigest",
  "sourceInputs",
  "matrix",
  "artifactCount",
  "generatedBytes",
  "artifacts",
  "recoveryCoordinate",
  "manifestDigest",
]);
const supportedFaults = new Set(["after_copy", "before_pointer", "after_pointer_write"]);
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
const reservationWaitMilliseconds = 10_000;
const reservationPollMilliseconds = 10;

function contained(root, candidate, label) {
  const owner = resolve(root);
  const path = resolve(candidate);
  if (path !== owner && !path.startsWith(`${owner}${sep}`)) {
    throw new Error(`${label} must remain inside ${owner}`);
  }
  return path;
}

function requireAllowedFields(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a plain data object`);
  }
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (
    (prototype !== Object.prototype && prototype !== null)
    || keys.some(key => typeof key !== "string")
    || keys.some(key => {
      const descriptor = descriptors[key];
      return descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value");
    })
  ) {
    throw new Error(`${label} must be a plain data object`);
  }
  for (const key of keys) {
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported field ${key}`);
  }
}

function requireDenseDataArray(value, label, limit) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  requireSafeCount(value.length, `${label} count`, limit);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors).filter(key => key !== "length");
  if (
    Object.getPrototypeOf(value) !== Array.prototype
    || keys.length !== value.length
    || keys.some((key, index) => {
      const descriptor = descriptors[key];
      return typeof key !== "string"
        || key !== String(index)
        || descriptor.enumerable !== true
        || !Object.hasOwn(descriptor, "value");
    })
  ) {
    throw new Error(`${label} must be a dense data array`);
  }
}

function requireBoundedString(value, label, maxBytes = 1_024) {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new Error(`${label} must be a bounded non-empty string`);
  }
}

function requireSafeCount(value, label, limit) {
  if (!Number.isSafeInteger(value) || value < 0 || value > limit) {
    throw new Error(`${label} exceeds the configured envelope`);
  }
}

function validateManifestEnvelope(manifest) {
  requireAllowedFields(manifest, rootManifestFields, "candidate manifest");
  requireBoundedString(manifest.schemaVersion, "candidate manifest schemaVersion", 64);
  requireBoundedString(manifest.formatProfile, "candidate manifest formatProfile", 256);
  requireBoundedString(manifest.recoveryCoordinate, "candidate manifest recoveryCoordinate", 256);
  if (!digestPattern.test(manifest.sourceDigest ?? "")) throw new Error("candidate manifest sourceDigest must be lowercase SHA-256");
  assertSafeAcceptedDigest(manifest.manifestDigest);

  requireAllowedFields(manifest.compiler, new Set(["package", "version"]), "candidate manifest compiler");
  requireBoundedString(manifest.compiler.package, "candidate manifest compiler package", 256);
  requireBoundedString(manifest.compiler.version, "candidate manifest compiler version", 64);

  requireDenseDataArray(manifest.matrix, "candidate manifest matrix", DEFAULT_LIMITS.generatedFiles);
  for (const coordinate of manifest.matrix) {
    requireAllowedFields(coordinate, new Set(["brand", "mode"]), "candidate manifest matrix coordinate");
    requireBoundedString(coordinate.brand, "candidate manifest brand", 128);
    requireBoundedString(coordinate.mode, "candidate manifest mode", 128);
  }
  const matrixCoordinates = manifest.matrix.map(coordinate => `${coordinate.brand}-${coordinate.mode}`);
  if (new Set(matrixCoordinates).size !== matrixCoordinates.length) {
    throw new Error("candidate manifest matrix coordinates must be unique");
  }

  requireDenseDataArray(manifest.sourceInputs, "candidate manifest sourceInputs", DEFAULT_LIMITS.generatedFiles);
  const sourcePaths = new Set();
  for (const source of manifest.sourceInputs) {
    requireAllowedFields(source, new Set(["coordinate", "candidatePath", "bytes", "sha256"]), "candidate source input");
    requireBoundedString(source.coordinate, "candidate source input coordinate", 256);
    requireBoundedString(source.candidatePath, "candidate source input path");
    requireSafeCount(source.bytes, "candidate source input bytes", DEFAULT_LIMITS.sourceBytes);
    if (!digestPattern.test(source.sha256 ?? "")) throw new Error("candidate source input digest must be lowercase SHA-256");
    if (sourcePaths.has(source.candidatePath)) throw new Error("candidate source input paths must be unique");
    sourcePaths.add(source.candidatePath);
  }
  if (
    stableStringify(manifest.sourceInputs.map(source => source.coordinate)) !== stableStringify(matrixCoordinates)
    || manifest.sourceInputs.some(source => source.candidatePath !== `inputs/${source.coordinate}.tokens.json`)
  ) {
    throw new Error("candidate source inputs must match the ordered matrix coordinates");
  }

  requireDenseDataArray(manifest.artifacts, "candidate manifest artifacts", DEFAULT_LIMITS.generatedFiles);
  if (manifest.artifactCount !== manifest.artifacts.length) {
    throw new Error("candidate manifest artifactCount must equal the artifact inventory");
  }
  const artifactPaths = new Set();
  let generatedBytes = 0;
  for (const artifact of manifest.artifacts) {
    requireAllowedFields(artifact, new Set(["coordinate", "path", "bytes", "sha256"]), "candidate artifact");
    requireBoundedString(artifact.coordinate, "candidate artifact coordinate", 256);
    requireBoundedString(artifact.path, "candidate artifact path");
    requireSafeCount(artifact.bytes, "candidate artifact bytes", DEFAULT_LIMITS.generatedBytes);
    if (!digestPattern.test(artifact.sha256 ?? "")) throw new Error("candidate artifact digest must be lowercase SHA-256");
    generatedBytes += artifact.bytes;
    if (!Number.isSafeInteger(generatedBytes) || generatedBytes > DEFAULT_LIMITS.generatedBytes) {
      throw new Error("candidate manifest generated bytes exceed the configured envelope");
    }
    if (artifactPaths.has(artifact.path)) throw new Error("candidate artifact paths must be unique");
    artifactPaths.add(artifact.path);
  }
  if (manifest.generatedBytes !== generatedBytes) {
    throw new Error("candidate manifest generatedBytes must equal the artifact inventory");
  }
  const expectedArtifacts = matrixCoordinates.flatMap(coordinate => ["tokens.css", "tokens.d.ts", "tokens.js"]
    .map(file => ({ coordinate, path: `${coordinate}/${file}` })));
  if (stableStringify(manifest.artifacts.map(({ coordinate, path }) => ({ coordinate, path }))) !== stableStringify(expectedArtifacts)) {
    throw new Error("candidate artifacts must match the ordered matrix target inventory");
  }
  const { manifestDigest, ...manifestCoordinates } = manifest;
  if (sha256(stableStringify(manifestCoordinates)) !== manifestDigest) {
    throw new Error("artifact destination integrity mismatch: manifest digest differs from its content");
  }
}

async function regularFileInventory(root) {
  const inventory = [];
  const pending = [root];
  let observedEntries = 0;
  const entryLimit = DEFAULT_LIMITS.generatedFiles * 3 + 4;
  while (pending.length > 0) {
    const directoryPath = pending.pop();
    const directory = await opendir(directoryPath);
    try {
      for await (const entry of directory) {
        observedEntries += 1;
        if (observedEntries > entryLimit) {
          throw new Error("artifact destination integrity mismatch: inventory exceeds the configured envelope");
        }
        const path = contained(root, resolve(directoryPath, entry.name), "accepted artifact entry");
        if (entry.isSymbolicLink()) {
          throw new Error("artifact destination integrity mismatch: inventory requires regular files and directories");
        }
        if (entry.isDirectory()) pending.push(path);
        else if (entry.isFile()) inventory.push(relative(root, path).split(sep).join("/"));
        else throw new Error("artifact destination integrity mismatch: inventory requires regular files and directories");
      }
    } finally {
      await directory.close().catch(error => {
        if (error.code !== "ERR_DIR_CLOSED") throw error;
      });
    }
  }
  return inventory.sort(compareOrdinal);
}

async function requireContainedRegularFile(root, candidate, label) {
  const owner = resolve(root);
  const path = contained(owner, candidate, label);
  const segments = relative(owner, path).split(sep).filter(Boolean);
  const ownerEntry = await lstat(owner).catch(() => null);
  if (!ownerEntry?.isDirectory() || ownerEntry.isSymbolicLink() || segments.length === 0) {
    throw new Error(`${label} must descend from a regular candidate directory`);
  }

  let current = owner;
  let leafEntry = null;
  for (let index = 0; index < segments.length; index += 1) {
    current = resolve(current, segments[index]);
    const entry = await lstat(current).catch(() => null);
    const isLeaf = index === segments.length - 1;
    if (!entry || entry.isSymbolicLink() || (isLeaf ? !entry.isFile() : !entry.isDirectory())) {
      throw new Error(`${label} must traverse regular directories to one regular file`);
    }
    if (isLeaf) leafEntry = entry;
  }
  return { path, entry: leafEntry };
}

function acceptedRecoveryDetails(acceptedCoordinate) {
  return {
    restartFrom: "accepted_coordinate_recovery",
    action: "inspect_or_quarantine",
    acceptedCoordinate,
  };
}

function acceptedIntegrityMismatch(message, acceptedCoordinate, details = {}) {
  return new PipelineError(
    "ACCEPTED_INTEGRITY_MISMATCH",
    message,
    {
      stage: "accepted_verification",
      ...acceptedRecoveryDetails(acceptedCoordinate),
      ...details,
    },
  );
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

function admittedPipelineErrorDetails(error) {
  const details = ownDataValue(error, "details");
  try {
    const snapshot = snapshotJsonTree(details, {
      limits: {
        ...DEFAULT_LIMITS,
        depth: 16,
        sourceBytes: 32_768,
        sourceNodes: 512,
      },
      path: "promotion_failure.details",
    }).snapshot;
    return snapshot !== null && typeof snapshot === "object" && !Array.isArray(snapshot)
      ? snapshot
      : null;
  } catch {
    return null;
  }
}

function admittedPipelineError(error) {
  if (
    error === null
    || (typeof error !== "object" && typeof error !== "function")
    || utilTypes.isProxy(error)
  ) return null;
  try {
    if (Object.getPrototypeOf(error) !== PipelineError.prototype) return null;
  } catch {
    return null;
  }
  const code = boundedOwnString(error, "code", null);
  const message = boundedOwnString(error, "message", null, 4_096);
  const details = admittedPipelineErrorDetails(error);
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
  const admittedPrimary = admittedPipelineError(primaryError);
  if (admittedPrimary) {
    const retained = new PipelineError(admittedPrimary.code, admittedPrimary.message, {
      ...admittedPrimary.details,
      checkpoint,
      ...acceptedRecoveryDetails(acceptedCoordinate),
      cleanupFailure,
    });
    return retained;
  }
  const retained = new PipelineError(
    "PUBLICATION_FAILED",
    "Promotion stopped, and its publication reservation requires inspection.",
    {
      stage: "promotion",
      checkpoint,
      ...acceptedRecoveryDetails(acceptedCoordinate),
      primaryFailure: boundedFailureContext(primaryError, "PUBLICATION_FAILED", "promotion"),
      cleanupFailure,
    },
  );
  return retained;
}

function publicationBoundaryError(boundary, reason, acceptedCoordinate = null) {
  return new PipelineError(
    "PUBLICATION_BOUNDARY_INVALID",
    "Promotion requires stable, directly addressed regular directories.",
    {
      stage: "promotion",
      boundary,
      reason,
      ...(acceptedCoordinate === null
        ? { restartFrom: "promotion" }
        : acceptedRecoveryDetails(acceptedCoordinate)),
    },
  );
}

async function requireRegularDirectory(path, boundary, {
  create = false,
  recursive = false,
  acceptedCoordinate = null,
} = {}) {
  if (create) {
    try {
      await mkdir(path, { recursive });
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
  return { path, boundary, dev: entry.dev, ino: entry.ino, acceptedCoordinate };
}

async function assertDirectoryIdentity(identity) {
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
  ) {
    throw publicationBoundaryError(identity.boundary, "directory_identity_changed", identity.acceptedCoordinate);
  }
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

async function createOwnedDirectory(path, boundary, owners, { mode = 0o700 } = {}) {
  await assertDirectoryIdentities(owners);
  await mkdir(path, { mode });
  const identity = await requireRegularDirectory(path, boundary);
  await assertDirectoryIdentities(owners);
  await assertDirectoryIdentity(identity);
  return identity;
}

async function createOwnedFile(path, boundary, bytes, owners, { mode = 0o644, identities = null } = {}) {
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
        if (primaryError === null) throw error;
      }
    }
  }
  await assertDirectoryIdentities(owners);
  await assertFileIdentity(identity);
  return identity;
}

async function assertOwnedFileBytes(identity, expectedBytes, owners) {
  await assertDirectoryIdentities(owners);
  await assertFileIdentity(identity);
  const observed = await readBoundedFile(identity.path, {
    maxBytes: expectedBytes.byteLength,
    stage: "promotion",
    dimension: "publication_bytes",
    label: identity.boundary,
    restartFrom: "promotion",
  });
  if (!observed.equals(expectedBytes)) {
    throw publicationBoundaryError(identity.boundary, "file_bytes_changed", identity.acceptedCoordinate);
  }
  await assertDirectoryIdentities(owners);
  await assertFileIdentity(identity);
}

async function invokeFaultHook(injectFault, checkpoint, coordinates) {
  if (typeof injectFault === "function") {
    await injectFault(Object.freeze({ checkpoint, ...coordinates }));
  }
}

async function removeOwnedEmptyDirectory(identity, owners, { strict = false } = {}) {
  if (!identity) return true;
  try {
    await assertDirectoryIdentities(owners);
    await assertDirectoryIdentity(identity);
    await rmdir(identity.path);
    return true;
  } catch (error) {
    if (strict) throw error;
    // Ownership drift makes path-based cleanup unsafe. The stable root remains
    // the recovery coordinate for operator inspection.
    return false;
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
    // Preserve a changed path for operator inspection rather than deleting
    // material through an owner boundary that moved.
    return false;
  }
}

async function releaseDestinationReservation(identity, owners, acceptedCoordinate) {
  if (!identity) return;
  try {
    await removeOwnedFile(identity, owners, { strict: true });
  } catch (error) {
    throw new PipelineError(
      "PUBLICATION_RESERVATION_RELEASE_FAILED",
      "The digest reservation remains available for inspection before pointer promotion resumes.",
      {
        stage: "promotion",
        checkpoint: "destination_reservation_release",
        ...acceptedRecoveryDetails(acceptedCoordinate),
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
      await assertDirectoryIdentities(owners);
      await assertDirectoryIdentity(rootIdentity);
      await assertFileIdentity(identity);
      await rm(identity.path);
    }
    for (const identity of [...directoryIdentities].reverse()) {
      await assertDirectoryIdentities(owners);
      await assertDirectoryIdentity(rootIdentity);
      await assertDirectoryIdentity(identity);
      await rmdir(identity.path);
    }
    await assertDirectoryIdentities(owners);
    await assertDirectoryIdentity(rootIdentity);
    await rmdir(rootIdentity.path);
    return true;
  } catch (error) {
    if (strict) throw error;
    // Remove only identities created by this invocation. Any missing,
    // replaced, or additional entry leaves the remainder for inspection.
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
    currentPath = contained(rootPath, resolve(currentPath, segment), "staging directory");
    let identity = identitiesByPath.get(currentPath);
    if (!identity) {
      identity = await createOwnedDirectory(
        currentPath,
        `staging_directory.${relative(rootPath, currentPath).split(sep).join("/")}`,
        [...owners, rootIdentity, parentIdentity],
        { mode: 0o755 },
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

async function acquireDestinationReservation({
  reservationPath,
  reservationBytes,
  destination,
  owners,
}) {
  const deadline = Date.now() + reservationWaitMilliseconds;
  while (true) {
    try {
      return await createOwnedFile(
        reservationPath,
        "destination_reservation",
        reservationBytes,
        owners,
        { mode: 0o600 },
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
        throw new PipelineError(
          "PUBLICATION_RESERVATION_BUSY",
          "Promotion could not acquire the destination reservation within the bounded wait.",
          { stage: "promotion", restartFrom: "promotion" },
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
        { mode: 0o600 },
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
        throw new PipelineError(
          "PUBLICATION_POINTER_BUSY",
          "Promotion could not acquire the accepted-pointer reservation within the bounded wait.",
          { stage: "promotion", boundary: "pointer_reservation", restartFrom: "promotion" },
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
    throw new PipelineError(
      "PUBLICATION_POINTER_RESERVATION_RELEASE_FAILED",
      "The accepted-pointer reservation remains available for inspection before promotion resumes.",
      {
        stage: "promotion",
        checkpoint: "pointer_reservation_release",
        ...acceptedRecoveryDetails(acceptedCoordinate),
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
  const bytes = await readBoundedFile(pointerPath, {
    maxBytes: 4_096,
    stage: "accepted_pointer",
    dimension: "pointer_bytes",
    label: "Accepted pointer",
    restartFrom: "promotion",
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
  throw new PipelineError(
    "PUBLICATION_POINTER_CONFLICT",
    "The accepted pointer changed after this promotion captured its prior state.",
    {
      stage: "promotion",
      boundary: "accepted_pointer",
      restartFrom: "promotion",
    },
  );
}

async function verifyExistingDestination(destination, manifest, { acceptedCoordinate = null } = {}) {
  const mismatch = (message, details = {}) => {
    if (acceptedCoordinate !== null) {
      return acceptedIntegrityMismatch(message, acceptedCoordinate, details);
    }
    return new Error(message);
  };
  validateManifestEnvelope(manifest);
  await requireRegularDirectory(destination, "accepted_destination", { acceptedCoordinate });
  const manifestPath = contained(destination, resolve(destination, "manifest.json"), "accepted manifest");
  const manifestEntry = await lstat(manifestPath).catch(() => null);
  if (!manifestEntry?.isFile() || manifestEntry.isSymbolicLink()) {
    throw mismatch("Artifact destination integrity mismatch: manifest.json requires one regular file.", {
      relativePath: "manifest.json",
    });
  }
  let stored;
  try {
    stored = JSON.parse((await readBoundedFile(manifestPath, {
      maxBytes: DEFAULT_LIMITS.sourceBytes,
      stage: "accepted_verification",
      dimension: "manifest_bytes",
      label: "Accepted manifest",
      restartFrom: acceptedCoordinate === null ? "promotion" : "accepted_coordinate_recovery",
    })).toString("utf8"));
  } catch (error) {
    throw mismatch("Artifact destination integrity mismatch: manifest.json requires valid bounded JSON bytes.", {
      relativePath: "manifest.json",
      causeCode: error.code,
    });
  }
  if (stableStringify(stored) !== stableStringify(manifest)) {
    throw mismatch("Artifact destination integrity mismatch: the manifest differs from the candidate.", {
      relativePath: "manifest.json",
    });
  }

  const expectedPaths = ["manifest.json", ...manifest.artifacts.map(artifact => artifact.path)].sort(compareOrdinal);
  let observedPaths;
  try {
    observedPaths = await regularFileInventory(destination);
  } catch (error) {
    throw mismatch("Artifact destination integrity mismatch: the file inventory is unreadable.", {
      causeCode: error.code,
    });
  }
  if (stableStringify(observedPaths) !== stableStringify(expectedPaths)) {
    throw mismatch("Artifact destination integrity mismatch: the file inventory differs from the manifest.", {
      expectedPaths,
      observedPaths,
    });
  }
  for (const artifact of manifest.artifacts) {
    const path = contained(destination, resolve(destination, artifact.path), "accepted artifact");
    const entry = await lstat(path).catch(() => null);
    if (!entry?.isFile() || entry.isSymbolicLink()) {
      throw mismatch("Artifact destination integrity mismatch: an artifact requires one regular file.", {
        relativePath: artifact.path,
      });
    }
    let bytes;
    try {
      bytes = await readBoundedFile(path, {
        maxBytes: artifact.bytes,
        stage: "accepted_verification",
        dimension: "generated_bytes",
        label: `Accepted artifact ${artifact.path}`,
        restartFrom: acceptedCoordinate === null ? "promotion" : "accepted_coordinate_recovery",
      });
    } catch (error) {
      throw mismatch("Artifact destination integrity mismatch: accepted artifact bytes are unreadable.", {
        relativePath: artifact.path,
        causeCode: error.code,
      });
    }
    if (bytes.byteLength !== artifact.bytes || sha256(bytes) !== artifact.sha256) {
      throw mismatch("Artifact destination integrity mismatch: accepted artifact bytes differ from the manifest.", {
        relativePath: artifact.path,
      });
    }
  }
}

async function captureAcceptedFileIdentities(destination, manifest) {
  const relativePaths = ["manifest.json", ...manifest.artifacts.map(artifact => artifact.path)];
  const identities = [];
  for (const relativePath of relativePaths) {
    identities.push(await requireRegularFileIdentity(
      contained(destination, resolve(destination, relativePath), "accepted artifact identity"),
      `accepted_file.${relativePath}`,
      manifest.manifestDigest,
    ));
  }
  return identities;
}

export async function promoteCandidate({ candidateRoot, acceptedRoot, manifest, injectFault = null }) {
  if (
    injectFault !== null
    && typeof injectFault !== "function"
    && !supportedFaults.has(injectFault)
  ) {
    throw new PipelineError(
      "INVALID_FAULT_INJECTOR",
      "Promotion fault injection requires a supported checkpoint or async-compatible function.",
      { stage: "promotion", restartFrom: "configuration" },
    );
  }
  validateManifestEnvelope(manifest);
  // Snapshot the admitted envelope once so caller-side mutation cannot change
  // the coordinate while asynchronous staging is in progress.
  manifest = JSON.parse(stableStringify(manifest));
  validateManifestEnvelope(manifest);
  const candidate = resolve(candidateRoot);
  const accepted = resolve(acceptedRoot);
  const artifactsRoot = contained(accepted, resolve(accepted, "artifacts"), "artifacts root");
  const digest = manifest.manifestDigest;
  assertSafeAcceptedDigest(digest);
  const destination = contained(artifactsRoot, resolve(artifactsRoot, digest), "artifact destination");
  const invocationId = `${process.pid}-${randomUUID()}`;
  const privateStagingRoot = contained(
    artifactsRoot,
    resolve(artifactsRoot, `.candidate-${digest}-${invocationId}`),
    "private staging root",
  );
  const staging = contained(privateStagingRoot, resolve(privateStagingRoot, "payload"), "artifact staging");
  const reservationPath = contained(
    artifactsRoot,
    resolve(artifactsRoot, `.reservation-${digest}`),
    "destination reservation",
  );
  const capturedSources = [];
  for (const source of manifest.sourceInputs) {
    const { path: sourcePath, entry } = await requireContainedRegularFile(
      candidate,
      resolve(candidate, source.candidatePath),
      `candidate source ${source.candidatePath}`,
    );
    if (entry.size !== source.bytes) {
      throw new Error(`candidate source ${source.candidatePath} bytes differ from the manifest`);
    }
    const bytes = await readBoundedFile(sourcePath, {
      maxBytes: source.bytes,
      stage: "promotion",
      dimension: "source_bytes",
      label: `Candidate source ${source.candidatePath}`,
      restartFrom: "candidate_build",
    });
    if (sha256(bytes) !== source.sha256) {
      throw new Error(`candidate source ${source.candidatePath} digest differs from the manifest`);
    }
    let document;
    try {
      document = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      throw new Error(`candidate source ${source.candidatePath} requires valid JSON: ${error.message}`);
    }
    validateTokenGraph(document);
    if (!bytes.equals(Buffer.from(stableStringify(document), "utf8"))) {
      throw new Error(`candidate source ${source.candidatePath} differs from canonical bytes`);
    }
    capturedSources.push(document);
  }
  if (sha256(stableStringify(capturedSources)) !== manifest.sourceDigest) {
    throw new Error("candidate source digest differs from the captured source family");
  }
  const acceptedIdentity = await requireRegularDirectory(
    accepted,
    "accepted_root",
    { create: true, recursive: true },
  );
  const artifactsIdentity = await requireRegularDirectory(
    artifactsRoot,
    "accepted_artifacts_root",
    { create: true },
  );
  await assertDirectoryIdentity(acceptedIdentity);
  const pointerPath = resolve(accepted, "current.json");
  const reservationBytes = Buffer.from(`${invocationId}\n`, "utf8");
  const pointerReservationPath = contained(
    accepted,
    resolve(accepted, ".current.reservation"),
    "pointer reservation",
  );
  const pointerExpectation = await capturePointerState(pointerPath, acceptedIdentity);
  const stagingDirectories = [];
  const stagingFiles = [];
  const stagingDirectoriesByPath = new Map();
  let temporaryPointer = null;
  let temporaryPointerIdentity = null;
  let reservationIdentity = null;
  let pointerReservationIdentity = null;
  let privateStagingIdentity = null;
  let stagingIdentity = null;
  let stagingPromoted = false;
  try {
    privateStagingIdentity = await createOwnedDirectory(
      privateStagingRoot,
      "private_staging_root",
      [acceptedIdentity, artifactsIdentity],
      { mode: 0o700 },
    );
    stagingIdentity = await createOwnedDirectory(
      staging,
      "staging_payload",
      [acceptedIdentity, artifactsIdentity, privateStagingIdentity],
      { mode: 0o755 },
    );
    stagingDirectories.push(stagingIdentity);
    stagingDirectoriesByPath.set(staging, stagingIdentity);
    for (const artifact of manifest.artifacts) {
      const { path: sourcePath, entry } = await requireContainedRegularFile(
        candidate,
        resolve(candidate, artifact.path),
        `candidate artifact ${artifact.path}`,
      );
      if (entry.size !== artifact.bytes) {
        throw new Error(`candidate artifact ${artifact.path} bytes differ from the manifest`);
      }
      const bytes = await readBoundedFile(sourcePath, {
        maxBytes: artifact.bytes,
        stage: "promotion",
        dimension: "generated_bytes",
        label: `Candidate artifact ${artifact.path}`,
        restartFrom: "candidate_build",
      });
      if (sha256(bytes) !== artifact.sha256) {
        throw new Error(`candidate artifact ${artifact.path} digest differs from the manifest`);
      }
      const stagingPath = contained(staging, resolve(staging, artifact.path), "staged artifact");
      const parentIdentity = await ensureOwnedDirectoryPath({
        rootPath: staging,
        directoryPath: dirname(stagingPath),
        rootIdentity: stagingIdentity,
        owners: [acceptedIdentity, artifactsIdentity, privateStagingIdentity],
        identitiesByPath: stagingDirectoriesByPath,
        createdDirectories: stagingDirectories,
      });
      for (const identity of stagingFiles) await assertFileIdentity(identity);
      await createOwnedFile(
        stagingPath,
        `staged_artifact.${artifact.path}`,
        bytes,
        [acceptedIdentity, artifactsIdentity, privateStagingIdentity, stagingIdentity, parentIdentity],
        { identities: stagingFiles },
      );
      for (const identity of stagingFiles) await assertFileIdentity(identity);
    }
    if (injectFault === "after_copy") throw new Error("injected promotion fault after candidate copy");
    const manifestBytes = Buffer.from(stableStringify(manifest), "utf8");
    await createOwnedFile(
      resolve(staging, "manifest.json"),
      "staged_manifest",
      manifestBytes,
      [acceptedIdentity, artifactsIdentity, privateStagingIdentity, stagingIdentity],
      { identities: stagingFiles },
    );
    await assertDirectoryIdentities([
      acceptedIdentity,
      artifactsIdentity,
      privateStagingIdentity,
      ...stagingDirectories,
    ]);
    for (const identity of stagingFiles) await assertFileIdentity(identity);
    await verifyExistingDestination(staging, manifest);
    await invokeFaultHook(injectFault, "before_candidate_rename", {
      acceptedRoot: accepted,
      artifactsRoot,
      staging,
      destination,
    });
    await assertDirectoryIdentities([
      acceptedIdentity,
      artifactsIdentity,
      privateStagingIdentity,
      ...stagingDirectories,
    ]);
    for (const identity of stagingFiles) await assertFileIdentity(identity);
    await verifyExistingDestination(staging, manifest);

    reservationIdentity = await acquireDestinationReservation({
      reservationPath,
      reservationBytes,
      destination,
      owners: [acceptedIdentity, artifactsIdentity],
    });
    if (reservationIdentity) {
      await assertOwnedFileBytes(
        reservationIdentity,
        reservationBytes,
        [acceptedIdentity, artifactsIdentity],
      );
    }
    const existingDestination = await lstat(destination).catch(error => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (existingDestination === null) {
      await assertDirectoryIdentities([
        acceptedIdentity,
        artifactsIdentity,
        privateStagingIdentity,
        ...stagingDirectories,
      ]);
      for (const identity of stagingFiles) await assertFileIdentity(identity);
      if (reservationIdentity) {
        await assertOwnedFileBytes(
          reservationIdentity,
          reservationBytes,
          [acceptedIdentity, artifactsIdentity],
        );
      }
      try {
        await rename(staging, destination);
        stagingPromoted = true;
      } catch (error) {
        if (!["EEXIST", "EISDIR", "ENOTDIR", "ENOTEMPTY"].includes(error.code)) throw error;
      }
    }
    if (stagingPromoted) {
      await removeOwnedEmptyDirectory(
        privateStagingIdentity,
        [acceptedIdentity, artifactsIdentity],
        { strict: true },
      );
      privateStagingIdentity = null;
    } else {
      await removeOwnedTree(
        privateStagingIdentity,
        [acceptedIdentity, artifactsIdentity],
        stagingDirectories,
        stagingFiles,
        { strict: true },
      );
      privateStagingIdentity = null;
      stagingIdentity = null;
    }
    const destinationIdentity = await requireRegularDirectory(destination, "accepted_destination", {
      acceptedCoordinate: digest,
    });
    await assertDirectoryIdentity(artifactsIdentity);
    await verifyExistingDestination(destination, manifest, { acceptedCoordinate: digest });
    const destinationFileIdentities = await captureAcceptedFileIdentities(destination, manifest);
    if (reservationIdentity) {
      await assertOwnedFileBytes(
        reservationIdentity,
        reservationBytes,
        [acceptedIdentity, artifactsIdentity],
      );
      let releasePrimaryError = null;
      try {
        await invokeFaultHook(injectFault, "before_reservation_release", {
          acceptedRoot: accepted,
          artifactsRoot,
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
          [acceptedIdentity, artifactsIdentity],
          digest,
        );
      } catch (cleanupError) {
        if (releasePrimaryError) {
          throw retainReservationCleanupFailure(releasePrimaryError, cleanupError, digest);
        }
        throw cleanupError;
      }
      if (releasePrimaryError) throw releasePrimaryError;
    }
    if (injectFault === "before_pointer") throw new Error("injected promotion fault before pointer update");
    const pointer = {
      acceptedDigest: digest,
      artifactDirectory: `artifacts/${digest}`,
      sourceDigest: manifest.sourceDigest,
    };
    const pointerBytes = Buffer.from(stableStringify(pointer), "utf8");
    await invokeFaultHook(injectFault, "before_pointer_reservation_acquire", {
      acceptedRoot: accepted,
      artifactsRoot,
      destination,
      pointerPath,
      pointerReservationPath,
    });
    pointerReservationIdentity = await acquirePointerReservation({
      reservationPath: pointerReservationPath,
      reservationBytes,
      owners: [acceptedIdentity],
    });
    let pointerPrimaryError = null;
    try {
      await assertOwnedFileBytes(pointerReservationIdentity, reservationBytes, [acceptedIdentity]);
      await invokeFaultHook(injectFault, "after_pointer_reservation_acquired", {
        acceptedRoot: accepted,
        artifactsRoot,
        destination,
        pointerPath,
        pointerReservationPath,
      });
      const disposition = await requirePointerCommitAuthority(
        pointerPath,
        acceptedIdentity,
        pointerExpectation,
        pointerBytes,
      );
      if (disposition === "commit") {
        temporaryPointer = contained(
          accepted,
          resolve(accepted, `.current-${process.pid}-${randomUUID()}.json`),
          "temporary accepted pointer",
        );
        await invokeFaultHook(injectFault, "before_pointer_write", {
          acceptedRoot: accepted,
          artifactsRoot,
          destination,
          pointerPath,
          temporaryPointer,
        });
        temporaryPointerIdentity = await createOwnedFile(
          temporaryPointer,
          "temporary_pointer",
          pointerBytes,
          [acceptedIdentity, artifactsIdentity, destinationIdentity],
        );
        if (injectFault === "after_pointer_write") throw new Error("injected promotion fault after pointer write");
        await invokeFaultHook(injectFault, "before_pointer_rename", {
          acceptedRoot: accepted,
          artifactsRoot,
          destination,
          pointerPath,
          temporaryPointer,
        });
        await assertDirectoryIdentities([acceptedIdentity, artifactsIdentity, destinationIdentity]);
        for (const identity of destinationFileIdentities) await assertFileIdentity(identity);
        await assertOwnedFileBytes(
          temporaryPointerIdentity,
          pointerBytes,
          [acceptedIdentity, artifactsIdentity, destinationIdentity],
        );
        await verifyExistingDestination(destination, manifest, { acceptedCoordinate: digest });
        await assertDirectoryIdentities([acceptedIdentity, artifactsIdentity, destinationIdentity]);
        for (const identity of destinationFileIdentities) await assertFileIdentity(identity);
        await assertOwnedFileBytes(
          temporaryPointerIdentity,
          pointerBytes,
          [acceptedIdentity, artifactsIdentity, destinationIdentity],
        );
        await assertOwnedFileBytes(
          pointerReservationIdentity,
          reservationBytes,
          [acceptedIdentity],
        );
        await rename(temporaryPointer, pointerPath);
        temporaryPointerIdentity = null;
      }
    } catch (error) {
      pointerPrimaryError = error;
    }
    const acquiredPointerReservation = pointerReservationIdentity;
    pointerReservationIdentity = null;
    try {
      await releasePointerReservation(acquiredPointerReservation, [acceptedIdentity], digest);
    } catch (cleanupError) {
      if (pointerPrimaryError) {
        throw retainReservationCleanupFailure(pointerPrimaryError, cleanupError, digest, {
          checkpoint: "pointer_reservation_release",
          cleanupBoundary: "pointer_reservation",
        });
      }
      throw cleanupError;
    }
    if (pointerPrimaryError) throw pointerPrimaryError;
    return pointer;
  } catch (error) {
    await removeOwnedFile(temporaryPointerIdentity, [acceptedIdentity]);
    let failure = error;
    if (pointerReservationIdentity) {
      try {
        await releasePointerReservation(pointerReservationIdentity, [acceptedIdentity], digest);
      } catch (cleanupError) {
        failure = retainReservationCleanupFailure(error, cleanupError, digest, {
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
          [acceptedIdentity, artifactsIdentity],
          digest,
        );
      } catch (cleanupError) {
        failure = retainReservationCleanupFailure(error, cleanupError, digest);
      }
      reservationIdentity = null;
    }
    if (stagingPromoted) {
      await removeOwnedEmptyDirectory(privateStagingIdentity, [acceptedIdentity, artifactsIdentity]);
    } else {
      await removeOwnedTree(
        privateStagingIdentity,
        [acceptedIdentity, artifactsIdentity],
        stagingDirectories,
        stagingFiles,
      );
    }
    const admittedFailure = admittedPipelineError(failure);
    if (admittedFailure) {
      throw new PipelineError(
        admittedFailure.code,
        admittedFailure.message,
        admittedFailure.details,
      );
    }
    throw new PipelineError(
      "PUBLICATION_FAILED",
      boundedOwnString(failure, "message", "Promotion stopped at a recoverable coordinate.", 4_096),
      {
        stage: "promotion",
        causeCode: boundedOwnString(failure, "code", "PUBLICATION_FAILED"),
        reason: boundedOwnString(failure, "message", "Promotion stopped at a recoverable coordinate.", 4_096),
        restartFrom: stagingPromoted ? "pointer" : "candidate",
      },
    );
  }
}

export async function readAcceptedPointer(acceptedRoot) {
  const accepted = resolve(acceptedRoot);
  if (await lstat(accepted).catch(() => null)) {
    await requireRegularDirectory(accepted, "accepted_root");
  }
  return JSON.parse((await readBoundedFile(resolve(accepted, "current.json"), {
    maxBytes: 4_096,
    stage: "accepted_pointer",
    dimension: "pointer_bytes",
    label: "Accepted pointer",
    restartFrom: "promotion",
  })).toString("utf8"));
}

export function assertSafeAcceptedDigest(value) {
  if (!digestPattern.test(value) || basename(value) !== value) {
    throw new Error("accepted digest must be one lowercase SHA-256 value");
  }
}
