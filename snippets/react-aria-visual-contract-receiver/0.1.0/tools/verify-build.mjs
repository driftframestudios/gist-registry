import "../node-runtime-admission.mjs";

import { isDirectNodeInvocation } from "../node-cli-entrypoint.mjs";

import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {constants as fsConstants} from "node:fs";
import {lstat, mkdir, mkdtemp, open, rename, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {basename, dirname, extname, isAbsolute, join, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {gzipSync} from "node:zlib";
import {build} from "vite";
import {RECEIVER_TRANSITIONS, SPECIMENS} from "../src/model.mjs";
import {
  BuildBoundaryError,
  hashBoundedRegularFile,
  inventoryRegularFiles,
  readBoundedJson,
  readBoundedRegularFile
} from "./bounded-files.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../../..");
const artifactsRoot = resolve(repositoryRoot, ".artifacts/react-aria-visual-contract-receiver");
const bootstrapConfigurationBytes = 100_000;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function evidenceBoundaryError(boundary, reason) {
  return new BuildBoundaryError(
    "EVIDENCE_OUTPUT_BOUNDARY_INVALID",
    "Build evidence requires a stable, directly owned output boundary.",
    {boundary, reason}
  );
}

function containedPath(root, candidate, boundary) {
  const pathFromRoot = relative(root, candidate);
  if (
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw evidenceBoundaryError(boundary, "path_outside_owner");
  }
  return pathFromRoot;
}

async function requireDirectoryIdentity(path, boundary) {
  let entry;
  try {
    entry = await lstat(path);
  } catch (error) {
    throw evidenceBoundaryError(boundary, error.code ?? "unreadable");
  }
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw evidenceBoundaryError(boundary, "regular_directory_required");
  }
  return {path, boundary, dev: entry.dev, ino: entry.ino};
}

async function assertDirectoryIdentity(identity) {
  const current = await requireDirectoryIdentity(identity.path, identity.boundary);
  if (current.dev !== identity.dev || current.ino !== identity.ino) {
    throw evidenceBoundaryError(identity.boundary, "directory_identity_changed");
  }
}

async function assertDirectoryIdentities(identities) {
  for (const identity of identities) await assertDirectoryIdentity(identity);
}

async function requireFileIdentity(path, boundary) {
  let entry;
  try {
    entry = await lstat(path);
  } catch (error) {
    throw evidenceBoundaryError(boundary, error.code ?? "unreadable");
  }
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw evidenceBoundaryError(boundary, "regular_file_required");
  }
  return {path, boundary, dev: entry.dev, ino: entry.ino, size: entry.size};
}

async function assertFileIdentity(identity, expectedBytes = null) {
  const current = await requireFileIdentity(identity.path, identity.boundary);
  if (
    current.dev !== identity.dev ||
    current.ino !== identity.ino ||
    (expectedBytes !== null && current.size !== expectedBytes)
  ) {
    throw evidenceBoundaryError(identity.boundary, "file_identity_changed");
  }
}

async function assertFileBytes(identity, expectedBytes, expectedSha256) {
  let handle;
  try {
    handle = await open(
      identity.path,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
    );
  } catch (error) {
    throw evidenceBoundaryError(identity.boundary, error.code ?? "unreadable");
  }

  let primaryError = null;
  try {
    const current = await handle.stat();
    if (
      !current.isFile() ||
      current.dev !== identity.dev ||
      current.ino !== identity.ino ||
      current.size !== expectedBytes
    ) {
      throw evidenceBoundaryError(identity.boundary, "file_identity_changed");
    }

    const digest = createHash("sha256");
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(1, expectedBytes)));
    let offset = 0;
    while (offset < expectedBytes) {
      const length = Math.min(chunk.byteLength, expectedBytes - offset);
      const {bytesRead} = await handle.read(chunk, 0, length, offset);
      if (bytesRead === 0) {
        throw evidenceBoundaryError(identity.boundary, "file_bytes_changed");
      }
      digest.update(chunk.subarray(0, bytesRead));
      offset += bytesRead;
    }
    if (digest.digest("hex") !== expectedSha256) {
      throw evidenceBoundaryError(identity.boundary, "file_bytes_changed");
    }
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await handle.close();
    } catch (error) {
      if (primaryError === null) {
        throw evidenceBoundaryError(identity.boundary, error.code ?? "close_failed");
      }
    }
  }
}

async function invokeEvidenceHook(injectFault, checkpoint, details) {
  if (typeof injectFault === "function") {
    await injectFault({checkpoint, ...details});
  }
}

async function prepareEvidenceDirectory(ownerRoot, outputDirectory, injectFault) {
  const owner = resolve(ownerRoot);
  const output = resolve(outputDirectory);
  const pathFromOwner = containedPath(owner, output, "evidence_output");
  const identities = [await requireDirectoryIdentity(owner, "evidence_owner")];
  await invokeEvidenceHook(injectFault, "after_owner_capture", {ownerRoot: owner, outputDirectory: output});
  await assertDirectoryIdentities(identities);

  let current = owner;
  for (const segment of pathFromOwner.split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    await assertDirectoryIdentities(identities);
    try {
      await mkdir(current, {mode: 0o700});
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw evidenceBoundaryError(`evidence_directory.${relative(owner, current)}`, error.code ?? "create_failed");
      }
    }
    const identity = await requireDirectoryIdentity(
      current,
      `evidence_directory.${relative(owner, current).split(sep).join("/")}`
    );
    identities.push(identity);
    await invokeEvidenceHook(injectFault, "after_directory_capture", {
      ownerRoot: owner,
      outputDirectory: output,
      directoryPath: current,
      relativeDirectory: relative(owner, current).split(sep).join("/")
    });
    await assertDirectoryIdentities(identities);
  }
  return identities;
}

/**
 * Replace one evidence leaf inside a repository-owned directory path.
 * The caller supplies the stable owner; this writer creates each descendant
 * itself, captures directory identities, stages through a no-follow exclusive
 * file, then rechecks every owner immediately around the atomic rename.
 */
export async function writeEvidenceOutput({
  ownerRoot,
  outputDirectory,
  fileName,
  bytes,
  injectFault = null
}) {
  if (basename(fileName) !== fileName || fileName === "." || fileName === "..") {
    throw evidenceBoundaryError("evidence_leaf", "plain_file_name_required");
  }
  const payload = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const payloadSha256 = sha256(payload);
  const output = resolve(outputDirectory);
  const destination = resolve(output, fileName);
  containedPath(output, destination, "evidence_leaf");
  const owners = await prepareEvidenceDirectory(ownerRoot, output, injectFault);

  const existing = await lstat(destination).catch(error => {
    if (error.code === "ENOENT") return null;
    throw evidenceBoundaryError("evidence_leaf", error.code ?? "unreadable");
  });
  let existingIdentity = null;
  if (existing) {
    if (!existing.isFile() || existing.isSymbolicLink()) {
      throw evidenceBoundaryError("evidence_leaf", "regular_file_required");
    }
    existingIdentity = {
      path: destination,
      boundary: "evidence_leaf",
      dev: existing.dev,
      ino: existing.ino,
      size: existing.size
    };
  }

  const temporaryPath = resolve(output, `.${fileName}.${randomUUID()}.tmp`);
  let handle;
  let temporaryIdentity = null;
  let primaryError = null;
  try {
    await assertDirectoryIdentities(owners);
    handle = await open(
      temporaryPath,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        (fsConstants.O_NOFOLLOW ?? 0),
      0o600
    );
    const opened = await handle.stat();
    if (!opened.isFile()) throw evidenceBoundaryError("evidence_temporary", "regular_file_required");
    temporaryIdentity = {
      path: temporaryPath,
      boundary: "evidence_temporary",
      dev: opened.dev,
      ino: opened.ino,
      size: payload.byteLength
    };
    await handle.writeFile(payload);
    await handle.sync();
    const settled = await handle.stat();
    if (
      !settled.isFile() ||
      settled.dev !== temporaryIdentity.dev ||
      settled.ino !== temporaryIdentity.ino ||
      settled.size !== payload.byteLength
    ) {
      throw evidenceBoundaryError("evidence_temporary", "file_identity_changed_during_write");
    }
    await handle.close();
    handle = null;

    await assertDirectoryIdentities(owners);
    await assertFileIdentity(temporaryIdentity, payload.byteLength);
    await invokeEvidenceHook(injectFault, "before_rename", {
      ownerRoot: resolve(ownerRoot),
      outputDirectory: output,
      destination,
      temporaryPath
    });
    await assertDirectoryIdentities(owners);
    await assertFileBytes(temporaryIdentity, payload.byteLength, payloadSha256);

    const currentDestination = await lstat(destination).catch(error => {
      if (error.code === "ENOENT") return null;
      throw evidenceBoundaryError("evidence_leaf", error.code ?? "unreadable");
    });
    if (existingIdentity) {
      if (
        !currentDestination?.isFile() ||
        currentDestination.isSymbolicLink() ||
        currentDestination.dev !== existingIdentity.dev ||
        currentDestination.ino !== existingIdentity.ino
      ) {
        throw evidenceBoundaryError("evidence_leaf", "file_identity_changed");
      }
    } else if (currentDestination) {
      throw evidenceBoundaryError("evidence_leaf", "destination_appeared");
    }

    await rename(temporaryPath, destination);
    temporaryIdentity = {...temporaryIdentity, path: destination, boundary: "evidence_leaf"};
    await invokeEvidenceHook(injectFault, "after_rename", {
      ownerRoot: resolve(ownerRoot),
      outputDirectory: output,
      destination
    });
    await assertDirectoryIdentities(owners);
    await assertFileBytes(temporaryIdentity, payload.byteLength, payloadSha256);
    return destination;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch (error) {
        if (primaryError === null) throw evidenceBoundaryError("evidence_temporary", error.code ?? "close_failed");
      }
    }
    if (temporaryIdentity?.path === temporaryPath) {
      const entry = await lstat(temporaryPath).catch(() => null);
      if (
        entry?.isFile() &&
        !entry.isSymbolicLink() &&
        entry.dev === temporaryIdentity.dev &&
        entry.ino === temporaryIdentity.ino
      ) {
        await rm(temporaryPath).catch(() => {});
      }
    }
  }
}

async function readJson(path, maxBytes, label) {
  return readBoundedJson(path, {maxBytes, label});
}

function mediaType(path) {
  return ({
    ".css": "text/css",
    ".html": "text/html",
    ".js": "text/javascript",
    ".map": "application/json"
  })[extname(path)] ?? "application/octet-stream";
}

async function compile(outDir, resourceLimits, completeBuildBytes) {
  await build({
    root: packageRoot,
    configFile: resolve(packageRoot, "vite.config.mjs"),
    logLevel: "silent",
    build: {outDir, emptyOutDir: true}
  });

  const inventory = await inventoryRegularFiles(outDir, {
    maxEntries: resourceLimits.buildEntryCount,
    maxDepth: resourceLimits.buildDirectoryDepth
  });
  const files = [];
  let observedBuildBytes = 0;
  for (const path of inventory.files) {
    const remainingBuildBytes = completeBuildBytes - observedBuildBytes;
    const file = await hashBoundedRegularFile(resolve(outDir, path), {
      maxBytes: Math.min(resourceLimits.buildFileBytes, Math.max(remainingBuildBytes, 0)),
      label: `build artifact ${path}`
    });
    observedBuildBytes += file.bytes;
    files.push({path, mediaType: mediaType(path), ...file});
  }
  return {schemaVersion: "0.1.0", files};
}

async function authoredSourceBytes(paths, resourceLimits, maxTotalBytes) {
  let total = 0;
  for (const path of paths) {
    const source = await hashBoundedRegularFile(resolve(packageRoot, path), {
      maxBytes: Math.min(
        resourceLimits.authoredSourceFileBytes,
        Math.max(maxTotalBytes - total, 0)
      ),
      label: `authored source ${path}`
    });
    total += source.bytes;
  }
  return total;
}

async function measurements(manifest, budgets, buildDirectory) {
  const packageJson = await readJson(
    resolve(packageRoot, "package.json"),
    budgets.resourceLimits.configurationBytes,
    "package manifest"
  );
  const packageLock = await readJson(
    resolve(packageRoot, "package-lock.json"),
    budgets.resourceLimits.configurationBytes,
    "package lock"
  );
  const javascript = manifest.files.filter(file => extname(file.path) === ".js");
  const runtime = manifest.files.filter(file => extname(file.path) !== ".map");
  const sourceMaps = manifest.files.filter(file => extname(file.path) === ".map");
  assert.equal(javascript.length, 1, "the receiver build must emit one JavaScript entry asset");
  const javascriptBytes = await readBoundedRegularFile(
    resolve(buildDirectory, javascript[0].path),
    {
      maxBytes: Math.min(
        budgets.resourceLimits.buildFileBytes,
        budgets.thresholds.runtimeJavaScriptBytes
      ),
      label: `runtime JavaScript ${javascript[0].path}`
    }
  );

  return {
    authoredSourceBytes: await authoredSourceBytes(
      budgets.authoredSourcePaths,
      budgets.resourceLimits,
      budgets.thresholds.authoredSourceBytes
    ),
    directDependencyCount:
      Object.keys(packageJson.dependencies ?? {}).length +
      Object.keys(packageJson.devDependencies ?? {}).length,
    resolvedPackageCount: Object.keys(packageLock.packages ?? {}).length,
    specimenCount: SPECIMENS.length,
    transitionOperationCount: Object.keys(RECEIVER_TRANSITIONS).length,
    runtimeJavaScriptBytes: javascript.reduce((sum, file) => sum + file.bytes, 0),
    runtimeJavaScriptGzipBytes: gzipSync(javascriptBytes, {level: 9}).length,
    runtimeAssetBytes: runtime.reduce((sum, file) => sum + file.bytes, 0),
    sourceMapBytes: sourceMaps.reduce((sum, file) => sum + file.bytes, 0),
    completeBuildBytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0)
  };
}

function checkResourceLimits(resourceLimits) {
  const names = [
    "authoredSourceFileBytes",
    "buildDirectoryDepth",
    "buildEntryCount",
    "buildFileBytes",
    "configurationBytes"
  ];
  assert.deepEqual(Object.keys(resourceLimits).sort(), names);
  for (const name of names) {
    assert.ok(
      Number.isSafeInteger(resourceLimits[name]) && resourceLimits[name] > 0,
      `${name} must carry a positive safe-integer envelope`
    );
  }
}

function checkRouteInventory(manifest) {
  const paths = new Set(manifest.files.map(file => file.path));
  for (const path of [
    "receiver-entry.html",
    "source/native-receiver.html",
    "source/semantic-reading.html"
  ]) {
    assert.ok(paths.has(path), `the production build must carry ${path}`);
  }
}

function checkThresholds(observed, thresholds) {
  assert.deepEqual(
    Object.keys(observed).sort(),
    Object.keys(thresholds).sort(),
    "every measurement must have one explicit review threshold"
  );
  for (const [name, value] of Object.entries(observed)) {
    assert.ok(
      value <= thresholds[name],
      `${name} ${value} exceeds review threshold ${thresholds[name]}`
    );
  }
}

function gzipMeasurementCoordinate() {
  return {
    node: process.versions.node,
    zlib: process.versions.zlib,
    platform: process.platform,
    architecture: process.arch,
    format: "gzip",
    level: 9
  };
}

function checkExpectedMeasurements(observed, expected, thresholds) {
  const deterministic = expected.deterministicMeasurements;
  const profiled = expected.profiledMeasurements;
  assert.ok(deterministic && typeof deterministic === "object" && !Array.isArray(deterministic));
  assert.ok(profiled && typeof profiled === "object" && !Array.isArray(profiled));

  const declared = [...Object.keys(deterministic), ...Object.keys(profiled)].sort();
  assert.equal(new Set(declared).size, declared.length, "measurement owners must remain distinct");
  assert.deepEqual(declared, Object.keys(observed).sort(), "each measurement requires one comparison owner");
  assert.deepEqual(declared, Object.keys(thresholds).sort(), "each measurement requires one review threshold");

  for (const [name, value] of Object.entries(deterministic)) {
    assert.equal(observed[name], value, `${name} changed from its deterministic baseline`);
  }

  const currentCoordinates = {
    runtimeJavaScriptGzipBytes: gzipMeasurementCoordinate()
  };
  for (const [name, baseline] of Object.entries(profiled)) {
    assert.ok(Number.isFinite(baseline.observed) && baseline.observed > 0, `${name} requires a finite reviewed observation`);
    assert.ok(baseline.coordinate && typeof baseline.coordinate === "object" && !Array.isArray(baseline.coordinate), `${name} requires a measurement coordinate`);
    assert.ok(currentCoordinates[name], `${name} requires an executable coordinate owner`);
    if (canonicalJson(baseline.coordinate) === canonicalJson(currentCoordinates[name])) {
      assert.equal(observed[name], baseline.observed, `${name} changed at its reviewed measurement coordinate`);
    }
  }
}

export async function verifyBuild() {
  const budgets = await readJson(
    resolve(packageRoot, "config/build-budgets.json"),
    bootstrapConfigurationBytes,
    "build budget contract"
  );
  const expected = await readJson(
    resolve(packageRoot, "expected/build-budget-contract.json"),
    bootstrapConfigurationBytes,
    "expected build contract"
  );
  const temporaryRoot = await mkdtemp(join(tmpdir(), "visual-contract-receiver-"));
  const firstBuildDirectory = resolve(temporaryRoot, "first");
  const secondBuildDirectory = resolve(temporaryRoot, "second");
  const startedAt = process.hrtime.bigint();

  try {
    checkResourceLimits(budgets.resourceLimits);
    const first = await compile(
      firstBuildDirectory,
      budgets.resourceLimits,
      budgets.thresholds.completeBuildBytes
    );
    const second = await compile(
      secondBuildDirectory,
      budgets.resourceLimits,
      budgets.thresholds.completeBuildBytes
    );
    assert.deepEqual(second, first, "two clean builds must produce byte-identical manifests");
    checkRouteInventory(first);

    const deterministicManifestSha256 = sha256(canonicalJson(first));
    const observed = await measurements(first, budgets, firstBuildDirectory);
    checkThresholds(observed, budgets.thresholds);
    assert.equal(expected.coordinate, budgets.coordinate);
    assert.equal(expected.deterministicManifestSha256, deterministicManifestSha256);
    checkExpectedMeasurements(observed, expected, budgets.thresholds);

    const elapsedMilliseconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const receipt = {
      schemaVersion: "0.1.0",
      coordinate: budgets.coordinate,
      deterministicManifestSha256,
      manifest: first,
      measurements: observed,
      measurementCoordinates: {
        runtimeJavaScriptGzipBytes: gzipMeasurementCoordinate()
      },
      thresholds: budgets.thresholds,
      observation: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
        elapsedMilliseconds: Number(elapsedMilliseconds.toFixed(3)),
        peakRssBytes: process.resourceUsage().maxRSS * 1024
      }
    };
    await writeEvidenceOutput({
      ownerRoot: repositoryRoot,
      outputDirectory: artifactsRoot,
      fileName: "last-receipt.json",
      bytes: canonicalJson(receipt)
    });
    console.log(canonicalJson(receipt));
    return receipt;
  } finally {
    await rm(temporaryRoot, {recursive: true, force: true});
  }
}

if (isDirectNodeInvocation(import.meta.url)) {
  await verifyBuild();
}
