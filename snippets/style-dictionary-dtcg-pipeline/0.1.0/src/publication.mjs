import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, opendir, rename, rm, rmdir } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import {
  DEFAULT_LIMITS,
  compareOrdinal,
  PipelineError,
  readBoundedFile,
  sha256,
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

function publicationBoundaryError(boundary, reason) {
  return new PipelineError(
    "PUBLICATION_BOUNDARY_INVALID",
    "Promotion requires stable, directly addressed regular directories.",
    { stage: "promotion", boundary, reason, restartFrom: "promotion" },
  );
}

async function requireRegularDirectory(path, boundary, { create = false, recursive = false } = {}) {
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
    throw publicationBoundaryError(boundary, error.code ?? "unreadable");
  }
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw publicationBoundaryError(boundary, "regular_directory_required");
  }
  return { path, boundary, dev: entry.dev, ino: entry.ino };
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
    throw publicationBoundaryError(identity.boundary, "file_bytes_changed");
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
        throw publicationBoundaryError("destination_reservation", readError.code ?? "unreadable");
      });
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

async function verifyExistingDestination(destination, manifest) {
  validateManifestEnvelope(manifest);
  await requireRegularDirectory(destination, "accepted_destination");
  const manifestPath = contained(destination, resolve(destination, "manifest.json"), "accepted manifest");
  const manifestEntry = await lstat(manifestPath).catch(() => null);
  if (!manifestEntry?.isFile() || manifestEntry.isSymbolicLink()) {
    throw new Error("artifact destination integrity mismatch: manifest.json must be a regular file");
  }
  let stored;
  try {
    stored = JSON.parse((await readBoundedFile(manifestPath, {
      maxBytes: DEFAULT_LIMITS.sourceBytes,
      stage: "accepted_verification",
      dimension: "manifest_bytes",
      label: "Accepted manifest",
      restartFrom: "promotion",
    })).toString("utf8"));
  } catch (error) {
    throw new Error(`artifact destination integrity mismatch: manifest.json is invalid: ${error.message}`);
  }
  if (stableStringify(stored) !== stableStringify(manifest)) {
    throw new Error("artifact destination integrity mismatch: manifest differs from the candidate");
  }

  const expectedPaths = ["manifest.json", ...manifest.artifacts.map(artifact => artifact.path)].sort(compareOrdinal);
  const observedPaths = await regularFileInventory(destination);
  if (stableStringify(observedPaths) !== stableStringify(expectedPaths)) {
    throw new Error("artifact destination integrity mismatch: file inventory differs from the manifest");
  }
  for (const artifact of manifest.artifacts) {
    const path = contained(destination, resolve(destination, artifact.path), "accepted artifact");
    const entry = await lstat(path).catch(() => null);
    if (!entry?.isFile() || entry.isSymbolicLink()) {
      throw new Error(`artifact destination integrity mismatch: ${artifact.path} must be a regular file`);
    }
    const bytes = await readBoundedFile(path, {
      maxBytes: artifact.bytes,
      stage: "accepted_verification",
      dimension: "generated_bytes",
      label: `Accepted artifact ${artifact.path}`,
      restartFrom: "promotion",
    });
    if (bytes.byteLength !== artifact.bytes || sha256(bytes) !== artifact.sha256) {
      throw new Error(`artifact destination integrity mismatch: ${artifact.path} bytes differ from the manifest`);
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
  const stagingDirectories = [];
  const stagingFiles = [];
  const stagingDirectoriesByPath = new Map();
  let temporaryPointer = null;
  let temporaryPointerIdentity = null;
  let reservationIdentity = null;
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
    const destinationIdentity = await requireRegularDirectory(destination, "accepted_destination");
    await assertDirectoryIdentity(artifactsIdentity);
    await verifyExistingDestination(destination, manifest);
    const destinationFileIdentities = await captureAcceptedFileIdentities(destination, manifest);
    if (reservationIdentity) {
      await assertOwnedFileBytes(
        reservationIdentity,
        reservationBytes,
        [acceptedIdentity, artifactsIdentity],
      );
      await removeOwnedFile(
        reservationIdentity,
        [acceptedIdentity, artifactsIdentity],
        { strict: true },
      );
      reservationIdentity = null;
    }
    if (injectFault === "before_pointer") throw new Error("injected promotion fault before pointer update");
    const pointer = {
      acceptedDigest: digest,
      artifactDirectory: `artifacts/${digest}`,
      sourceDigest: manifest.sourceDigest,
    };
    const pointerBytes = Buffer.from(stableStringify(pointer), "utf8");
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
    await verifyExistingDestination(destination, manifest);
    await assertDirectoryIdentities([acceptedIdentity, artifactsIdentity, destinationIdentity]);
    for (const identity of destinationFileIdentities) await assertFileIdentity(identity);
    await assertOwnedFileBytes(
      temporaryPointerIdentity,
      pointerBytes,
      [acceptedIdentity, artifactsIdentity, destinationIdentity],
    );
    await rename(temporaryPointer, pointerPath);
    return pointer;
  } catch (error) {
    await removeOwnedFile(temporaryPointerIdentity, [acceptedIdentity]);
    await removeOwnedFile(reservationIdentity, [acceptedIdentity, artifactsIdentity]);
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
    throw error;
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
