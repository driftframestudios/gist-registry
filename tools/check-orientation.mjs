import "./node-runtime-guard.mjs";

import assert from "node:assert/strict";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { isDirectNodeInvocation } from "./node-cli-entrypoint.mjs";

const modulePath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(modulePath), "..");

export const orientationSelectionPath = "orientation/selection.json";

const recordKeys = [
  "accessStanding",
  "applyWhen",
  "expectedParentTitle",
  "id",
  "localFallback",
  "localRoutes",
  "observedOn",
  "publicationStanding",
  "readerJob",
  "reentryCondition",
  "role",
  "selectionDepth",
  "semanticKey",
  "sourceFamily",
  "title",
];
const profileKeys = ["id", "readerJob", "recordIds", "selectionRule", "title"];
const localRouteKeys = ["kind", "path"];
const recordIdPattern = /^gr-orient-[0-9]{3}$/u;
const profileIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const tokenPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const semanticKeyPattern = /^@driftframe\/[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*(?:#[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*)?$/u;
const datePattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u;
const safeRelativePathPattern = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)(?!.*\/\/).+$/u;
const requiredColdSessionKeys = [
  "@driftframe/field-guide/behavior-goal-driven-development",
  "@driftframe/practitioner-probes",
  "@driftframe/practitioner-probes/start-here",
  "@driftframe/probes/cross-cutting-verification-under-ai-assistance",
];
const privateLocatorPatterns = [
  { label: "network locator", pattern: /https?:\/\//iu },
  { label: "Notion locator", pattern: /\bnotion\.(?:so|site)\b/iu },
  { label: "Notion application locator", pattern: /\bnotion:\/\//iu },
  { label: "Obsidian locator", pattern: /\bobsidian:\/\//iu },
  { label: "filesystem URI", pattern: /\bfile:\/\//iu },
  { label: "user-specific macOS path", pattern: /\/Users\//u },
  { label: "user-specific Unix path", pattern: /\/home\/[A-Za-z0-9._-]+\//u },
  { label: "user-specific Windows path", pattern: /[A-Za-z]:\\Users\\/u },
  {
    label: "provider-shaped UUID",
    pattern: /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/iu,
  },
  { label: "compact provider-shaped identifier", pattern: /\b[0-9a-f]{32}\b/iu },
  { label: "house annotation", pattern: /::[a-z][^:\n]{0,80}::/iu },
];

export const orientationLocatorBoundaryPaths = [
  ".agents/runbooks/gist-registry-cold-session-entry.v0.1.md",
  "orientation/README.md",
  "orientation/adapters/notion.md",
  "orientation/adapters/obsidian.md",
];

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isInside(owner, candidate) {
  const resolvedOwner = resolve(owner);
  const resolvedCandidate = resolve(candidate);
  return (
    resolvedCandidate === resolvedOwner ||
    resolvedCandidate.startsWith(resolvedOwner + sep)
  );
}

function requireString(value, label) {
  assert.equal(typeof value, "string", label + " must be a string");
  assert.ok(value.trim(), label + " must carry a value");
}

function requireExactKeys(value, expected, label) {
  assert.deepEqual(
    Object.keys(value).sort(compareText),
    [...expected].sort(compareText),
    label + " must carry the exact v0.1 fields",
  );
}

function requireUnique(values, label) {
  assert.equal(new Set(values).size, values.length, label + " must be unique");
}

function requireStringArray(value, label) {
  assert.ok(Array.isArray(value), label + " must be an array");
  assert.ok(value.length > 0, label + " must carry at least one value");
  for (const [index, item] of value.entries())
    requireString(item, label + "[" + index + "]");
  requireUnique(value, label);
}

function requireSafeRelativePath(path, label) {
  requireString(path, label);
  assert.match(path, safeRelativePathPattern, label + " must be a safe repository-relative path");
  return path;
}

async function requireRegularFile(root, relativePath, label) {
  requireSafeRelativePath(relativePath, label);
  const path = resolve(root, relativePath);
  assert.ok(isInside(root, path), label + " must stay inside the repository root");
  const entry = await lstat(path).catch(() => null);
  assert.ok(entry, label + " must resolve to an existing file");
  assert.equal(entry.isSymbolicLink(), false, label + " must resolve without a symbolic link");
  assert.equal(entry.isFile(), true, label + " must resolve to a regular file");
  const [physicalRoot, physicalPath] = await Promise.all([realpath(root), realpath(path)]);
  assert.ok(isInside(physicalRoot, physicalPath), label + " must stay inside the physical repository root");
  assert.equal(
    physicalPath,
    resolve(physicalRoot, relativePath),
    label + " must preserve its repository-relative physical path",
  );
}

function requirePublicSafeCatalog(selection) {
  const values = [];
  const collectStrings = value => {
    if (typeof value === "string") {
      values.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collectStrings(item);
      return;
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value)) collectStrings(item);
    }
  };
  collectStrings(selection);
  for (const value of values) requirePublicSafeText(value, "orientation selection");
}

function requirePublicSafeText(value, scope) {
  for (const { label, pattern } of privateLocatorPatterns)
    assert.doesNotMatch(value, pattern, scope + " must keep " + label + " resolver-held");
}

async function requirePublicSafeSources(root) {
  for (const path of orientationLocatorBoundaryPaths) {
    await requireRegularFile(root, path, "locator boundary source " + path);
    requirePublicSafeText(
      await readFile(resolve(root, path), "utf8"),
      "locator boundary source " + path,
    );
  }
}

function requireIsoDate(value, label) {
  assert.match(value, datePattern, label + " must be an ISO date");
  const observed = new Date(value + "T00:00:00.000Z");
  assert.equal(
    Number.isNaN(observed.valueOf()) ? null : observed.toISOString().slice(0, 10),
    value,
    label + " must be a real calendar date",
  );
}

async function validateRecord(record, index, root) {
  const label = "records[" + index + "]";
  assert.ok(record && typeof record === "object" && !Array.isArray(record), label + " must be an object");
  requireExactKeys(record, recordKeys, label);
  requireString(record.id, label + ".id");
  assert.match(record.id, recordIdPattern, label + ".id must use the gr-orient-NNN form");
  requireString(record.title, label + ".title");
  if (record.semanticKey === null) {
    requireString(record.expectedParentTitle, label + ".expectedParentTitle");
  } else {
    requireString(record.semanticKey, label + ".semanticKey");
    assert.match(record.semanticKey, semanticKeyPattern, label + ".semanticKey must use a stable Driftframe identity");
    assert.ok(
      record.expectedParentTitle === null ||
        (typeof record.expectedParentTitle === "string" && record.expectedParentTitle.trim()),
      label + ".expectedParentTitle must be null or a nonempty string",
    );
  }
  requireString(record.sourceFamily, label + ".sourceFamily");
  assert.match(record.sourceFamily, tokenPattern, label + ".sourceFamily must be a kebab-case token");
  requireString(record.role, label + ".role");
  assert.match(record.role, tokenPattern, label + ".role must be a kebab-case token");
  requireString(record.readerJob, label + ".readerJob");
  requireStringArray(record.applyWhen, label + ".applyWhen");
  for (const [applyIndex, condition] of record.applyWhen.entries())
    assert.match(condition, tokenPattern, label + ".applyWhen[" + applyIndex + "] must be a kebab-case token");
  assert.ok(
    ["default", "conditional", "authorized-overlay"].includes(record.selectionDepth),
    label + ".selectionDepth must use a supported value",
  );
  assert.ok(
    ["connector-unverified", "authorized-workspace-only"].includes(record.accessStanding),
    label + ".accessStanding must use a supported value",
  );
  assert.ok(
    ["public-possible-signed-out-unverified", "internal-coordination"].includes(record.publicationStanding),
    label + ".publicationStanding must use a supported value",
  );
  requireIsoDate(record.observedOn, label + ".observedOn");
  assert.ok(Array.isArray(record.localRoutes), label + ".localRoutes must be an array");
  assert.ok(record.localRoutes.length > 0, label + ".localRoutes must carry a repository fallback");
  requireString(record.localFallback, label + ".localFallback");
  requireString(record.reentryCondition, label + ".reentryCondition");
  const routePaths = [];
  for (const [routeIndex, route] of record.localRoutes.entries()) {
    const routeLabel = label + ".localRoutes[" + routeIndex + "]";
    assert.ok(route && typeof route === "object" && !Array.isArray(route), routeLabel + " must be an object");
    requireExactKeys(route, localRouteKeys, routeLabel);
    assert.ok(
      ["repository-source", "runbook", "skill"].includes(route.kind),
      routeLabel + ".kind must use a supported value",
    );
    await requireRegularFile(root, route.path, routeLabel + ".path");
    routePaths.push(route.path);
  }
  requireUnique(routePaths, label + ".localRoutes paths");
}

function validateProfile(profile, index, recordIds) {
  const label = "profiles[" + index + "]";
  assert.ok(profile && typeof profile === "object" && !Array.isArray(profile), label + " must be an object");
  requireExactKeys(profile, profileKeys, label);
  requireString(profile.id, label + ".id");
  assert.match(profile.id, profileIdPattern, label + ".id must be kebab-case");
  requireString(profile.title, label + ".title");
  requireString(profile.readerJob, label + ".readerJob");
  requireString(profile.selectionRule, label + ".selectionRule");
  requireStringArray(profile.recordIds, label + ".recordIds");
  for (const recordId of profile.recordIds)
    assert.ok(recordIds.has(recordId), label + " references unknown record " + recordId);
}

export async function validateOrientationSelection(selection, { root = repositoryRoot } = {}) {
  assert.ok(selection && typeof selection === "object" && !Array.isArray(selection), "selection must be an object");
  requireExactKeys(selection, ["formatVersion", "profiles", "records", "repository"], "selection");
  assert.equal(selection.formatVersion, "0.1.0", "selection.formatVersion must be 0.1.0");
  assert.equal(selection.repository, "gist-registry", "selection.repository must name gist-registry");
  assert.ok(Array.isArray(selection.records) && selection.records.length > 0, "selection.records must be nonempty");
  assert.ok(Array.isArray(selection.profiles) && selection.profiles.length > 0, "selection.profiles must be nonempty");
  requirePublicSafeCatalog(selection);

  for (const [index, record] of selection.records.entries())
    await validateRecord(record, index, root);
  const recordIds = selection.records.map(record => record.id);
  const semanticKeys = selection.records
    .map(record => record.semanticKey)
    .filter(key => key !== null);
  requireUnique(recordIds, "record ids");
  requireUnique(semanticKeys, "semantic keys");
  assert.deepEqual(
    recordIds,
    [...recordIds].sort(compareText),
    "records must stay ordered by stable id",
  );

  const recordIdSet = new Set(recordIds);
  for (const [index, profile] of selection.profiles.entries())
    validateProfile(profile, index, recordIdSet);
  const profileIds = selection.profiles.map(profile => profile.id);
  requireUnique(profileIds, "profile ids");
  assert.deepEqual(
    profileIds,
    [...profileIds].sort(compareText),
    "profiles must stay ordered by stable id",
  );

  const coldSession = selection.profiles.find(profile => profile.id === "cold-session-core");
  assert.ok(coldSession, "cold-session-core profile must remain available");
  const byId = new Map(selection.records.map(record => [record.id, record]));
  const coldSessionKeys = coldSession.recordIds.map(id => byId.get(id).semanticKey).sort(compareText);
  assert.deepEqual(
    coldSessionKeys,
    [...requiredColdSessionKeys].sort(compareText),
    "cold-session-core must retain the four orientation anchors",
  );
  const defaultRecordIds = selection.records
    .filter(record => record.selectionDepth === "default")
    .map(record => record.id)
    .sort(compareText);
  assert.deepEqual(
    defaultRecordIds,
    [...coldSession.recordIds].sort(compareText),
    "default records must remain exactly the cold-session-core",
  );

  return {
    recordCount: selection.records.length,
    profileCount: selection.profiles.length,
    defaultRecordCount: selection.records.filter(record => record.selectionDepth === "default").length,
  };
}

export async function checkOrientationSelection({
  root = repositoryRoot,
  path = orientationSelectionPath,
} = {}) {
  const selection = JSON.parse(await readFile(resolve(root, path), "utf8"));
  const result = await validateOrientationSelection(selection, { root });
  await requirePublicSafeSources(root);
  return result;
}

if (isDirectNodeInvocation(import.meta.url)) {
  checkOrientationSelection()
    .then(({ recordCount, profileCount, defaultRecordCount }) => {
      console.log(
        "orientation selection: passed (" +
          recordCount +
          " records, " +
          profileCount +
          " profiles, " +
          defaultRecordCount +
          " default records)",
      );
    })
    .catch(error => {
      console.error("orientation selection: failed: " + error.message);
      process.exitCode = 1;
    });
}
