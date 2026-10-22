import "./node-runtime-guard.mjs";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, posix, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { isDirectNodeInvocation } from "./node-cli-entrypoint.mjs";

const execFileAsync = promisify(execFile);
const modulePath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(modulePath), "..");

export const deliveryObservationSchemaPath =
  "schemas/delivery-observation/0.1.0/delivery-observation.schema.json";
export const deliveryObservationCanonicalSchemaPath =
  "schemas/gist-registry/delivery-observation/0.1.0/delivery-observation.schema.json";
export const deliveryObservationReadmePath = "observations/delivery/README.md";
export const deliveryObservationIndexPath = "observations/delivery/index.json";

const canonicalOrigin = "https://kindlight.io";
const expectedSchemaId = `${canonicalOrigin}/${deliveryObservationCanonicalSchemaPath}`;
const gitRevisionPattern = /^[a-f0-9]{40}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const safeRelativePathPattern = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\).+$/u;
const mediaTypeTokenPattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function schemaErrors(errors) {
  return (errors ?? [])
    .map(error => `${error.instancePath || "/"} ${error.message}`)
    .join("; ");
}

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

function requireSafeRelativePath(path, label) {
  assert.equal(typeof path, "string", `${label} must be a string`);
  assert.match(path, safeRelativePathPattern, `${label} must be a safe relative path`);
  assert.equal(path.includes("//"), false, `${label} must use normalized separators`);
  assert.equal(posix.normalize(path), path, `${label} must be normalized`);
  return path;
}

async function requireRegularFile(root, relativePath, label) {
  requireSafeRelativePath(relativePath, label);
  const path = resolve(root, relativePath);
  assert.ok(isInside(root, path), `${label} must stay inside the repository`);
  const entry = await lstat(path).catch(() => null);
  assert.ok(entry, `${label} is unavailable`);
  assert.equal(entry.isSymbolicLink(), false, `${label} must be a regular file`);
  assert.ok(entry.isFile(), `${label} must be a regular file`);
  const [physicalRoot, physicalPath] = await Promise.all([realpath(root), realpath(path)]);
  assert.ok(isInside(physicalRoot, physicalPath), `${label} must stay inside the repository`);
  return path;
}

async function readSourceBytes(root, relativePath, label = relativePath) {
  return readFile(await requireRegularFile(root, relativePath, label));
}

function jsonFromBytes(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${error.message}`);
  }
}

async function gitOutput(root, arguments_, { encoding = "utf8" } = {}) {
  const { stdout } = await execFileAsync("git", arguments_, {
    cwd: root,
    encoding,
    maxBuffer: 16 * 1024 * 1024,
    env: {
      PATH: process.env.PATH,
      LANG: "C",
      LC_ALL: "C",
      SYSTEMROOT: process.env.SYSTEMROOT,
    },
  });
  return stdout;
}

export async function requireRevisionOnBranch(root, revision, branch, label) {
  assert.match(revision, gitRevisionPattern, `${label} must be a full lowercase Git SHA`);
  const branchRevision = await resolveBranchRevision(root, branch);
  await gitOutput(root, ["merge-base", "--is-ancestor", revision, branchRevision]).catch(() => {
    throw new Error(`${label} must be reachable from ${branch}`);
  });
}

async function resolveBranchRevision(root, branch) {
  const candidates = [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`];
  for (const candidate of candidates) {
    try {
      const raw = await gitOutput(root, ["show-ref", "-s", "--verify", candidate]);
      const revision = raw.trim();
      if (revision.length > 0) return revision;
    } catch {
      // Keep probing for a supported branch shape in deterministic order.
      continue;
    }
  }
  throw new Error(`no commit ref found for branch ${branch}`);
}

function assertExactKeys(value, expectedKeys, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(
    Object.keys(value).sort(compareText),
    [...expectedKeys].sort(compareText),
    `${label} must contain exactly the supported fields`,
  );
}

function splitMediaTypeSegments(value) {
  const segments = [];
  let current = "";
  let quoted = false;
  let escaped = false;

  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (quoted && character === "\\") {
      current += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      current += character;
      continue;
    }
    if (character === ";" && !quoted) {
      segments.push(current);
      current = "";
      continue;
    }
    current += character;
  }

  assert.equal(escaped, false, "Content-Type quoted value must end after its escape");
  assert.equal(quoted, false, "Content-Type quoted value must be closed");
  segments.push(current);
  return segments;
}

function decodeParameterValue(value, label) {
  const trimmed = value.trim();
  assert.ok(trimmed.length > 0, `${label} must have a value`);
  if (!trimmed.startsWith('"')) {
    assert.match(trimmed, mediaTypeTokenPattern, `${label} must use token or quoted-string syntax`);
    return trimmed;
  }

  assert.ok(trimmed.endsWith('"') && trimmed.length >= 2, `${label} quoted value must be closed`);
  const body = trimmed.slice(1, -1);
  let decoded = "";
  let escaped = false;
  for (const character of body) {
    if (escaped) {
      decoded += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === '"') {
      throw new Error(`${label} contains an unescaped quote`);
    } else {
      decoded += character;
    }
  }
  assert.equal(escaped, false, `${label} quoted value must end after its escape`);
  assert.ok(decoded.length > 0, `${label} must have a value`);
  return decoded;
}

export function parseMediaType(value) {
  assert.equal(typeof value, "string", "Content-Type must be a string");
  assert.ok(value.length > 0, "Content-Type must have a value");
  assert.equal(
    controlCharacterPattern.test(value),
    false,
    "Content-Type must not contain control characters",
  );

  const [essence, ...parameterSegments] = splitMediaTypeSegments(value);
  const slash = essence.indexOf("/");
  assert.ok(slash > 0 && slash === essence.lastIndexOf("/"), "Content-Type must contain one type/subtype separator");
  const type = essence.slice(0, slash).trim();
  const subtype = essence.slice(slash + 1).trim();
  assert.match(type, mediaTypeTokenPattern, "Content-Type type must be a token");
  assert.match(subtype, mediaTypeTokenPattern, "Content-Type subtype must be a token");

  const parameters = new Map();
  for (const segment of parameterSegments) {
    const equals = segment.indexOf("=");
    assert.ok(equals > 0, "Content-Type parameter must use name=value syntax");
    const name = segment.slice(0, equals).trim().toLowerCase();
    assert.match(name, mediaTypeTokenPattern, "Content-Type parameter name must be a token");
    assert.equal(parameters.has(name), false, `Content-Type parameter ${name} must appear once`);
    let parameterValue = decodeParameterValue(
      segment.slice(equals + 1),
      `Content-Type parameter ${name}`,
    );
    if (name === "charset") parameterValue = parameterValue.toLowerCase();
    parameters.set(name, parameterValue);
  }

  return {
    type: type.toLowerCase(),
    subtype: subtype.toLowerCase(),
    parameters: Object.fromEntries([...parameters].sort(([left], [right]) => compareText(left, right))),
  };
}

function expectedComparison(leftDigest, rightDigest) {
  if (leftDigest === null || rightDigest === null) return "unavailable";
  return leftDigest === rightDigest ? "equal" : "different";
}

export function validateDeliveryObservationSemantics(record) {
  assert.equal(record.subject.kind, "schema", "delivery observation 0.1.0 subject must be a schema");
  assert.equal(
    record.source.sourcePath,
    record.subject.authoredSourcePath,
    "source path must identify the subject's authored bytes",
  );
  assert.equal(
    record.projection.projectedPath,
    record.subject.projectedPath,
    "projection path must identify the subject's projected bytes",
  );

  const expectedUrl = `${canonicalOrigin}/${record.subject.projectedPath}`;
  assert.equal(record.subject.canonicalId, expectedUrl, "schema identity must equal its canonical projected URL");
  assert.equal(record.request.url, expectedUrl, "request must use the exact canonical schema URL");
  const requestUrl = new URL(record.request.url);
  assert.equal(requestUrl.protocol, "https:", "request must use HTTPS");
  assert.equal(requestUrl.origin, canonicalOrigin, `request must use ${canonicalOrigin}`);
  assert.equal(requestUrl.username, "", "request URL must not carry credentials");
  assert.equal(requestUrl.password, "", "request URL must not carry credentials");
  assert.equal(requestUrl.search, "", "request URL must be query-free");
  assert.equal(requestUrl.hash, "", "request URL must be fragment-free");

  const parsedMediaType = parseMediaType(record.response.rawContentType);
  assert.deepEqual(
    record.response.normalizedMediaType,
    parsedMediaType,
    "normalized media type must follow from raw Content-Type",
  );

  const sourceToProjection = expectedComparison(
    record.source.sha256,
    record.projection.projectedSha256,
  );
  const projectionToResponse = expectedComparison(
    record.projection.projectedSha256,
    record.response.returnedSha256,
  );
  assert.equal(
    record.comparison.sourceToProjection,
    sourceToProjection,
    "source-to-projection comparison must follow from the recorded digests",
  );
  assert.equal(
    record.comparison.projectionToResponse,
    projectionToResponse,
    "projection-to-response comparison must follow from the recorded digests",
  );

  let expectedResult = "observation_incomplete";
  if (
    record.response.status >= 200 &&
    record.response.status < 300 &&
    sourceToProjection === "equal" &&
    projectionToResponse === "equal"
  ) {
    expectedResult = "matches_named_sources";
  } else if (
    record.response.status < 200 ||
    record.response.status >= 300 ||
    sourceToProjection === "different" ||
    projectionToResponse === "different"
  ) {
    expectedResult = "differs_from_named_source";
  }
  assert.equal(record.resultStanding, expectedResult, "result standing must follow from status and comparisons");
  return record;
}

export function validateDeliveryObservationRecord(schema, record) {
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
  addFormats(ajv, { mode: "full" });
  assert.ok(
    ajv.validateSchema(schema),
    `delivery observation schema is invalid: ${schemaErrors(ajv.errors)}`,
  );
  const validate = ajv.compile(schema);
  assert.ok(
    validate(record),
    `delivery observation does not satisfy ${schema.$id}: ${schemaErrors(validate.errors)}`,
  );
  return validateDeliveryObservationSemantics(record);
}

export async function validateDeliveryObservationEvidence({ root = repositoryRoot, record }) {
  const resolvedRoot = resolve(root);
  await Promise.all([
    requireRevisionOnBranch(
      resolvedRoot,
      record.source.acceptedRevision,
      record.source.branch,
      "accepted source revision",
    ),
    requireRevisionOnBranch(
      resolvedRoot,
      record.projection.revision,
      record.projection.branch,
      "projection revision",
    ),
  ]);

  const [workingSourceBytes, acceptedSourceBytes, projectedBytes, projectionManifestBytes] =
    await Promise.all([
      readSourceBytes(resolvedRoot, record.source.sourcePath, "observed source path"),
      gitOutput(
        resolvedRoot,
        ["show", `${record.source.acceptedRevision}:${record.source.sourcePath}`],
        { encoding: null },
      ),
      gitOutput(
        resolvedRoot,
        ["show", `${record.projection.revision}:${record.projection.projectedPath}`],
        { encoding: null },
      ),
      gitOutput(
        resolvedRoot,
        ["show", `${record.projection.revision}:${record.projection.projectionManifestPath}`],
        { encoding: null },
      ),
    ]);

  assert.equal(
    sha256(workingSourceBytes),
    record.source.sha256,
    "working source digest must match the observation",
  );
  assert.equal(
    sha256(acceptedSourceBytes),
    record.source.sha256,
    "accepted source revision digest must match the observation",
  );
  assert.deepEqual(
    workingSourceBytes,
    acceptedSourceBytes,
    "working source bytes must retain the observed accepted revision",
  );
  assert.equal(
    sha256(projectedBytes),
    record.projection.projectedSha256,
    "projected Git bytes must match the observation",
  );
  assert.equal(
    sha256(projectionManifestBytes),
    record.projection.projectionManifestSha256,
    "projection manifest digest must match the observation",
  );

  const projectionManifest = jsonFromBytes(projectionManifestBytes, "named projection manifest");
  assert.equal(
    projectionManifest.sourceRevision,
    record.source.acceptedRevision,
    "projection manifest must name the observed source revision",
  );
  assert.equal(
    projectionManifest.canonicalOrigin,
    canonicalOrigin,
    "projection manifest must name the observed canonical origin",
  );
  const manifestFile = projectionManifest.files?.find(
    file => file.path === record.projection.projectedPath,
  );
  assert.ok(manifestFile, "projection manifest must include the observed projected path");
  assert.equal(
    manifestFile.sha256,
    record.projection.projectedSha256,
    "projection manifest file digest must match the observation",
  );
  assert.equal(
    manifestFile.bytes,
    projectedBytes.length,
    "projection manifest byte count must match the projected Git object",
  );

  return {
    sourceSha256: sha256(acceptedSourceBytes),
    projectedSha256: sha256(projectedBytes),
    projectionManifestSha256: sha256(projectionManifestBytes),
  };
}

function validateIndexRecordEntry(entry, previous, ids, paths) {
  assertExactKeys(
    entry,
    ["observationId", "observedAt", "subject", "recordPath", "sha256", "resultStanding"],
    "delivery observation index entry",
  );
  assertExactKeys(
    entry.subject,
    ["kind", "canonicalId", "version"],
    "delivery observation index subject",
  );
  assert.equal(entry.subject.kind, "schema", "delivery observation index subject must be a schema");
  assert.match(entry.sha256, sha256Pattern, "delivery observation index digest must be SHA-256");
  requireSafeRelativePath(entry.recordPath, "delivery observation record path");
  assert.equal(
    entry.recordPath,
    `records/${entry.observationId}.json`,
    "delivery observation record path must follow its observation ID",
  );
  assert.equal(ids.has(entry.observationId), false, "delivery observation IDs must be unique");
  assert.equal(paths.has(entry.recordPath), false, "delivery observation record paths must be unique");
  ids.add(entry.observationId);
  paths.add(entry.recordPath);

  const timestamp = Date.parse(entry.observedAt);
  assert.equal(Number.isFinite(timestamp), true, "delivery observation index timestamp must be valid");
  if (previous) {
    const previousTimestamp = Date.parse(previous.observedAt);
    assert.ok(
      timestamp > previousTimestamp ||
        (timestamp === previousTimestamp && compareText(entry.observationId, previous.observationId) >= 0),
      "delivery observation index must be ordered by observedAt, then observationId",
    );
  }
}

export async function checkDeliveryObservations({ root = repositoryRoot } = {}) {
  const resolvedRoot = resolve(root);
  const [schemaBytes, readmeBytes, indexBytes] = await Promise.all([
    readSourceBytes(resolvedRoot, deliveryObservationSchemaPath),
    readSourceBytes(resolvedRoot, deliveryObservationReadmePath),
    readSourceBytes(resolvedRoot, deliveryObservationIndexPath),
  ]);
  const schema = jsonFromBytes(schemaBytes, deliveryObservationSchemaPath);
  const index = jsonFromBytes(indexBytes, deliveryObservationIndexPath);

  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.$id, expectedSchemaId);
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.subject.properties.kind.const, "schema");
  assert.equal(schema.properties.contractStanding.const, "experimental");

  assertExactKeys(index, ["indexFormatVersion", "records"], "delivery observation index");
  assert.equal(index.indexFormatVersion, "0.1.0");
  assert.ok(Array.isArray(index.records), "delivery observation index records must be an array");
  assert.ok(index.records.length > 0, "delivery observation index must carry at least one real record");

  const ids = new Set();
  const paths = new Set();
  const records = [];
  let previous;
  for (const entry of index.records) {
    validateIndexRecordEntry(entry, previous, ids, paths);
    previous = entry;
    const sourcePath = posix.join(posix.dirname(deliveryObservationIndexPath), entry.recordPath);
    const bytes = await readSourceBytes(resolvedRoot, sourcePath, "delivery observation record");
    assert.equal(sha256(bytes), entry.sha256, `${sourcePath} digest must match its index entry`);
    const record = jsonFromBytes(bytes, sourcePath);
    validateDeliveryObservationRecord(schema, record);
    await validateDeliveryObservationEvidence({ root: resolvedRoot, record });

    assert.equal(record.observationId, entry.observationId, "index observation ID must match its record");
    assert.equal(record.observedAt, entry.observedAt, "index timestamp must match its record");
    assert.deepEqual(
      entry.subject,
      {
        kind: record.subject.kind,
        canonicalId: record.subject.canonicalId,
        version: record.subject.version,
      },
      "index subject must match its record",
    );
    assert.equal(record.resultStanding, entry.resultStanding, "index result must match its record");
    records.push({
      sourcePath,
      projectionPath: sourcePath,
      bytes,
      value: record,
      sha256: entry.sha256,
    });
  }

  return {
    schemaVersion: "0.1.0",
    observationCount: records.length,
    schema: {
      sourcePath: deliveryObservationSchemaPath,
      canonicalPath: deliveryObservationCanonicalSchemaPath,
      bytes: schemaBytes,
      value: schema,
      sha256: sha256(schemaBytes),
    },
    readme: {
      sourcePath: deliveryObservationReadmePath,
      projectionPath: deliveryObservationReadmePath,
      bytes: readmeBytes,
    },
    index: {
      sourcePath: deliveryObservationIndexPath,
      projectionPath: deliveryObservationIndexPath,
      bytes: indexBytes,
      value: index,
    },
    records,
  };
}

if (isDirectNodeInvocation(import.meta.url)) {
  checkDeliveryObservations()
    .then(({ schemaVersion, observationCount }) => {
      console.log(
        `delivery observation check: passed (${observationCount} record against ${schemaVersion})`,
      );
    })
    .catch(error => {
      console.error(`delivery observation check: failed: ${error.message}`);
      process.exitCode = 1;
    });
}
