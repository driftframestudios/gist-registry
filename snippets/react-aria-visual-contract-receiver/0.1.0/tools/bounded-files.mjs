import {constants as fsConstants} from "node:fs";
import {lstat, open, opendir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {isAbsolute, relative, resolve, sep} from "node:path";

const HASH_CHUNK_BYTES = 64 * 1024;
const NO_FOLLOW = fsConstants.O_NOFOLLOW ?? 0;

export class BuildBoundaryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "BuildBoundaryError";
    this.code = code;
    this.details = Object.freeze({...details});
  }
}

function assertNonNegativeSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer.`);
  }
}

function boundaryError(code, message, details) {
  return new BuildBoundaryError(code, message, details);
}

function assertContainedPath(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  if (
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw boundaryError(
      "PATH_OUTSIDE_ROOT",
      `Build inventory path escaped its declared root: ${candidate}`,
      {root, candidate}
    );
  }
  return pathFromRoot;
}

function assertRegularPath(path, stat, label) {
  if (stat.isSymbolicLink()) {
    throw boundaryError(
      "SYMLINK_FORBIDDEN",
      `${label} must resolve from a directly owned regular file: ${path}`,
      {path, label}
    );
  }
  if (!stat.isFile()) {
    throw boundaryError(
      "REGULAR_FILE_REQUIRED",
      `${label} must be a regular file: ${path}`,
      {path, label}
    );
  }
}

function assertFileIdentity(path, pathStat, descriptorStat, label) {
  if (pathStat.dev !== descriptorStat.dev || pathStat.ino !== descriptorStat.ino) {
    throw boundaryError(
      "FILE_IDENTITY_CHANGED",
      `${label} changed identity while its descriptor was opening: ${path}`,
      {path, label}
    );
  }
}

function assertStableDescriptor(path, initialStat, finalStat, observedBytes, label) {
  const changed =
    finalStat.dev !== initialStat.dev ||
    finalStat.ino !== initialStat.ino ||
    finalStat.size !== initialStat.size ||
    finalStat.mtimeMs !== initialStat.mtimeMs ||
    finalStat.ctimeMs !== initialStat.ctimeMs ||
    observedBytes !== initialStat.size;

  if (changed) {
    throw boundaryError(
      "FILE_CHANGED_DURING_READ",
      `${label} changed while its bounded descriptor was being read: ${path}`,
      {
        path,
        label,
        expectedBytes: initialStat.size,
        observedBytes,
        finalBytes: finalStat.size
      }
    );
  }
}

async function assertStablePath(path, initialStat, label) {
  const finalPathStat = await lstat(path);
  assertRegularPath(path, finalPathStat, label);
  assertFileIdentity(path, initialStat, finalPathStat, label);
}

async function acquireBoundedRegularFile(path, {maxBytes, label}) {
  assertNonNegativeSafeInteger(maxBytes, "maxBytes");
  const pathStat = await lstat(path);
  assertRegularPath(path, pathStat, label);
  if (!Number.isSafeInteger(pathStat.size) || pathStat.size > maxBytes) {
    throw boundaryError(
      "FILE_SIZE_EXCEEDED",
      `${label} is ${pathStat.size} bytes; the read envelope allows ${maxBytes}: ${path}`,
      {path, label, bytes: pathStat.size, maxBytes}
    );
  }

  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | NO_FOLLOW);
    const descriptorStat = await handle.stat();
    assertRegularPath(path, descriptorStat, label);
    assertFileIdentity(path, pathStat, descriptorStat, label);
    if (!Number.isSafeInteger(descriptorStat.size) || descriptorStat.size > maxBytes) {
      throw boundaryError(
        "FILE_SIZE_EXCEEDED",
        `${label} is ${descriptorStat.size} bytes; the read envelope allows ${maxBytes}: ${path}`,
        {path, label, bytes: descriptorStat.size, maxBytes}
      );
    }
    return {handle, stat: descriptorStat};
  } catch (error) {
    await handle?.close().catch(() => {});
    throw error;
  }
}

async function closeHandle(handle, primaryError) {
  try {
    await handle.close();
  } catch (closeError) {
    if (!primaryError) throw closeError;
  }
}

export async function inventoryRegularFiles(rootPath, {maxEntries, maxDepth}) {
  assertNonNegativeSafeInteger(maxEntries, "maxEntries");
  assertNonNegativeSafeInteger(maxDepth, "maxDepth");

  const root = resolve(rootPath);
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw boundaryError(
      "DIRECTORY_ROOT_REQUIRED",
      `Build inventory root must be a directly owned directory: ${root}`,
      {root}
    );
  }

  const pending = [{directory: root, depth: 0}];
  const files = [];
  let entryCount = 0;

  for (let index = 0; index < pending.length; index += 1) {
    const {directory, depth} = pending[index];
    const entries = await opendir(directory);
    for await (const entry of entries) {
      entryCount += 1;
      if (entryCount > maxEntries) {
        throw boundaryError(
          "ENTRY_COUNT_EXCEEDED",
          `Build inventory contains more than ${maxEntries} entries: ${root}`,
          {root, maxEntries, observedEntries: entryCount}
        );
      }

      const entryDepth = depth + 1;
      if (entryDepth > maxDepth) {
        throw boundaryError(
          "DIRECTORY_DEPTH_EXCEEDED",
          `Build inventory exceeds depth ${maxDepth}: ${entry.name}`,
          {root, maxDepth, observedDepth: entryDepth}
        );
      }

      const path = resolve(directory, entry.name);
      const pathFromRoot = assertContainedPath(root, path);
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) {
        throw boundaryError(
          "SYMLINK_FORBIDDEN",
          `Build inventory accepts directly owned files and directories: ${path}`,
          {root, path}
        );
      }
      if (stat.isDirectory()) {
        pending.push({directory: path, depth: entryDepth});
      } else if (stat.isFile()) {
        files.push(pathFromRoot.replaceAll(sep, "/"));
      } else {
        throw boundaryError(
          "REGULAR_ENTRY_REQUIRED",
          `Build inventory accepts regular files and directories: ${path}`,
          {root, path}
        );
      }
    }
  }

  return Object.freeze({
    entryCount,
    files: Object.freeze(files.sort())
  });
}

export async function readBoundedRegularFile(path, {maxBytes, label = "file"}) {
  const {handle, stat} = await acquireBoundedRegularFile(path, {maxBytes, label});
  let primaryError;
  try {
    const bytes = Buffer.allocUnsafe(stat.size);
    let observedBytes = 0;
    while (observedBytes < stat.size) {
      const read = await handle.read(
        bytes,
        observedBytes,
        stat.size - observedBytes,
        null
      );
      if (read.bytesRead === 0) break;
      observedBytes += read.bytesRead;
    }

    const overflow = Buffer.allocUnsafe(1);
    const overflowRead = await handle.read(overflow, 0, 1, null);
    observedBytes += overflowRead.bytesRead;
    const finalStat = await handle.stat();
    assertStableDescriptor(path, stat, finalStat, observedBytes, label);
    await assertStablePath(path, stat, label);
    return bytes;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await closeHandle(handle, primaryError);
  }
}

export async function hashBoundedRegularFile(path, {maxBytes, label = "file"}) {
  const {handle, stat} = await acquireBoundedRegularFile(path, {maxBytes, label});
  let primaryError;
  try {
    const digest = createHash("sha256");
    const chunk = Buffer.allocUnsafe(Math.min(HASH_CHUNK_BYTES, Math.max(stat.size, 1)));
    let observedBytes = 0;
    while (observedBytes < stat.size) {
      const requestedBytes = Math.min(chunk.length, stat.size - observedBytes);
      const read = await handle.read(chunk, 0, requestedBytes, null);
      if (read.bytesRead === 0) break;
      digest.update(chunk.subarray(0, read.bytesRead));
      observedBytes += read.bytesRead;
    }

    const overflow = Buffer.allocUnsafe(1);
    const overflowRead = await handle.read(overflow, 0, 1, null);
    observedBytes += overflowRead.bytesRead;
    const finalStat = await handle.stat();
    assertStableDescriptor(path, stat, finalStat, observedBytes, label);
    await assertStablePath(path, stat, label);
    return Object.freeze({
      bytes: observedBytes,
      sha256: digest.digest("hex")
    });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await closeHandle(handle, primaryError);
  }
}

export async function readBoundedJson(path, options) {
  const bytes = await readBoundedRegularFile(path, options);
  return JSON.parse(bytes.toString("utf8"));
}
