import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const defaultProjectionRoot = ".artifacts/pages";
export const projectionManifestFile = "projection-manifest.json";
const modulePath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(modulePath), "..");
const sha256Pattern = /^[a-f0-9]{64}$/u;
const revisionPattern = /^[a-f0-9]{40}$/u;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function toCanonicalPath(relativePath) {
  if (relativePath === "index.html") return "/";
  if (relativePath.endsWith("/index.html"))
    return "/" + relativePath.replace(/index\.html$/u, "");
  return "/" + relativePath;
}

function readProjectionPath(value) {
  assert.equal(typeof value, "string", "projection manifest file path must be a string");
  assert.equal(value.includes("\\"), false, `${value} must use forward slashes`);
  assert.equal(value.includes("\0"), false, `${value} must contain ordinary path characters`);
  assert.equal(posix.isAbsolute(value), false, `${value} must be relative`);
  assert.ok(
    value.split("/").every(segment => segment && segment !== "." && segment !== ".."),
    `${value} must contain complete contained path segments`,
  );
  return value;
}

function canonicalContentType(value) {
  if (!value) return "missing";
  return value
    .split(";")
    .map(segment => segment.trim().toLowerCase())
    .filter(Boolean)
    .join("; ");
}

function canonicalizeResponseUrl(value) {
  const parsed = new URL(value);
  assert.equal(parsed.username, "", "response URL must not include credentials");
  assert.equal(parsed.password, "", "response URL must not include credentials");
  assert.equal(parsed.search, "", "response URL must be query-free");
  assert.equal(parsed.hash, "", "response URL must be fragment-free");
  assert.equal(parsed.protocol, "https:", "response URL must use HTTPS");
  return parsed;
}

async function observeFile({
  relativePath,
  expectedBytes,
  expectedSha256,
  canonicalOrigin,
  fetcher,
  contentTypeCounts,
  includeDetails = false,
  includeAsDeliveryRecord = false,
}) {
  const expectedUrl = new URL(toCanonicalPath(relativePath), `${canonicalOrigin}/`);
  const response = await fetcher(expectedUrl.href);
  assert.equal(response.status, 200, `${relativePath} must return HTTP 200`);
  const responseUrl = canonicalizeResponseUrl(response.url);
  assert.equal(responseUrl.href, expectedUrl.href, `${relativePath} must preserve its exact canonical URL`);

  const responseBody = await response.arrayBuffer();
  const responseBytes = Buffer.from(responseBody);
  assert.equal(responseBytes.length, expectedBytes, `${relativePath} must have expected byte count`);
  const responseSha256 = sha256(responseBytes);
  assert.equal(responseSha256, expectedSha256, `${relativePath} must have expected SHA-256`);

  const rawContentType = response.headers.get("content-type");
  const normalizedContentType = canonicalContentType(rawContentType);
  const cors = response.headers.get("access-control-allow-origin") ?? "missing";
  contentTypeCounts[normalizedContentType] = (contentTypeCounts[normalizedContentType] || 0) + 1;

  if (!includeDetails)
    return { bytes: responseBytes.length, sha256: responseSha256, contentType: normalizedContentType, cors };

  const summary = {
    path: relativePath,
    status: response.status,
    url: response.url,
    bytes: responseBytes.length,
    sha256: responseSha256,
    contentType: normalizedContentType,
    cors,
  };

  if (includeAsDeliveryRecord) summary.deliveryRecord = true;
  return summary;
}

function readManifestEntryValue(entry, label, field) {
  assert.equal(typeof entry[field], "number", `${label}.${field} must be a number`);
  assert.equal(Number.isInteger(entry[field]), true, `${label}.${field} must be an integer`);
  assert.ok(entry[field] >= 0, `${label}.${field} must be non-negative`);
  return entry[field];
}

function readManifestEntrySha(entry, label) {
  assert.equal(typeof entry.sha256, "string", `${label}.sha256 must be a string`);
  assert.match(entry.sha256, sha256Pattern, `${label}.sha256 must be a SHA-256 hex digest`);
  return entry.sha256;
}

export async function observePages({
  root = repositoryRoot,
  projectionRoot = defaultProjectionRoot,
  fetcher = globalThis.fetch,
} = {}) {
  const resolvedRoot = resolve(root);
  const resolvedProjection = resolve(resolvedRoot, projectionRoot);
  const manifestPath = resolve(resolvedProjection, projectionManifestFile);
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));

  assert.equal(typeof manifest.canonicalOrigin, "string", "projection manifest must define canonical origin");
  const canonicalOriginUrl = new URL(manifest.canonicalOrigin);
  assert.equal(canonicalOriginUrl.protocol, "https:", "projection manifest canonical origin must be HTTPS");
  assert.equal(canonicalOriginUrl.username, "", "projection manifest canonical origin must be credential-free");
  assert.equal(canonicalOriginUrl.password, "", "projection manifest canonical origin must be credential-free");
  assert.equal(canonicalOriginUrl.pathname, "/", "projection manifest canonical origin must be rooted at /");
  assert.equal(canonicalOriginUrl.search, "", "projection manifest canonical origin must be query-free");
  assert.equal(canonicalOriginUrl.hash, "", "projection manifest canonical origin must be fragment-free");
  const canonicalOrigin = canonicalOriginUrl.toString().replace(/\/$/u, "");

  assert.ok(Array.isArray(manifest.files), "projection manifest must list files");
  assert.equal(
    manifest.projectionOwner,
    "gist-registry-pages-builder",
    "projection manifest must retain the Pages builder owner",
  );
  assert.equal(
    manifest.sourceStanding,
    "accepted_revision",
    "projection manifest must describe an accepted source revision",
  );
  assert.equal(typeof manifest.sourceRevision, "string", "projection manifest must define source revision");
  assert.match(manifest.sourceRevision, revisionPattern, "projection manifest source revision must be a full Git SHA");
  const manifestEntries = new Map();
  for (const entry of manifest.files) {
    const entryPath = readProjectionPath(entry.path);
    assert.equal(manifestEntries.has(entryPath), false, `${entryPath} must be listed once`);
    manifestEntries.set(entryPath, {
      bytes: readManifestEntryValue(entry, `projection manifest entry ${entryPath}`, "bytes"),
      sha256: readManifestEntrySha(entry, `projection manifest entry ${entryPath}`),
    });
  }

  const contentTypeCounts = {};
  const durableDeliveryRecords = [];
  const fileSummaries = [];
  const manifestBytesEntry = { bytes: manifestBytes.length, sha256: sha256(manifestBytes) };
  const paths = [...manifestEntries.keys(), projectionManifestFile]
    .filter(path => path !== ".nojekyll")
    .sort();

  for (const relativePath of paths) {
    const entry = relativePath === projectionManifestFile ? manifestBytesEntry : manifestEntries.get(relativePath);
    assert.ok(entry, `${relativePath} must be declared in the projection manifest`);
    const pathSummary = await observeFile({
      relativePath,
      expectedBytes: entry.bytes,
      expectedSha256: entry.sha256,
      canonicalOrigin,
      fetcher,
      contentTypeCounts,
      includeDetails: true,
      includeAsDeliveryRecord: relativePath.startsWith("observations/delivery/records/"),
    });
    fileSummaries.push(pathSummary);
    if (relativePath === projectionManifestFile) fileSummaries[fileSummaries.length - 1].source = "projection-manifest";
    if (relativePath.startsWith("observations/delivery/records/"))
      durableDeliveryRecords.push(pathSummary);
  }

  const projectionManifestSummary = fileSummaries.find(
    entry => entry.path === projectionManifestFile,
  );
  return {
    observedAt: new Date().toISOString(),
    result: "all_returned_bytes_match_projection",
    canonicalOrigin,
    projectionOwner: manifest.projectionOwner,
    sourceRevision: manifest.sourceRevision,
    fileCount: paths.length,
    contentTypeCounts,
    projectionManifest: {
      path: projectionManifestSummary.path,
      status: projectionManifestSummary.status,
      url: projectionManifestSummary.url,
      bytes: projectionManifestSummary.bytes,
      sha256: projectionManifestSummary.sha256,
      contentType: projectionManifestSummary.contentType,
      cors: projectionManifestSummary.cors,
    },
    durableDeliveryRecords: durableDeliveryRecords.map(entry => ({
      path: entry.path,
      status: entry.status,
      url: entry.url,
      bytes: entry.bytes,
      sha256: entry.sha256,
      contentType: entry.contentType,
      cors: entry.cors,
    })),
    contentTypeFingerprint: Object.entries(contentTypeCounts).sort().map(([type, count]) => ({
      contentType: type,
      count,
    })),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  observePages()
    .then(summary => {
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch(error => {
      console.error(`pages observer: failed: ${error.message}`);
      process.exitCode = 1;
    });
}
