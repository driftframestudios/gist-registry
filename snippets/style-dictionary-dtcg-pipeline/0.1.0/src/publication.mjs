import { randomUUID } from "node:crypto";
import { lstat, mkdir, opendir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import {
  DEFAULT_LIMITS,
  compareOrdinal,
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

function contained(root, candidate, label) {
  const owner = resolve(root);
  const path = resolve(candidate);
  if (path !== owner && !path.startsWith(`${owner}${sep}`)) {
    throw new Error(`${label} must remain inside ${owner}`);
  }
  return path;
}

function requireAllowedFields(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  for (const key in value) {
    if (Object.hasOwn(value, key) && !allowed.has(key)) throw new Error(`${label} contains unsupported field ${key}`);
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

  if (!Array.isArray(manifest.matrix)) throw new Error("candidate manifest matrix must be an array");
  requireSafeCount(manifest.matrix.length, "candidate manifest matrix coordinate count", DEFAULT_LIMITS.generatedFiles);
  for (const coordinate of manifest.matrix) {
    requireAllowedFields(coordinate, new Set(["brand", "mode"]), "candidate manifest matrix coordinate");
    requireBoundedString(coordinate.brand, "candidate manifest brand", 128);
    requireBoundedString(coordinate.mode, "candidate manifest mode", 128);
  }
  const matrixCoordinates = manifest.matrix.map(coordinate => `${coordinate.brand}-${coordinate.mode}`);
  if (new Set(matrixCoordinates).size !== matrixCoordinates.length) {
    throw new Error("candidate manifest matrix coordinates must be unique");
  }

  if (!Array.isArray(manifest.sourceInputs)) throw new Error("candidate manifest sourceInputs must be an array");
  requireSafeCount(manifest.sourceInputs.length, "candidate manifest source input count", DEFAULT_LIMITS.generatedFiles);
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

  if (!Array.isArray(manifest.artifacts)) throw new Error("candidate manifest artifacts must be an array");
  requireSafeCount(manifest.artifacts.length, "candidate manifest artifact count", DEFAULT_LIMITS.generatedFiles);
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

async function requireRegularDirectory(path, label) {
  const entry = await lstat(path).catch(() => null);
  if (!entry?.isDirectory() || entry.isSymbolicLink()) {
    throw new Error(`${label} must be a regular directory`);
  }
}

async function verifyExistingDestination(destination, manifest) {
  validateManifestEnvelope(manifest);
  await requireRegularDirectory(destination, "artifact destination integrity root");
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

export async function promoteCandidate({ candidateRoot, acceptedRoot, manifest, injectFault = null }) {
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
  const staging = contained(
    artifactsRoot,
    resolve(artifactsRoot, `.candidate-${digest}-${invocationId}`),
    "artifact staging",
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
  const acceptedEntry = await lstat(accepted).catch(() => null);
  if (acceptedEntry) await requireRegularDirectory(accepted, "accepted root");
  else await mkdir(accepted, { recursive: true });
  await requireRegularDirectory(accepted, "accepted root");
  const artifactsEntry = await lstat(artifactsRoot).catch(() => null);
  if (artifactsEntry) await requireRegularDirectory(artifactsRoot, "accepted artifacts root");
  else await mkdir(artifactsRoot, { recursive: true });
  await requireRegularDirectory(artifactsRoot, "accepted artifacts root");
  let temporaryPointer = null;
  try {
    await mkdir(staging, { recursive: true });
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
      await mkdir(dirname(stagingPath), { recursive: true });
      await writeFile(stagingPath, bytes, { flag: "wx" });
    }
    if (injectFault === "after_copy") throw new Error("injected promotion fault after candidate copy");
    await writeFile(resolve(staging, "manifest.json"), stableStringify(manifest), "utf8");
    await verifyExistingDestination(staging, manifest);
    try {
      await rename(staging, destination);
    } catch (error) {
      if (!["EEXIST", "EISDIR", "ENOTDIR", "ENOTEMPTY"].includes(error.code)) throw error;
      await rm(staging, { recursive: true, force: true });
      await verifyExistingDestination(destination, manifest);
    }
    if (injectFault === "before_pointer") throw new Error("injected promotion fault before pointer update");
    const pointer = {
      acceptedDigest: digest,
      artifactDirectory: `artifacts/${digest}`,
      sourceDigest: manifest.sourceDigest,
    };
    temporaryPointer = contained(
      accepted,
      resolve(accepted, `.current-${process.pid}-${randomUUID()}.json`),
      "temporary accepted pointer",
    );
    await writeFile(temporaryPointer, stableStringify(pointer), "utf8");
    if (injectFault === "after_pointer_write") throw new Error("injected promotion fault after pointer write");
    await rename(temporaryPointer, resolve(accepted, "current.json"));
    return pointer;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (temporaryPointer) await rm(temporaryPointer, { force: true });
    throw error;
  }
}

export async function readAcceptedPointer(acceptedRoot) {
  return JSON.parse((await readBoundedFile(resolve(acceptedRoot, "current.json"), {
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
