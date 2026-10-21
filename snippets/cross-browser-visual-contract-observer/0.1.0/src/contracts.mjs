import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { types as utilTypes } from "node:util";

const ORACLES = new Set(["semantic", "interaction", "geometry", "computed_style", "bitmap_crop"]);
const TIERS = new Set(["smoke", "changed_boundary", "full"]);
const DIRECTIONS = new Set(["ltr", "rtl"]);
const MEDIA = new Set(["screen", "print"]);
const COLOR_MODES = new Set(["normal", "forced"]);
const MOTION = new Set(["full", "reduced"]);
const IMAGE_STATES = new Set(["available", "missing"]);
const FONT_STATES = new Set(["system", "missing"]);
const INPUT_MODES = new Set(["keyboard", "pointer", "touch", "none"]);
const RECEIVER_STATES = new Set(["accepted", "invalid", "pending", "stale", "success", "warning"]);
const RESULT_STATES = new Set(["pass", "fail", "friction"]);
const STANDINGS = new Set(["candidate", "accepted"]);
const CLASSIFICATIONS = new Set(["contract_change", "deterministic_implementation_change", "declared_engine_platform_variance", "environmental_drift", "test_harness_fault", "bounded_follow_up"]);
const SOURCE_MANIFEST_KIND = "generated_output_manifest";
const RECEIVER_MANIFEST_KIND = "production_build_manifest";
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;
const ARTIFACT_PATH_PATTERN = /^artifacts\/(?:[a-z0-9][a-z0-9._-]*\/)*[a-z0-9][a-z0-9._-]*$/iu;
const SOURCE_FILE_SYSTEM = Object.freeze({ lstat, open });

export const OBSERVER_RESOURCE_LIMITS = Object.freeze({
  targets: 64,
  scenarios: 64,
  artifacts: 32,
  identifierBytes: 256,
  caseIdBytes: 1024,
  proseBytes: 16 * 1024,
  jsonBytes: 2 * 1024 * 1024,
  artifactPathBytes: 1024,
  viewportWidth: 8192,
  viewportHeight: 8192,
  viewportPixels: 4 * 1024 * 1024,
  bitmapCropWidth: 4096,
  bitmapCropHeight: 8192,
  bitmapPixels: 4 * 1024 * 1024,
  bitmapCardRegions: 16,
  bitmapScreenshotBytes: 8 * 1024 * 1024,
  artifactBytes: 16 * 1024 * 1024,
  aggregateArtifactBytes: 64 * 1024 * 1024,
  normalizedDepth: 24,
  normalizedNodes: 4096,
  normalizedStringBytes: 64 * 1024,
  normalizedAggregateStringBytes: 512 * 1024,
});

export class ObserverError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ObserverError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

function ownDataDescriptor(value, key) {
  if (
    value === null
    || (typeof value !== "object" && typeof value !== "function")
    || utilTypes.isProxy(value)
  ) return null;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, "value") ? descriptor : null;
  } catch {
    return null;
  }
}

function boundedOwnString(value, key, fallback, maxBytes = 1_024) {
  const candidate = ownDataDescriptor(value, key)?.value;
  return typeof candidate === "string"
    && candidate.length > 0
    && candidate.length <= maxBytes
    && Buffer.byteLength(candidate, "utf8") <= maxBytes
    ? candidate
    : fallback;
}

function boundedErrorMessage(error, fallback) {
  return boundedOwnString(error, "message", fallback);
}

function admittedObserverError(error) {
  if (
    error === null
    || (typeof error !== "object" && typeof error !== "function")
    || utilTypes.isProxy(error)
  ) return null;
  try {
    // Exact prototype identity avoids walking a caller-controlled Proxy
    // prototype chain as `instanceof` would.
    if (Object.getPrototypeOf(error) !== ObserverError.prototype) return null;
  } catch {
    return null;
  }
  const code = boundedOwnString(error, "code", null, 512);
  const message = boundedOwnString(error, "message", null, 4_096);
  const detailsDescriptor = ownDataDescriptor(error, "details");
  if (code === null || message === null || detailsDescriptor === null) return null;
  try {
    const details = clonePlainData(detailsDescriptor.value, {
      boundary: "error.details",
      restartFrom: "caller_boundary",
    });
    if (details === null || typeof details !== "object" || Array.isArray(details)) return null;
    return Object.freeze({ code, message, details });
  } catch {
    return null;
  }
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function stableStringify(value) {
  const admitted = clonePlainData(value, {
    boundary: "stable_serialization",
    restartFrom: "source",
    sortKeys: true,
  });
  return `${JSON.stringify(admitted, null, 2)}\n`;
}

// One bounded file descriptor owns inspection and reading. This keeps source
// identity, allocation, and cleanup inside the same observation boundary.
export async function readBoundedRegularFile(filePath, {
  boundary,
  maxBytes,
  expectedBytes = null,
  restartFrom,
  fileSystem = SOURCE_FILE_SYSTEM,
}) {
  let pathEntry;
  try {
    pathEntry = await fileSystem.lstat(filePath);
  } catch (error) {
    throw new ObserverError("SOURCE_FILE_UNREADABLE", "The source coordinate requires a readable file.", {
      boundary,
      reason: boundedErrorMessage(error, "source_path_unreadable"),
      restartFrom,
    });
  }
  if (!pathEntry.isFile() || pathEntry.isSymbolicLink()) {
    throw new ObserverError("SOURCE_FILE_INVALID", "The source coordinate requires a directly addressed regular file.", {
      boundary,
      restartFrom,
    });
  }
  if (pathEntry.size > maxBytes) resourceLimitExceeded(boundary, maxBytes, pathEntry.size, restartFrom);
  if (expectedBytes !== null && pathEntry.size !== expectedBytes) {
    throw new ObserverError("SOURCE_SIZE_MISMATCH", "The source byte count must match its declared coordinate.", {
      boundary,
      expected: expectedBytes,
      observed: pathEntry.size,
      restartFrom,
    });
  }

  let handle;
  try {
    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
    handle = await fileSystem.open(filePath, flags);
  } catch (error) {
    throw new ObserverError("SOURCE_FILE_UNREADABLE", "The source coordinate changed or became unreadable before capture.", {
      boundary,
      reason: boundedErrorMessage(error, "source_open_failed"),
      restartFrom,
    });
  }

  let primaryError = null;
  try {
    const openedEntry = await handle.stat();
    if (!openedEntry.isFile()) {
      throw new ObserverError("SOURCE_FILE_INVALID", "The opened source coordinate requires a regular file.", {
        boundary,
        restartFrom,
      });
    }
    if (openedEntry.dev !== pathEntry.dev || openedEntry.ino !== pathEntry.ino) {
      throw new ObserverError("SOURCE_FILE_CHANGED", "The source coordinate changed before capture completed.", {
        boundary,
        restartFrom,
      });
    }
    if (openedEntry.size > maxBytes) resourceLimitExceeded(boundary, maxBytes, openedEntry.size, restartFrom);
    if (expectedBytes !== null && openedEntry.size !== expectedBytes) {
      throw new ObserverError("SOURCE_SIZE_MISMATCH", "The opened source byte count must match its declared coordinate.", {
        boundary,
        expected: expectedBytes,
        observed: openedEntry.size,
        restartFrom,
      });
    }

    const bytes = Buffer.allocUnsafe(openedEntry.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    const overflowProbe = Buffer.allocUnsafe(1);
    const overflow = await handle.read(overflowProbe, 0, 1, openedEntry.size);
    const settledEntry = await handle.stat();
    if (
      offset !== openedEntry.size ||
      overflow.bytesRead > 0 ||
      settledEntry.dev !== openedEntry.dev ||
      settledEntry.ino !== openedEntry.ino ||
      settledEntry.size !== openedEntry.size ||
      settledEntry.mtimeMs !== openedEntry.mtimeMs ||
      settledEntry.ctimeMs !== openedEntry.ctimeMs
    ) {
      throw new ObserverError("SOURCE_FILE_CHANGED", "The source bytes changed during bounded capture.", {
        boundary,
        restartFrom,
      });
    }
    // Descriptor stability proves the captured bytes; the final path check
    // proves that the named observation coordinate still addresses them.
    let settledPathEntry;
    try {
      settledPathEntry = await fileSystem.lstat(filePath);
    } catch {
      throw new ObserverError("SOURCE_FILE_CHANGED", "The source coordinate changed its addressed path during bounded capture.", {
        boundary,
        reason: "path_unavailable_after_capture",
        restartFrom,
      });
    }
    if (
      !settledPathEntry.isFile()
      || settledPathEntry.isSymbolicLink()
      || settledPathEntry.dev !== openedEntry.dev
      || settledPathEntry.ino !== openedEntry.ino
      || settledPathEntry.size !== openedEntry.size
      || settledPathEntry.mtimeMs !== openedEntry.mtimeMs
      || settledPathEntry.ctimeMs !== openedEntry.ctimeMs
    ) {
      throw new ObserverError("SOURCE_FILE_CHANGED", "The source coordinate changed its addressed path during bounded capture.", {
        boundary,
        reason: "path_identity_changed",
        restartFrom,
      });
    }
    return bytes;
  } catch (error) {
    const admitted = admittedObserverError(error);
    primaryError = admitted
      ? new ObserverError(admitted.code, admitted.message, admitted.details)
      : new ObserverError("SOURCE_CAPTURE_FAILED", "The source coordinate could not complete its bounded capture.", {
        boundary,
        reason: boundedErrorMessage(error, "source_capture_failed"),
        restartFrom,
      });
    throw primaryError;
  } finally {
    try {
      await handle.close();
    } catch (error) {
      if (primaryError === null) {
        throw new ObserverError("SOURCE_FILE_CLOSE_FAILED", "The source descriptor requires operator recovery after capture.", {
          boundary,
          reason: boundedErrorMessage(error, "source_close_failed"),
          restartFrom,
        });
      }
    }
  }
}

export async function readJson(path) {
  let bytes;
  try {
    bytes = await readBoundedRegularFile(path, {
      boundary: "json_input.bytes",
      maxBytes: OBSERVER_RESOURCE_LIMITS.jsonBytes,
      restartFrom: "input",
    });
  } catch (error) {
    const admitted = admittedObserverError(error);
    if (admitted) throw new ObserverError(admitted.code, admitted.message, admitted.details);
    throw new ObserverError("INVALID_JSON", "The observer requires readable JSON input.", {
      reason: boundedErrorMessage(error, "json_input_unreadable"),
      restartFrom: "input",
    });
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new ObserverError("INVALID_JSON", "The observer requires readable JSON input.", {
      reason: boundedErrorMessage(error, "invalid_json"),
      restartFrom: "input",
    });
  }
}

function resourceLimitExceeded(boundary, limit, observed, restartFrom) {
  throw new ObserverError("RESOURCE_LIMIT_EXCEEDED", `${boundary} exceeds its finite observation envelope.`, {
    boundary,
    limit,
    observed,
    restartFrom,
  });
}

function restartCoordinateForBoundary(boundary) {
  if (boundary.startsWith("receipt")) return "receipt";
  if (boundary.startsWith("matrix") || boundary.startsWith("observation_matrix")) return "matrix";
  if (boundary.startsWith("decision")) return "inventory";
  if (boundary.startsWith("tier_selection")) return "selection";
  if (boundary.startsWith("bitmap_capture")) return "receiver_bitmap_boundary";
  return "source";
}

function invalidPlainData(boundary, reason, restartFrom, details = {}) {
  throw new ObserverError(
    "INVALID_CONTRACT",
    `${boundary} must use enumerable own data properties with string keys.`,
    { boundary, reason, restartFrom, ...details },
  );
}

// Inspect descriptors before reading caller-controlled values. This admits the
// same plain-data topology JSON carries while keeping getters outside the
// observation and publication boundaries.
function requirePlainRecordDescriptors(record, boundary, restartFrom) {
  if (!record || typeof record !== "object") {
    throw new ObserverError("INVALID_CONTRACT", `${boundary} must be an object.`, { boundary, restartFrom });
  }
  // A Proxy is executable caller behavior. Detect it before array,
  // prototype, key, or descriptor reflection so its traps remain idle.
  if (utilTypes.isProxy(record)) invalidPlainData(boundary, "proxy_value", restartFrom);
  if (Array.isArray(record)) {
    throw new ObserverError("INVALID_CONTRACT", `${boundary} must be an object.`, { boundary, restartFrom });
  }
  let prototype;
  let names;
  let symbols;
  try {
    prototype = Object.getPrototypeOf(record);
    names = Object.getOwnPropertyNames(record);
    symbols = Object.getOwnPropertySymbols(record);
  } catch {
    invalidPlainData(boundary, "descriptor_inspection_failed", restartFrom);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    invalidPlainData(boundary, "plain_object_required", restartFrom);
  }
  if (symbols.length > 0) {
    invalidPlainData(boundary, "symbol_fields_present", restartFrom, { symbolCount: symbols.length });
  }
  const descriptors = new Map();
  for (const name of names) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(record, name);
    } catch {
      invalidPlainData(boundary, "descriptor_inspection_failed", restartFrom);
    }
    if (!descriptor || descriptor.enumerable !== true) {
      invalidPlainData(boundary, "hidden_fields_present", restartFrom, { fields: [name] });
    }
    if (!Object.hasOwn(descriptor, "value")) {
      invalidPlainData(boundary, "accessor_fields_present", restartFrom, { fields: [name] });
    }
    descriptors.set(name, descriptor);
  }
  return { descriptors, prototype };
}

function requireDenseArrayDescriptors(value, { boundary, minimum = 0, maximum, restartFrom }) {
  if (utilTypes.isProxy(value)) invalidPlainData(boundary, "proxy_value", restartFrom);
  if (!Array.isArray(value)) {
    throw new ObserverError("INVALID_CONTRACT", `${boundary} must be an array.`, { boundary, restartFrom });
  }
  let prototype;
  let lengthDescriptor;
  try {
    prototype = Object.getPrototypeOf(value);
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  } catch {
    invalidPlainData(boundary, "descriptor_inspection_failed", restartFrom);
  }
  if (prototype !== Array.prototype) {
    invalidPlainData(boundary, "plain_array_required", restartFrom);
  }
  const length = lengthDescriptor?.value;
  if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, "value") || !Number.isSafeInteger(length) || length < minimum) {
    throw new ObserverError("INVALID_CONTRACT", `${boundary} requires at least ${minimum} item${minimum === 1 ? "" : "s"}.`, { boundary, restartFrom });
  }
  if (length > maximum) resourceLimitExceeded(boundary, maximum, length, restartFrom);

  let symbols;
  let names;
  try {
    symbols = Object.getOwnPropertySymbols(value);
    names = Object.getOwnPropertyNames(value);
  } catch {
    invalidPlainData(boundary, "descriptor_inspection_failed", restartFrom);
  }
  if (symbols.length > 0) {
    invalidPlainData(boundary, "symbol_fields_present", restartFrom, { symbolCount: symbols.length });
  }
  const descriptors = new Map();
  let indexCount = 0;
  for (const name of names) {
    if (name === "length") continue;
    const index = Number(name);
    if (!Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== name) {
      invalidPlainData(boundary, "array_fields_outside_dense_indices", restartFrom, { fields: [name] });
    }
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, name);
    } catch {
      invalidPlainData(boundary, "descriptor_inspection_failed", restartFrom);
    }
    if (!descriptor || descriptor.enumerable !== true) {
      invalidPlainData(boundary, "hidden_fields_present", restartFrom, { fields: [name] });
    }
    if (!Object.hasOwn(descriptor, "value")) {
      invalidPlainData(boundary, "accessor_fields_present", restartFrom, { fields: [name] });
    }
    descriptors.set(name, descriptor);
    indexCount += 1;
  }
  if (indexCount !== length) {
    invalidPlainData(boundary, "dense_array_required", restartFrom, { expectedItems: length, observedItems: indexCount });
  }
  return { descriptors, length };
}

export function clonePlainData(value, {
  boundary = "plain_data",
  restartFrom = "source",
  sortKeys = false,
} = {}) {
  const active = new WeakSet();
  const maximumDepth = OBSERVER_RESOURCE_LIMITS.normalizedDepth + 8;
  const maximumNodes = OBSERVER_RESOURCE_LIMITS.normalizedNodes + 512;
  let nodes = 0;

  const clone = (input, depth, currentBoundary) => {
    nodes += 1;
    if (nodes > maximumNodes) resourceLimitExceeded(`${boundary}.nodes`, maximumNodes, nodes, restartFrom);
    if (depth > maximumDepth) resourceLimitExceeded(`${boundary}.depth`, maximumDepth, depth, restartFrom);
    if (input === null || typeof input === "string" || typeof input === "boolean") return input;
    if (typeof input === "number" && Number.isFinite(input)) return input;
    if (!input || typeof input !== "object") {
      invalidPlainData(currentBoundary, "json_scalar_required", restartFrom);
    }
    if (utilTypes.isProxy(input)) invalidPlainData(currentBoundary, "proxy_value", restartFrom);
    if (active.has(input)) invalidPlainData(currentBoundary, "acyclic_tree_required", restartFrom);
    active.add(input);
    try {
      if (Array.isArray(input)) {
        const admitted = requireDenseArrayDescriptors(input, {
          boundary: currentBoundary,
          minimum: 0,
          maximum: maximumNodes,
          restartFrom,
        });
        const output = new Array(admitted.length);
        for (let index = 0; index < admitted.length; index += 1) {
          output[index] = clone(admitted.descriptors.get(String(index)).value, depth + 1, `${currentBoundary}[${index}]`);
        }
        return output;
      }
      const admitted = requirePlainRecordDescriptors(input, currentBoundary, restartFrom);
      const keys = [...admitted.descriptors.keys()];
      if (sortKeys) keys.sort();
      const output = Object.create(admitted.prototype === null ? null : Object.prototype);
      for (const key of keys) {
        Object.defineProperty(output, key, {
          value: clone(admitted.descriptors.get(key).value, depth + 1, `${currentBoundary}.${key}`),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return output;
    } finally {
      active.delete(input);
    }
  };

  return clone(value, 0, boundary);
}

function requireKeys(record, keys, boundary, optionalKeys = []) {
  const restartFrom = restartCoordinateForBoundary(boundary);
  const { descriptors } = requirePlainRecordDescriptors(record, boundary, restartFrom);
  const missing = keys.filter(key => !descriptors.has(key));
  if (missing.length > 0) {
    throw new ObserverError("INVALID_CONTRACT", `${boundary} is missing required fields.`, {
      boundary,
      missing,
      restartFrom,
    });
  }
  const admitted = new Set([...keys, ...optionalKeys]);
  const unknown = [...descriptors.keys()].filter(key => !admitted.has(key));
  if (unknown.length > 0) {
    throw new ObserverError("INVALID_CONTRACT", `${boundary} contains fields outside its declared contract.`, {
      boundary,
      unknown,
      restartFrom,
    });
  }
}

function requireBoundedString(value, { boundary, field, maxBytes, pattern = null, restartFrom }) {
  if (typeof value !== "string" || value.length === 0) {
    throw new ObserverError("INVALID_CONTRACT", `${boundary}.${field} must be a non-empty string.`, { boundary, field, restartFrom });
  }
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes > maxBytes) resourceLimitExceeded(`${boundary}.${field}`, maxBytes, bytes, restartFrom);
  if (pattern && !pattern.test(value)) {
    throw new ObserverError("INVALID_CONTRACT", `${boundary}.${field} has an unsupported format.`, { boundary, field, restartFrom });
  }
  return value;
}

function requireBoundedArray(value, { boundary, minimum = 1, maximum, restartFrom }) {
  requireDenseArrayDescriptors(value, { boundary, minimum, maximum, restartFrom });
  return value;
}

function requireEnum(value, values, boundary, restartFrom) {
  if (!values.has(value)) {
    throw new ObserverError("INVALID_CONTRACT", `${boundary} names an unsupported value.`, { boundary, value, restartFrom });
  }
}

function validateNormalizedEnvelope(value) {
  const seen = new WeakSet();
  const stack = [{ value, depth: 0, boundary: "receipt.result.normalized" }];
  let nodes = 0;
  let aggregateStringBytes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > OBSERVER_RESOURCE_LIMITS.normalizedNodes) {
      resourceLimitExceeded("receipt.result.normalized.nodes", OBSERVER_RESOURCE_LIMITS.normalizedNodes, nodes, "receipt");
    }
    if (current.depth > OBSERVER_RESOURCE_LIMITS.normalizedDepth) {
      resourceLimitExceeded("receipt.result.normalized.depth", OBSERVER_RESOURCE_LIMITS.normalizedDepth, current.depth, "receipt");
    }
    if (typeof current.value === "string") {
      const bytes = Buffer.byteLength(current.value, "utf8");
      if (bytes > OBSERVER_RESOURCE_LIMITS.normalizedStringBytes) {
        resourceLimitExceeded("receipt.result.normalized.string", OBSERVER_RESOURCE_LIMITS.normalizedStringBytes, bytes, "receipt");
      }
      aggregateStringBytes += bytes;
      if (aggregateStringBytes > OBSERVER_RESOURCE_LIMITS.normalizedAggregateStringBytes) {
        resourceLimitExceeded("receipt.result.normalized.stringBytes", OBSERVER_RESOURCE_LIMITS.normalizedAggregateStringBytes, aggregateStringBytes, "receipt");
      }
      continue;
    }
    if (current.value === null || typeof current.value === "boolean") continue;
    if (typeof current.value === "number" && Number.isFinite(current.value)) continue;
    if (!current.value || typeof current.value !== "object") {
      throw new ObserverError("INVALID_CONTRACT", "receipt.result.normalized must contain JSON-compatible values.", { restartFrom: "receipt" });
    }
    if (seen.has(current.value)) {
      throw new ObserverError("INVALID_CONTRACT", "receipt.result.normalized must be acyclic.", { restartFrom: "receipt" });
    }
    seen.add(current.value);
    const descriptors = Array.isArray(current.value)
      ? requireDenseArrayDescriptors(current.value, {
        boundary: current.boundary,
        minimum: 0,
        maximum: OBSERVER_RESOURCE_LIMITS.normalizedNodes,
        restartFrom: "receipt",
      }).descriptors
      : requirePlainRecordDescriptors(current.value, current.boundary, "receipt").descriptors;
    for (const [key, descriptor] of descriptors) {
      const keyBytes = Buffer.byteLength(key, "utf8");
      if (keyBytes > OBSERVER_RESOURCE_LIMITS.identifierBytes) {
        resourceLimitExceeded("receipt.result.normalized.key", OBSERVER_RESOURCE_LIMITS.identifierBytes, keyBytes, "receipt");
      }
      aggregateStringBytes += keyBytes;
      if (aggregateStringBytes > OBSERVER_RESOURCE_LIMITS.normalizedAggregateStringBytes) {
        resourceLimitExceeded("receipt.result.normalized.stringBytes", OBSERVER_RESOURCE_LIMITS.normalizedAggregateStringBytes, aggregateStringBytes, "receipt");
      }
      stack.push({ value: descriptor.value, depth: current.depth + 1, boundary: `${current.boundary}.${key}` });
    }
  }
}

function validateAdmittedInventory(inventory) {
  requireKeys(inventory, ["schemaVersion", "targets"], "decision_inventory");
  if (inventory.schemaVersion !== "0.1.0") {
    throw new ObserverError("INVALID_INVENTORY", "The decision inventory requires version 0.1.0 and at least one target.", { restartFrom: "inventory" });
  }
  requireBoundedArray(inventory.targets, { boundary: "decision_inventory.targets", maximum: OBSERVER_RESOURCE_LIMITS.targets, restartFrom: "inventory" });
  const ids = new Set();
  const faults = new Set();
  for (const target of inventory.targets) {
    requireKeys(target, ["id", "decision", "behavior", "fault", "oracle", "scenarioIds", "faultScenarioId", "consequence", "restartFrom"], "decision_target");
    requireBoundedString(target.id, { boundary: "decision_target", field: "id", maxBytes: OBSERVER_RESOURCE_LIMITS.identifierBytes, pattern: IDENTIFIER_PATTERN, restartFrom: "inventory" });
    requireBoundedString(target.fault, { boundary: "decision_target", field: "fault", maxBytes: OBSERVER_RESOURCE_LIMITS.identifierBytes, pattern: IDENTIFIER_PATTERN, restartFrom: "inventory" });
    requireBoundedString(target.restartFrom, { boundary: "decision_target", field: "restartFrom", maxBytes: OBSERVER_RESOURCE_LIMITS.identifierBytes, pattern: IDENTIFIER_PATTERN, restartFrom: "inventory" });
    for (const field of ["decision", "behavior", "consequence"]) {
      requireBoundedString(target[field], { boundary: "decision_target", field, maxBytes: OBSERVER_RESOURCE_LIMITS.proseBytes, restartFrom: "inventory" });
    }
    if (ids.has(target.id)) throw new ObserverError("DUPLICATE_TARGET", `Target ${target.id} appears more than once.`, { targetId: target.id, restartFrom: "inventory" });
    if (faults.has(target.fault)) throw new ObserverError("DUPLICATE_FAULT", `Fault ${target.fault} maps to several targets.`, { fault: target.fault, restartFrom: "inventory" });
    if (!ORACLES.has(target.oracle)) throw new ObserverError("ORACLE_UNSUPPORTED", `Target ${target.id} names an unsupported oracle.`, { targetId: target.id, oracle: target.oracle, restartFrom: "inventory" });
    requireBoundedArray(target.scenarioIds, { boundary: `decision_target.${target.id}.scenarioIds`, maximum: OBSERVER_RESOURCE_LIMITS.scenarios, restartFrom: "inventory" });
    const scenarioIds = new Set();
    for (const scenarioId of target.scenarioIds) {
      requireBoundedString(scenarioId, { boundary: `decision_target.${target.id}`, field: "scenarioId", maxBytes: OBSERVER_RESOURCE_LIMITS.identifierBytes, pattern: IDENTIFIER_PATTERN, restartFrom: "inventory" });
      if (scenarioIds.has(scenarioId)) throw new ObserverError("DUPLICATE_SCENARIO", `Target ${target.id} repeats an applicable scenario.`, { targetId: target.id, scenarioId, restartFrom: "inventory" });
      scenarioIds.add(scenarioId);
    }
    requireBoundedString(target.faultScenarioId, { boundary: `decision_target.${target.id}`, field: "faultScenarioId", maxBytes: OBSERVER_RESOURCE_LIMITS.identifierBytes, pattern: IDENTIFIER_PATTERN, restartFrom: "inventory" });
    if (!scenarioIds.has(target.faultScenarioId)) {
      throw new ObserverError("FAULT_SCENARIO_INAPPLICABLE", `Target ${target.id} requires its controlled fault inside the target's applicable scenarios.`, { targetId: target.id, scenarioId: target.faultScenarioId, restartFrom: "inventory" });
    }
    ids.add(target.id);
    faults.add(target.fault);
  }
  return { targetCount: ids.size, evidenceClasses: [...new Set(inventory.targets.map(target => target.oracle))].sort() };
}

function admitInventory(inputInventory) {
  const inventory = clonePlainData(inputInventory, {
    boundary: "decision_inventory",
    restartFrom: "inventory",
  });
  return { inventory, summary: validateAdmittedInventory(inventory) };
}

export function validateInventory(inputInventory) {
  return admitInventory(inputInventory).summary;
}

function validateAdmittedMatrix(matrix) {
  requireKeys(matrix, ["schemaVersion", "scenarios"], "observation_matrix");
  if (matrix.schemaVersion !== "0.1.0") {
    throw new ObserverError("INVALID_MATRIX", "The observation matrix requires version 0.1.0 and at least one scenario.", { restartFrom: "matrix" });
  }
  requireBoundedArray(matrix.scenarios, { boundary: "observation_matrix.scenarios", maximum: OBSERVER_RESOURCE_LIMITS.scenarios, restartFrom: "matrix" });
  const ids = new Set();
  for (const scenario of matrix.scenarios) {
    requireKeys(scenario, ["id", "tiers", "viewport", "textScale", "direction", "media", "colorMode", "motion", "image", "font", "input", "state"], "matrix_scenario", ["javaScript"]);
    requireBoundedString(scenario.id, { boundary: "matrix_scenario", field: "id", maxBytes: OBSERVER_RESOURCE_LIMITS.identifierBytes, pattern: IDENTIFIER_PATTERN, restartFrom: "matrix" });
    if (ids.has(scenario.id)) throw new ObserverError("DUPLICATE_SCENARIO", `Scenario ${scenario.id} appears more than once.`, { scenarioId: scenario.id, restartFrom: "matrix" });
    requireBoundedArray(scenario.tiers, { boundary: `matrix_scenario.${scenario.id}.tiers`, maximum: TIERS.size, restartFrom: "matrix" });
    if (!scenario.tiers.every(tier => TIERS.has(tier)) || new Set(scenario.tiers).size !== scenario.tiers.length) throw new ObserverError("TIER_UNSUPPORTED", `Scenario ${scenario.id} names an unsupported or repeated tier.`, { scenarioId: scenario.id, restartFrom: "matrix" });
    requireKeys(scenario.viewport, ["width", "height"], "matrix_viewport");
    if (
      !Number.isInteger(scenario.viewport.width) ||
      scenario.viewport.width < 1 ||
      scenario.viewport.width > OBSERVER_RESOURCE_LIMITS.viewportWidth ||
      !Number.isInteger(scenario.viewport.height) ||
      scenario.viewport.height < 1 ||
      scenario.viewport.height > OBSERVER_RESOURCE_LIMITS.viewportHeight
    ) throw new ObserverError("VIEWPORT_INVALID", `Scenario ${scenario.id} requires a viewport inside the declared finite envelope.`, { scenarioId: scenario.id, maximum: { width: OBSERVER_RESOURCE_LIMITS.viewportWidth, height: OBSERVER_RESOURCE_LIMITS.viewportHeight }, restartFrom: "matrix" });
    const viewportPixels = scenario.viewport.width * scenario.viewport.height;
    if (!Number.isSafeInteger(viewportPixels) || viewportPixels > OBSERVER_RESOURCE_LIMITS.viewportPixels) {
      resourceLimitExceeded(
        `matrix_scenario.${scenario.id}.viewportPixels`,
        OBSERVER_RESOURCE_LIMITS.viewportPixels,
        viewportPixels,
        "matrix",
      );
    }
    if (![1, 2, 4].includes(scenario.textScale)) throw new ObserverError("INVALID_CONTRACT", `Scenario ${scenario.id} names an unsupported text scale.`, { scenarioId: scenario.id, restartFrom: "matrix" });
    requireEnum(scenario.direction, DIRECTIONS, `matrix_scenario.${scenario.id}.direction`, "matrix");
    requireEnum(scenario.media, MEDIA, `matrix_scenario.${scenario.id}.media`, "matrix");
    requireEnum(scenario.colorMode, COLOR_MODES, `matrix_scenario.${scenario.id}.colorMode`, "matrix");
    requireEnum(scenario.motion, MOTION, `matrix_scenario.${scenario.id}.motion`, "matrix");
    requireEnum(scenario.image, IMAGE_STATES, `matrix_scenario.${scenario.id}.image`, "matrix");
    requireEnum(scenario.font, FONT_STATES, `matrix_scenario.${scenario.id}.font`, "matrix");
    requireEnum(scenario.input, INPUT_MODES, `matrix_scenario.${scenario.id}.input`, "matrix");
    requireEnum(scenario.state, RECEIVER_STATES, `matrix_scenario.${scenario.id}.state`, "matrix");
    if (Object.hasOwn(scenario, "javaScript") && typeof scenario.javaScript !== "boolean") throw new ObserverError("INVALID_CONTRACT", `Scenario ${scenario.id} requires a boolean javaScript value.`, { scenarioId: scenario.id, restartFrom: "matrix" });
    ids.add(scenario.id);
  }
  const dimensions = key => [...new Set(matrix.scenarios.map(scenario => scenario[key]))].sort();
  const textScales = dimensions("textScale");
  const directions = dimensions("direction");
  const media = dimensions("media");
  const states = dimensions("state");
  const requiredStates = ["accepted", "invalid", "pending", "stale", "success", "warning"];
  if (![1, 2, 4].every(value => textScales.includes(value)) || !["ltr", "rtl"].every(value => directions.includes(value)) || !["print", "screen"].every(value => media.includes(value)) || !requiredStates.every(value => states.includes(value))) {
    throw new ObserverError("MATRIX_COVERAGE_GAP", "The matrix must carry 100%, 200%, and 400% text, both directions, screen plus print, and every declared receiver state.", { textScales, directions, media, states, restartFrom: "matrix" });
  }
  return { scenarioCount: ids.size, textScales, directions, media, states };
}

function admitMatrix(inputMatrix) {
  const matrix = clonePlainData(inputMatrix, {
    boundary: "observation_matrix",
    restartFrom: "matrix",
  });
  return { matrix, summary: validateAdmittedMatrix(matrix) };
}

export function validateMatrix(inputMatrix) {
  return admitMatrix(inputMatrix).summary;
}

export function validateBitmapCaptureEnvelope(inputEnvelope) {
  const envelope = clonePlainData(inputEnvelope, {
    boundary: "bitmap_capture",
    restartFrom: "receiver_bitmap_boundary",
  });
  requireKeys(
    envelope,
    ["cropWidth", "cropHeight", "pixelWidth", "pixelHeight", "cardCount"],
    "bitmap_capture",
  );
  const { cropWidth, cropHeight, pixelWidth, pixelHeight, cardCount } = envelope;
  const integerCoordinates = [cropWidth, cropHeight, pixelWidth, pixelHeight, cardCount];
  if (!integerCoordinates.every(Number.isSafeInteger) || integerCoordinates.some(value => value < 1)) {
    throw new ObserverError("BITMAP_ENVELOPE_INVALID", "Bitmap capture requires positive integer dimensions and card count.", {
      restartFrom: "receiver_bitmap_boundary",
    });
  }
  if (cropWidth > OBSERVER_RESOURCE_LIMITS.bitmapCropWidth) {
    resourceLimitExceeded("bitmap.cropWidth", OBSERVER_RESOURCE_LIMITS.bitmapCropWidth, cropWidth, "receiver_bitmap_boundary");
  }
  if (cropHeight > OBSERVER_RESOURCE_LIMITS.bitmapCropHeight) {
    resourceLimitExceeded("bitmap.cropHeight", OBSERVER_RESOURCE_LIMITS.bitmapCropHeight, cropHeight, "receiver_bitmap_boundary");
  }
  if (cardCount > OBSERVER_RESOURCE_LIMITS.bitmapCardRegions) {
    resourceLimitExceeded("bitmap.cardRegions", OBSERVER_RESOURCE_LIMITS.bitmapCardRegions, cardCount, "receiver_bitmap_boundary");
  }
  const pixels = pixelWidth * pixelHeight;
  if (!Number.isSafeInteger(pixels) || pixels > OBSERVER_RESOURCE_LIMITS.bitmapPixels) {
    resourceLimitExceeded("bitmap.pixels", OBSERVER_RESOURCE_LIMITS.bitmapPixels, pixels, "receiver_bitmap_boundary");
  }
  return { cropWidth, cropHeight, pixelWidth, pixelHeight, cardCount, pixels };
}

export function validateBitmapScreenshotBytes(bytes, boundary) {
  if (!Number.isSafeInteger(bytes) || bytes < 1) {
    throw new ObserverError("BITMAP_ENVELOPE_INVALID", "Bitmap capture requires a positive encoded byte count.", {
      boundary,
      restartFrom: "receiver_bitmap_boundary",
    });
  }
  if (bytes > OBSERVER_RESOURCE_LIMITS.bitmapScreenshotBytes) {
    resourceLimitExceeded(
      boundary,
      OBSERVER_RESOURCE_LIMITS.bitmapScreenshotBytes,
      bytes,
      "receiver_bitmap_boundary",
    );
  }
  return bytes;
}

export function inspectPngScreenshot(bytes, boundary) {
  let prototype;
  try {
    prototype = ArrayBuffer.isView(bytes) ? Object.getPrototypeOf(bytes) : null;
  } catch {
    prototype = null;
  }
  if (prototype !== Buffer.prototype && prototype !== Uint8Array.prototype) {
    throw new ObserverError("BITMAP_INPUT_INVALID", "Bitmap comparison requires directly addressed Buffer or Uint8Array bytes.", {
      boundary,
      restartFrom: "receiver_bitmap_boundary",
    });
  }

  // Typed-array intrinsic accessors bypass caller-defined properties. Copying
  // the admitted view gives the parser one stable byte snapshot.
  const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
  const bufferGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer").get;
  const byteOffsetGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset").get;
  const byteLengthGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength").get;
  let backingBuffer;
  let byteOffset;
  let byteLength;
  try {
    backingBuffer = bufferGetter.call(bytes);
    byteOffset = byteOffsetGetter.call(bytes);
    byteLength = byteLengthGetter.call(bytes);
  } catch {
    throw new ObserverError("BITMAP_INPUT_INVALID", "Bitmap comparison requires directly addressed Buffer or Uint8Array bytes.", {
      boundary,
      restartFrom: "receiver_bitmap_boundary",
    });
  }
  validateBitmapScreenshotBytes(byteLength, boundary);
  const view = Buffer.from(Buffer.from(backingBuffer, byteOffset, byteLength));
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const validHeader = (
    view.byteLength >= 24
    && view.subarray(0, signature.byteLength).equals(signature)
    && view.readUInt32BE(8) === 13
    && view.toString("ascii", 12, 16) === "IHDR"
  );
  if (!validHeader) {
    throw new ObserverError("BITMAP_INPUT_INVALID", "Bitmap comparison requires a bounded PNG with an IHDR size coordinate.", {
      boundary,
      restartFrom: "receiver_bitmap_boundary",
    });
  }
  const pixelWidth = view.readUInt32BE(16);
  const pixelHeight = view.readUInt32BE(20);
  if (pixelWidth < 1 || pixelHeight < 1) {
    throw new ObserverError("BITMAP_INPUT_INVALID", "Bitmap comparison requires positive PNG dimensions.", {
      boundary,
      pixelWidth,
      pixelHeight,
      restartFrom: "receiver_bitmap_boundary",
    });
  }
  return { pixelWidth, pixelHeight };
}

const expectedGeometryControlIds = ["family", "state", "preview", "accept"];
const expectedGeometryCardIds = ["candidate", "accepted"];

function exactIdentities(items, expected) {
  if (!Array.isArray(items) || items.length !== expected.length) return false;
  const ids = new Set(items.map(item => item?.id));
  return ids.size === expected.length && expected.every(id => ids.has(id));
}

function exactOrderedIdentities(items, expected) {
  return exactIdentities(items, expected) && items.every((item, index) => item.id === expected[index]);
}

function finiteRectangle(item) {
  if (!item || typeof item !== "object") return false;
  const values = [item.width, item.height, item.left, item.right, item.top, item.bottom];
  return (
    values.every(Number.isFinite)
    && item.width > 0
    && item.height > 0
    && Math.abs(item.right - item.left - item.width) <= 0.01
    && Math.abs(item.bottom - item.top - item.height) <= 0.01
  );
}

function contentFits(item) {
  return (
    Number.isFinite(item.clientWidth)
    && Number.isFinite(item.clientHeight)
    && Number.isFinite(item.scrollWidth)
    && Number.isFinite(item.scrollHeight)
    && item.scrollWidth <= item.clientWidth + 1
    && item.scrollHeight <= item.clientHeight + 1
  );
}

function cardsKeepReadingOrder(cards, direction) {
  const byId = new Map(cards.map(card => [card.id, card]));
  const candidate = byId.get("candidate");
  const accepted = byId.get("accepted");
  if (!candidate || !accepted) return false;
  const stacked = candidate.bottom <= accepted.top + 0.5;
  const inline = direction === "rtl"
    ? accepted.right <= candidate.left + 0.5
    : candidate.right <= accepted.left + 0.5;
  return stacked || inline;
}

function evaluateSemanticObservation(observed) {
  const label = observed?.label;
  const control = observed?.control;
  return (
    observed?.accessibleName === "Specimen family"
    && observed?.labelPosition === "above"
    && observed?.labelVisible === true
    && finiteRectangle(label)
    && finiteRectangle(control)
    && label.left >= -0.5
    && label.right <= observed.viewportWidth + 0.5
    && label.top >= -0.5
    && label.bottom <= observed.viewportHeight + 0.5
    && label.bottom <= control.top + 0.5
  );
}

function evaluateGeometryObservation(observed) {
  const controls = observed?.controls;
  const cards = observed?.cards;
  const workflow = observed?.workflow;
  const finiteViewport = (
    Number.isFinite(observed?.viewportWidth)
    && observed.viewportWidth > 0
    && Number.isFinite(observed?.scrollWidth)
    && observed.scrollWidth <= observed.viewportWidth
    && ["ltr", "rtl"].includes(observed?.direction)
  );
  if (
    !finiteViewport
    || !finiteRectangle(workflow)
    || !contentFits(workflow)
    || !exactIdentities(controls, expectedGeometryControlIds)
    || !exactOrderedIdentities(cards, expectedGeometryCardIds)
  ) return false;
  const withinViewport = item => item.left >= -0.5 && item.right <= observed.viewportWidth + 0.5;
  const usableControls = controls.every(control => (
    finiteRectangle(control)
    && contentFits(control)
    && control.width >= 44
    && control.height >= 44
    && withinViewport(control)
  ));
  const readableCards = cards.every(card => (
    finiteRectangle(card)
    && contentFits(card)
    && withinViewport(card)
    && card.left >= workflow.left - 0.5
    && card.right <= workflow.right + 0.5
    && card.top >= workflow.top - 0.5
    && card.bottom <= workflow.bottom + 0.5
  ));
  return usableControls && readableCards && cardsKeepReadingOrder(cards, observed.direction);
}

function targetsForTier(tier, targets, changedTargets) {
  switch (tier) {
    case "changed_boundary":
      return targets.filter(target => changedTargets.has(target.id));
    case "smoke":
      return targets.filter(target => ["semantic", "interaction"].includes(target.oracle));
    case "full":
      return targets;
    default:
      throw new ObserverError("TIER_UNSUPPORTED", `Tier ${tier} is outside the finite observation policy.`, { tier, restartFrom: "selection" });
  }
}

function reasonForTier(tier) {
  switch (tier) {
    case "smoke":
      return "Fast semantic and interaction confidence";
    case "changed_boundary":
      return "Named receiver boundary changed";
    case "full":
      return "Release acceptance across the declared matrix";
    default:
      throw new ObserverError("TIER_UNSUPPORTED", `Tier ${tier} is outside the finite observation policy.`, { tier, restartFrom: "selection" });
  }
}

export function selectTier(inputSelection, inputInventory, inputMatrix) {
  const selection = clonePlainData(inputSelection, {
    boundary: "tier_selection",
    restartFrom: "selection",
  });
  requireKeys(selection, ["tier"], "tier_selection", ["changedTargetIds"]);
  const { tier } = selection;
  const changedTargetIds = Object.hasOwn(selection, "changedTargetIds") ? selection.changedTargetIds : [];
  if (!TIERS.has(tier)) throw new ObserverError("TIER_UNSUPPORTED", `Tier ${tier} is outside the finite observation policy.`, { tier, restartFrom: "selection" });
  const { inventory } = admitInventory(inputInventory);
  const { matrix } = admitMatrix(inputMatrix);
  requireBoundedArray(changedTargetIds, {
    boundary: "tier_selection.changedTargetIds",
    minimum: 0,
    maximum: OBSERVER_RESOURCE_LIMITS.targets,
    restartFrom: "selection",
  });
  for (const id of changedTargetIds) requireBoundedString(id, { boundary: "changed_target", field: "id", maxBytes: OBSERVER_RESOURCE_LIMITS.identifierBytes, pattern: IDENTIFIER_PATTERN, restartFrom: "selection" });
  const targetIds = new Set(inventory.targets.map(target => target.id));
  const unknown = changedTargetIds.filter(id => !targetIds.has(id));
  if (unknown.length > 0) throw new ObserverError("TARGET_UNKNOWN", "Changed-boundary selection includes an unknown target.", { unknown, restartFrom: "selection" });
  const changedTargets = new Set(changedTargetIds);
  const targets = targetsForTier(tier, inventory.targets, changedTargets);
  if (tier === "changed_boundary" && targets.length === 0) {
    throw new ObserverError("CHANGED_BOUNDARY_REQUIRED", "Changed-boundary coverage requires at least one named target.", { restartFrom: "selection" });
  }
  const scenarios = matrix.scenarios.filter(scenario => scenario.tiers.includes(tier));
  const knownScenarioIds = new Set(matrix.scenarios.map(scenario => scenario.id));
  for (const target of inventory.targets) {
    const unknownScenarioIds = [...target.scenarioIds, target.faultScenarioId].filter(id => !knownScenarioIds.has(id));
    if (unknownScenarioIds.length > 0) {
      throw new ObserverError("SCENARIO_UNKNOWN", `Target ${target.id} names a scenario outside the observation matrix.`, { targetId: target.id, unknownScenarioIds: [...new Set(unknownScenarioIds)], restartFrom: "inventory" });
    }
  }
  const selectedScenarioIds = new Set(scenarios.map(scenario => scenario.id));
  const cases = [];
  for (const target of targets) {
    for (const scenarioId of target.scenarioIds) {
      if (!selectedScenarioIds.has(scenarioId)) continue;
      cases.push({ id: `observe--${target.id}--${scenarioId}`, kind: "observation", targetId: target.id, scenarioId });
    }
    if (!selectedScenarioIds.has(target.faultScenarioId)) {
      throw new ObserverError("FAULT_SCENARIO_OUTSIDE_TIER", `Target ${target.id} requires a controlled-fault scenario inside tier ${tier}.`, { targetId: target.id, scenarioId: target.faultScenarioId, tier, restartFrom: "selection" });
    }
    cases.push({ id: `fault--${target.id}--${target.faultScenarioId}`, kind: "controlled_fault", targetId: target.id, scenarioId: target.faultScenarioId });
  }
  for (const scenario of scenarios) {
    cases.push({ id: `scenario--${scenario.id}`, kind: "scenario_contract", scenarioId: scenario.id });
  }
  return {
    tier,
    reason: reasonForTier(tier),
    targets: targets.map(target => target.id),
    scenarios: scenarios.map(scenario => scenario.id),
    cases,
    expectedWork: cases.length,
    caseCounts: {
      observation: cases.filter(entry => entry.kind === "observation").length,
      controlledFault: cases.filter(entry => entry.kind === "controlled_fault").length,
      scenarioContract: cases.filter(entry => entry.kind === "scenario_contract").length,
    },
  };
}

export function evaluateControlledObservation(inputTarget, inputObserved) {
  const target = clonePlainData(inputTarget, {
    boundary: "controlled_observation.target",
    restartFrom: "inventory",
  });
  const observed = clonePlainData(inputObserved, {
    boundary: "controlled_observation.observed",
    restartFrom: "receiver_observation",
  });
  switch (target.oracle) {
    case "semantic":
      return { status: evaluateSemanticObservation(observed) ? "pass" : "fail", normalized: observed };
    case "interaction":
      return { status: observed.focusOwner === "preview" && observed.acceptedGeneration === 0 && observed.settlement === "stale" ? "pass" : "fail", normalized: observed };
    case "geometry": {
      return { status: evaluateGeometryObservation(observed) ? "pass" : "fail", normalized: observed };
    }
    case "computed_style":
      return { status: observed.customProperty === "--contract-action" && observed.resolvedValue === "rgb(37, 70, 245)" ? "pass" : "fail", normalized: observed };
    case "bitmap_crop": {
      const metric = observed.metric;
      const counts = metric
        ? [metric.pixelWidth, metric.pixelHeight, metric.totalPixels, metric.changedPixels, metric.cardPixels, metric.cardChangedPixels]
        : [];
      const pass = (
        observed.crop === "workflow" &&
        /^[a-f0-9]{64}$/u.test(observed.screenshotSha256 ?? "") &&
        /^[a-f0-9]{64}$/u.test(observed.referenceSha256 ?? "") &&
        observed.screenshotSha256 !== observed.referenceSha256 &&
        Number.isSafeInteger(observed.screenshotBytes) &&
        observed.screenshotBytes > 0 &&
        Number.isSafeInteger(observed.referenceBytes) &&
        observed.referenceBytes > 0 &&
        metric?.kind === "connector_visibility_pixel_difference" &&
        metric?.reference === "connector_hidden" &&
        counts.every(value => Number.isSafeInteger(value) && value >= 0) &&
        metric.pixelWidth > 0 &&
        metric.pixelHeight > 0 &&
        metric.totalPixels === metric.pixelWidth * metric.pixelHeight &&
        metric.changedPixels > 0 &&
        metric.changedPixels <= metric.totalPixels &&
        metric.cardPixels > 0 &&
        metric.cardPixels <= metric.totalPixels &&
        metric.cardChangedPixels <= metric.changedPixels &&
        metric.cardChangedPixels <= metric.cardPixels &&
        metric.cardChangedPixels === 0
      );
      return { status: pass ? "pass" : "fail", normalized: observed };
    }
    default:
      throw new ObserverError("ORACLE_UNSUPPORTED", `Oracle ${target.oracle} requires a registered evaluator.`, { targetId: target.id, restartFrom: "inventory" });
  }
}

function validateAdmittedReceipt(receipt) {
  requireKeys(receipt, ["schemaVersion", "receiptId", "caseId", "targetId", "decisionBoundary", "source", "receiver", "subject", "environment", "viewportMedia", "observation", "result", "artifacts", "measurements", "standing", "classification", "restartFrom"], "receipt");
  if (receipt.schemaVersion !== "0.1.0") throw new ObserverError("RECEIPT_VERSION_UNSUPPORTED", "Receipt schemaVersion must equal 0.1.0.", { restartFrom: "receipt" });
  requireBoundedString(receipt.receiptId, { boundary: "receipt", field: "receiptId", maxBytes: OBSERVER_RESOURCE_LIMITS.identifierBytes, pattern: IDENTIFIER_PATTERN, restartFrom: "receipt" });
  requireBoundedString(receipt.caseId, { boundary: "receipt", field: "caseId", maxBytes: OBSERVER_RESOURCE_LIMITS.caseIdBytes, pattern: IDENTIFIER_PATTERN, restartFrom: "receipt" });
  requireBoundedString(receipt.targetId, { boundary: "receipt", field: "targetId", maxBytes: OBSERVER_RESOURCE_LIMITS.identifierBytes, pattern: IDENTIFIER_PATTERN, restartFrom: "receipt" });
  requireBoundedString(receipt.restartFrom, { boundary: "receipt", field: "restartFrom", maxBytes: OBSERVER_RESOURCE_LIMITS.identifierBytes, pattern: IDENTIFIER_PATTERN, restartFrom: "receipt" });
  requireBoundedString(receipt.decisionBoundary, { boundary: "receipt", field: "decisionBoundary", maxBytes: OBSERVER_RESOURCE_LIMITS.proseBytes, restartFrom: "receipt" });
  if (!ORACLES.has(receipt.observation)) throw new ObserverError("ORACLE_UNSUPPORTED", "Receipt observation type is outside the admitted set.", { observation: receipt.observation, restartFrom: "receipt" });
  requireEnum(receipt.standing, STANDINGS, "receipt.standing", "receipt");
  requireEnum(receipt.classification, CLASSIFICATIONS, "receipt.classification", "receipt");
  requireKeys(receipt.source, ["semanticId", "version", "coordinate", "manifestKind", "manifestSha256"], "receipt.source");
  requireKeys(receipt.source.coordinate, ["brand", "mode"], "receipt.source.coordinate");
  requireKeys(receipt.receiver, ["semanticId", "version", "manifestKind", "manifestSha256"], "receipt.receiver");
  for (const [boundary, coordinate] of [["receipt.source", receipt.source], ["receipt.receiver", receipt.receiver]]) {
    requireBoundedString(coordinate.semanticId, { boundary, field: "semanticId", maxBytes: OBSERVER_RESOURCE_LIMITS.identifierBytes, pattern: IDENTIFIER_PATTERN, restartFrom: "coordinate" });
    requireBoundedString(coordinate.version, { boundary, field: "version", maxBytes: OBSERVER_RESOURCE_LIMITS.identifierBytes, pattern: /^\d+\.\d+\.\d+$/u, restartFrom: "coordinate" });
  }
  for (const field of ["brand", "mode"]) requireBoundedString(receipt.source.coordinate[field], { boundary: "receipt.source.coordinate", field, maxBytes: OBSERVER_RESOURCE_LIMITS.identifierBytes, pattern: IDENTIFIER_PATTERN, restartFrom: "coordinate" });
  requireKeys(receipt.environment, ["coordinateKind", "playwrightVersion", "browserName", "browserVersion", "browserRevision", "node", "platform", "arch", "fontSet", "headless"], "receipt.environment");
  for (const field of ["coordinateKind", "playwrightVersion", "browserName", "browserVersion", "browserRevision", "node", "platform", "arch"]) {
    requireBoundedString(receipt.environment[field], { boundary: "receipt.environment", field, maxBytes: OBSERVER_RESOURCE_LIMITS.identifierBytes, restartFrom: "environment" });
  }
  requireBoundedString(receipt.environment.fontSet, { boundary: "receipt.environment", field: "fontSet", maxBytes: OBSERVER_RESOURCE_LIMITS.proseBytes, restartFrom: "environment" });
  if (typeof receipt.environment.headless !== "boolean") throw new ObserverError("INVALID_CONTRACT", "receipt.environment.headless must be boolean.", { restartFrom: "environment" });
  if (receipt.environment?.playwrightVersion !== "1.64.1") throw new ObserverError("ENVIRONMENT_COORDINATE_MISMATCH", "Receipt must bind to Playwright 1.64.1.", { observed: receipt.environment?.playwrightVersion, restartFrom: "environment" });
  for (const coordinate of [receipt.source, receipt.receiver]) {
    if (!/^[a-f0-9]{64}$/u.test(coordinate?.manifestSha256 ?? "")) throw new ObserverError("DIGEST_INVALID", "Source and receiver coordinates require SHA-256 digests.", { restartFrom: "coordinate" });
  }
  if (receipt.source.manifestKind !== SOURCE_MANIFEST_KIND || receipt.receiver.manifestKind !== RECEIVER_MANIFEST_KIND) {
    throw new ObserverError("MANIFEST_KIND_MISMATCH", "Source and receiver coordinates require their declared generated-output and production-build manifest kinds.", { sourceKind: receipt.source.manifestKind, receiverKind: receipt.receiver.manifestKind, restartFrom: "coordinate" });
  }
  requireKeys(receipt.subject, ["kind", "path", "sha256", "bytes"], "receipt.subject");
  requireBoundedString(receipt.subject.path, { boundary: "receipt.subject", field: "path", maxBytes: OBSERVER_RESOURCE_LIMITS.artifactPathBytes, pattern: ARTIFACT_PATH_PATTERN, restartFrom: "receipt" });
  if (!Number.isInteger(receipt.subject.bytes) || receipt.subject.bytes < 1 || receipt.subject.bytes > OBSERVER_RESOURCE_LIMITS.artifactBytes) resourceLimitExceeded("receipt.subject.bytes", OBSERVER_RESOURCE_LIMITS.artifactBytes, receipt.subject.bytes, "receipt");
  requireKeys(receipt.viewportMedia, ["scenarioId", "width", "height", "textScale", "direction", "media", "colorMode", "motion", "image", "font", "input", "state", "javaScript"], "receipt.viewportMedia");
  requireBoundedString(receipt.viewportMedia.scenarioId, { boundary: "receipt.viewportMedia", field: "scenarioId", maxBytes: OBSERVER_RESOURCE_LIMITS.identifierBytes, pattern: IDENTIFIER_PATTERN, restartFrom: "receipt" });
  if (!Number.isInteger(receipt.viewportMedia.width) || receipt.viewportMedia.width < 1 || receipt.viewportMedia.width > OBSERVER_RESOURCE_LIMITS.viewportWidth || !Number.isInteger(receipt.viewportMedia.height) || receipt.viewportMedia.height < 1 || receipt.viewportMedia.height > OBSERVER_RESOURCE_LIMITS.viewportHeight) {
    throw new ObserverError("VIEWPORT_INVALID", "Receipt viewport dimensions must remain inside the declared finite envelope.", { maximum: { width: OBSERVER_RESOURCE_LIMITS.viewportWidth, height: OBSERVER_RESOURCE_LIMITS.viewportHeight }, restartFrom: "receipt" });
  }
  if (![1, 2, 4].includes(receipt.viewportMedia.textScale)) throw new ObserverError("INVALID_CONTRACT", "Receipt textScale is unsupported.", { restartFrom: "receipt" });
  requireEnum(receipt.viewportMedia.direction, DIRECTIONS, "receipt.viewportMedia.direction", "receipt");
  requireEnum(receipt.viewportMedia.media, MEDIA, "receipt.viewportMedia.media", "receipt");
  requireEnum(receipt.viewportMedia.colorMode, COLOR_MODES, "receipt.viewportMedia.colorMode", "receipt");
  requireEnum(receipt.viewportMedia.motion, MOTION, "receipt.viewportMedia.motion", "receipt");
  requireEnum(receipt.viewportMedia.image, IMAGE_STATES, "receipt.viewportMedia.image", "receipt");
  requireEnum(receipt.viewportMedia.font, FONT_STATES, "receipt.viewportMedia.font", "receipt");
  requireEnum(receipt.viewportMedia.input, INPUT_MODES, "receipt.viewportMedia.input", "receipt");
  requireEnum(receipt.viewportMedia.state, RECEIVER_STATES, "receipt.viewportMedia.state", "receipt");
  if (typeof receipt.viewportMedia.javaScript !== "boolean") throw new ObserverError("INVALID_CONTRACT", "receipt.viewportMedia.javaScript must be boolean.", { restartFrom: "receipt" });
  requireKeys(receipt.result, ["status", "normalized"], "receipt.result");
  requireEnum(receipt.result.status, RESULT_STATES, "receipt.result.status", "receipt");
  validateNormalizedEnvelope(receipt.result.normalized);
  requireBoundedArray(receipt.artifacts, { boundary: "receipt.artifacts", minimum: 0, maximum: OBSERVER_RESOURCE_LIMITS.artifacts, restartFrom: "receipt" });
  const artifactPaths = new Set();
  let emittedBytes = 0;
  for (const artifact of receipt.artifacts) {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
      throw new ObserverError("ARTIFACT_BOUNDARY_INVALID", "Receipt artifacts require normalized contained paths, positive byte counts, and SHA-256 digests.", { artifact, restartFrom: "receipt" });
    }
    requireKeys(artifact, ["path", "sha256", "bytes"], "receipt.artifact");
    if (
      typeof artifact.path !== "string" ||
      !ARTIFACT_PATH_PATTERN.test(artifact.path) ||
      !/^[a-f0-9]{64}$/u.test(artifact.sha256 ?? "") ||
      !Number.isInteger(artifact.bytes) ||
      artifact.bytes < 1 ||
      artifact.bytes > OBSERVER_RESOURCE_LIMITS.artifactBytes
    ) {
      throw new ObserverError("ARTIFACT_BOUNDARY_INVALID", "Receipt artifacts require normalized contained paths, positive byte counts, and SHA-256 digests.", { artifact, restartFrom: "receipt" });
    }
    const pathBytes = Buffer.byteLength(artifact.path, "utf8");
    if (pathBytes > OBSERVER_RESOURCE_LIMITS.artifactPathBytes) resourceLimitExceeded("receipt.artifact.path", OBSERVER_RESOURCE_LIMITS.artifactPathBytes, pathBytes, "receipt");
    if (artifactPaths.has(artifact.path)) throw new ObserverError("ARTIFACT_PATH_DUPLICATE", "Receipt artifact paths must be unique.", { artifactPath: artifact.path, restartFrom: "receipt" });
    artifactPaths.add(artifact.path);
    emittedBytes += artifact.bytes;
    if (emittedBytes > OBSERVER_RESOURCE_LIMITS.aggregateArtifactBytes) resourceLimitExceeded("receipt.artifacts.bytes", OBSERVER_RESOURCE_LIMITS.aggregateArtifactBytes, emittedBytes, "receipt");
  }
  const subjectArtifact = receipt.artifacts.find(artifact => artifact.path === receipt.subject?.path);
  if (receipt.subject?.kind !== "synthetic_receiver_fixture" || !subjectArtifact || subjectArtifact.sha256 !== receipt.subject.sha256 || subjectArtifact.bytes !== receipt.subject.bytes) {
    throw new ObserverError("SUBJECT_ARTIFACT_MISMATCH", "The observed subject must name matching contained fixture bytes.", { restartFrom: "receipt" });
  }
  requireKeys(receipt.measurements, ["elapsedMs", "emittedBytes", "peakRssBytes", "assertionCount"], "receipt.measurements");
  if (
    typeof receipt.measurements.elapsedMs !== "number" ||
    !Number.isFinite(receipt.measurements.elapsedMs) ||
    receipt.measurements.elapsedMs < 0 ||
    !Number.isSafeInteger(receipt.measurements.emittedBytes) ||
    !Number.isSafeInteger(receipt.measurements.peakRssBytes) ||
    receipt.measurements.peakRssBytes < 0 ||
    !Number.isInteger(receipt.measurements?.assertionCount) ||
    receipt.measurements.assertionCount < 1 ||
    receipt.measurements?.emittedBytes !== emittedBytes
  ) {
    throw new ObserverError("MEASUREMENT_INVALID", "Receipt measurements require a positive assertion count and the exact total emitted artifact bytes.", { expectedEmittedBytes: emittedBytes, restartFrom: "receipt" });
  }
  return receipt;
}

export function validateReceipt(inputReceipt) {
  const receipt = clonePlainData(inputReceipt, { boundary: "receipt", restartFrom: "receipt" });
  return validateAdmittedReceipt(receipt);
}
