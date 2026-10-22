import "./node-runtime-guard.mjs";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { isDirectNodeInvocation } from "./node-cli-entrypoint.mjs";

const modulePath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(modulePath), "..");
const semverPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const semanticIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const mediaTypePattern = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.ok(value.trim(), `${label} must not be empty`);
}

function safeRelativePath(value, label) {
  requireString(value, label);
  assert.equal(value.startsWith("/"), false, `${label} must be owner-relative`);
  assert.equal(value.includes("\\"), false, `${label} must use forward slashes`);
  assert.equal(value.split("/").includes(".."), false, `${label} must stay inside its owner`);
}

function safeManifestReference(value, label) {
  requireString(value, label);
  assert.equal(value.startsWith("/"), false, `${label} must be manifest-relative`);
  assert.equal(value.includes("\\"), false, `${label} must use forward slashes`);
}

function assertInside(ownerRoot, path, label) {
  const resolvedOwner = resolve(ownerRoot);
  const resolvedPath = resolve(path);
  assert.ok(
    resolvedPath === resolvedOwner || resolvedPath.startsWith(`${resolvedOwner}${sep}`),
    `${label} must resolve inside ${resolvedOwner}`,
  );
  return resolvedPath;
}

async function requireRegularFile(ownerRoot, path, label) {
  const lexicalPath = assertInside(ownerRoot, path, label);
  const entry = await lstat(lexicalPath).catch(() => null);
  assert.ok(entry, `${label} is unavailable`);
  assert.equal(entry.isSymbolicLink(), false, `${label} must not be a symbolic link`);
  assert.ok(entry.isFile(), `${label} must be a regular file`);
  const [physicalOwner, physicalPath] = await Promise.all([realpath(ownerRoot), realpath(lexicalPath)]);
  assertInside(physicalOwner, physicalPath, `${label} physical path`);
  return lexicalPath;
}

async function requireDirectory(ownerRoot, path, label) {
  const lexicalPath = assertInside(ownerRoot, path, label);
  const entry = await lstat(lexicalPath).catch(() => null);
  assert.ok(entry, `${label} is unavailable`);
  assert.equal(entry.isSymbolicLink(), false, `${label} must not be a symbolic link`);
  assert.ok(entry.isDirectory(), `${label} must be a directory`);
  const [physicalOwner, physicalPath] = await Promise.all([realpath(ownerRoot), realpath(lexicalPath)]);
  assertInside(physicalOwner, physicalPath, `${label} physical path`);
  return lexicalPath;
}

async function readJson(path, label) {
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`${label} is unavailable: ${error.message}`);
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error.message}`);
  }
}

function validateManifestShape(manifest, entry, label) {
  assert.ok(isRecord(manifest), `${label} must be an object`);
  for (const field of [
    "$schema",
    "schemaVersion",
    "semanticId",
    "version",
    "artifactKind",
    "standing",
    "title",
    "summary",
    "license",
    "canonicalPath",
  ]) requireString(manifest[field], `${label}.${field}`);

  assert.match(manifest.schemaVersion, semverPattern, `${label}.schemaVersion must be semantic`);
  assert.match(manifest.semanticId, semanticIdPattern, `${label}.semanticId must be path-safe`);
  assert.equal(manifest.semanticId, entry.semanticId, `${label}.semanticId must match registry.json`);
  assert.equal(manifest.version, entry.version, `${label}.version must match registry.json`);
  assert.equal(manifest.artifactKind, entry.artifactKind, `${label}.artifactKind must match registry.json`);
  assert.equal(manifest.canonicalPath, entry.canonicalPath, `${label}.canonicalPath must match registry.json`);
  assert.equal(manifest.license, "Apache-2.0", `${label}.license must be Apache-2.0`);
  assert.ok(isRecord(manifest.use), `${label}.use must be an object`);
  for (const field of ["practicalQuestion", "changedAbility"])
    requireString(manifest.use[field], `${label}.use.${field}`);
  assert.ok(isRecord(manifest.provenance), `${label}.provenance must be an object`);
  assert.ok(isRecord(manifest.technicalVeracity), `${label}.technicalVeracity must be an object`);
  assert.ok(isRecord(manifest.boundaries), `${label}.boundaries must be an object`);
}

async function validateArtifact(root, entry, seen) {
  assert.ok(isRecord(entry), "each registry entry must be an object");
  for (const field of ["semanticId", "version", "artifactKind", "manifestPath", "canonicalPath"])
    requireString(entry[field], `entry.${field}`);
  assert.match(entry.semanticId, semanticIdPattern, "entry.semanticId must be path-safe");
  assert.match(entry.version, semverPattern, "entry.version must be semantic");
  const key = `${entry.semanticId}@${entry.version}`;
  assert.equal(seen.has(key), false, `duplicate registry identity ${key}`);
  seen.add(key);

  const expectedPath = `snippets/${entry.semanticId}/${entry.version}`;
  assert.equal(entry.canonicalPath, expectedPath, `${key} canonicalPath must follow the version grammar`);
  assert.equal(entry.manifestPath, `${expectedPath}/snippet.json`, `${key} manifestPath must be canonical`);
  safeRelativePath(entry.canonicalPath, `${key}.canonicalPath`);
  safeRelativePath(entry.manifestPath, `${key}.manifestPath`);

  const artifactRoot = await requireDirectory(
    root,
    resolve(root, entry.canonicalPath),
    `${key} artifact root`,
  );
  const manifestPath = await requireRegularFile(
    root,
    resolve(root, entry.manifestPath),
    `${key} manifest`,
  );
  const manifest = await readJson(manifestPath, `${key} manifest`);
  validateManifestShape(manifest, entry, `${key} manifest`);

  safeManifestReference(manifest.$schema, `${key} manifest.$schema`);
  const schemaPath = resolve(dirname(manifestPath), manifest.$schema);
  await requireRegularFile(root, schemaPath, `${key} schema`);

  assert.ok(
    Array.isArray(manifest.representations) && manifest.representations.length > 0,
    `${key} representations must be non-empty`,
  );
  const represented = new Set();
  for (const [index, representation] of manifest.representations.entries()) {
    const label = `${key} representations[${index}]`;
    assert.ok(isRecord(representation), `${label} must be an object`);
    requireString(representation.role, `${label}.role`);
    safeRelativePath(representation.path, `${label}.path`);
    assert.match(
      representation.declaredMediaType,
      mediaTypePattern,
      `${label}.declaredMediaType must be a media type`,
    );
    assert.equal(represented.has(representation.path), false, `${key} repeats ${representation.path}`);
    represented.add(representation.path);
    const representationPath = await requireRegularFile(
      artifactRoot,
      resolve(artifactRoot, representation.path),
      `${label}.path`,
    );
    if (representation.sha256 !== undefined) {
      const digest = createHash("sha256").update(await readFile(representationPath)).digest("hex");
      assert.equal(digest, representation.sha256, `${label}.sha256 must match authored bytes`);
    }
  }

  if (manifest.execution !== undefined) {
    assert.ok(isRecord(manifest.execution), `${key} execution must be an object`);
    safeRelativePath(manifest.execution.dependenciesPath, `${key}.execution.dependenciesPath`);
    await requireRegularFile(
      artifactRoot,
      resolve(artifactRoot, manifest.execution.dependenciesPath),
      `${key} dependencies`,
    );
    assert.ok(Array.isArray(manifest.execution.commands), `${key} commands must be an array`);
    const commandNames = new Set(manifest.execution.commands.map(command => command?.name));
    for (const required of ["run", "test"])
      assert.ok(commandNames.has(required), `${key} must declare a ${required} command`);
    for (const field of ["fixtures", "expectedResults"]) {
      assert.ok(
        Array.isArray(manifest.execution[field]) && manifest.execution[field].length > 0,
        `${key} execution.${field} must be non-empty`,
      );
      for (const path of manifest.execution[field]) {
        safeRelativePath(path, `${key}.execution.${field}`);
        await requireRegularFile(
          artifactRoot,
          resolve(artifactRoot, path),
          `${key}.${field}`,
        );
      }
    }
  }

  for (const [index, relationship] of (manifest.relationships ?? []).entries()) {
    assert.ok(isRecord(relationship), `${key} relationships[${index}] must be an object`);
    for (const field of ["type", "target", "reason"])
      requireString(relationship[field], `${key}.relationships[${index}].${field}`);
    if (relationship.publicUrl !== undefined) {
      const url = new URL(relationship.publicUrl);
      assert.equal(url.protocol, "https:", `${key} relationship URLs must use HTTPS`);
    }
  }
}

export async function checkRegistry({ root = repositoryRoot } = {}) {
  const registryPath = await requireRegularFile(root, resolve(root, "registry.json"), "registry.json");
  const registry = await readJson(registryPath, "registry.json");
  assert.ok(isRecord(registry), "registry.json must be an object");
  assert.match(registry.registryVersion, semverPattern, "registryVersion must be semantic");
  assert.ok(
    Array.isArray(registry.entries) && registry.entries.length > 0,
    "registry entries must be non-empty",
  );
  const seen = new Set();
  for (const entry of registry.entries) await validateArtifact(root, entry, seen);
  return { artifactCount: registry.entries.length };
}

if (isDirectNodeInvocation(import.meta.url)) {
  checkRegistry()
    .then(({ artifactCount }) => console.log(`registry check: passed (${artifactCount} artifact)`))
    .catch(error => {
      console.error(`registry check: failed: ${error.message}`);
      process.exitCode = 1;
    });
}
