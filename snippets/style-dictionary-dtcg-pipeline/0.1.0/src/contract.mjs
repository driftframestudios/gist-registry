import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { types as utilTypes } from "node:util";

export const DEFAULT_LIMITS = Object.freeze({
  sourceBytes: 512_000,
  sourceNodes: 100_000,
  depth: 32,
  tokens: 20_000,
  references: 40_000,
  aliasDepth: 128,
  generatedFiles: 32,
  generatedBytes: 4_000_000,
});

const reservedKeys = new Set(["__proto__", "prototype", "constructor"]);
const referencePattern = /^\{([a-zA-Z0-9_.-]+)\}$/u;
const supportedTokenTypes = new Set(["boolean", "color", "dimension", "duration", "number", "string"]);
const supportedColorSpaces = new Set([
  "a98-rgb",
  "display-p3",
  "hsl",
  "hwb",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "prophoto-rgb",
  "rec2020",
  "srgb",
  "srgb-linear",
  "xyz-d50",
  "xyz-d65",
]);
const tokenProperties = new Set(["$deprecated", "$description", "$extensions", "$type", "$value"]);
const groupProperties = new Set(["$deprecated", "$description", "$extensions", "$type"]);
const SOURCE_FILE_SYSTEM = Object.freeze({ lstat, open });

export class PipelineError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PipelineError";
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

function admittedPipelineError(error) {
  if (
    error === null
    || (typeof error !== "object" && typeof error !== "function")
    || utilTypes.isProxy(error)
  ) return null;
  try {
    // Exact prototype identity inspects only the ordinary object's own
    // [[Prototype]] slot. It avoids walking a caller-controlled Proxy chain as
    // `instanceof` would.
    if (Object.getPrototypeOf(error) !== PipelineError.prototype) return null;
  } catch {
    return null;
  }
  const code = boundedOwnString(error, "code", null, 512);
  const message = boundedOwnString(error, "message", null, 4_096);
  const detailsDescriptor = ownDataDescriptor(error, "details");
  if (code === null || message === null || detailsDescriptor === null) return null;
  try {
    const details = snapshotJsonTree(detailsDescriptor.value, {
      limits: { ...DEFAULT_LIMITS, depth: 16, sourceBytes: 32_768, sourceNodes: 512 },
      path: "error.details",
    }).snapshot;
    if (!isRecord(details)) return null;
    return Object.freeze({ code, message, details });
  } catch {
    return null;
  }
}

export function compareOrdinal(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function stableStringify(value) {
  const visit = input => {
    if (Array.isArray(input)) return input.map(visit);
    if (input && typeof input === "object") {
      return Object.fromEntries(
        Object.keys(input)
          .sort(compareOrdinal)
          .map(key => [key, visit(input[key])]),
      );
    }
    return input;
  };
  return `${JSON.stringify(visit(value), null, 2)}\n`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertByteLimit(maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new PipelineError("RESOURCE_ENVELOPE_INVALID", "A byte envelope requires a non-negative safe integer.", {
      stage: "read",
      dimension: "bytes",
      observed: maxBytes,
      restartFrom: "configuration",
    });
  }
}

export async function readBoundedFile(
  path,
  {
    maxBytes = DEFAULT_LIMITS.sourceBytes,
    stage = "read",
    dimension = "source_bytes",
    label = "Token source",
    restartFrom = "source",
    fileSystem = SOURCE_FILE_SYSTEM,
  } = {},
) {
  assertByteLimit(maxBytes);
  let pathEntry;
  try {
    pathEntry = await fileSystem.lstat(path);
  } catch (error) {
    throw new PipelineError("SOURCE_FILE_UNREADABLE", `${label} requires a readable file.`, {
      stage,
      reason: boundedErrorMessage(error, "source_path_unreadable"),
      restartFrom,
    });
  }
  if (!pathEntry.isFile() || pathEntry.isSymbolicLink()) {
    throw new PipelineError("REGULAR_FILE_REQUIRED", `${label} must be a directly addressed regular file.`, {
      stage,
      restartFrom,
    });
  }
  if (pathEntry.size > maxBytes) {
    throw new PipelineError("RESOURCE_ENVELOPE_EXCEEDED", `${label} exceeds the byte envelope.`, {
      stage,
      dimension,
      observed: pathEntry.size,
      limit: maxBytes,
      restartFrom,
    });
  }

  let handle;
  try {
    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
    handle = await fileSystem.open(path, flags);
  } catch (error) {
    throw new PipelineError("SOURCE_FILE_UNREADABLE", `${label} changed or became unreadable before capture.`, {
      stage,
      reason: boundedErrorMessage(error, "source_open_failed"),
      restartFrom,
    });
  }
  let primaryError = null;
  try {
    const entry = await handle.stat();
    if (!entry.isFile()) {
      throw new PipelineError("REGULAR_FILE_REQUIRED", `${label} must be a regular file.`, {
        stage,
        restartFrom,
      });
    }
    if (entry.dev !== pathEntry.dev || entry.ino !== pathEntry.ino) {
      throw new PipelineError("SOURCE_FILE_CHANGED", `${label} changed before capture completed.`, {
        stage,
        restartFrom,
      });
    }
    if (entry.size > maxBytes) {
      throw new PipelineError("RESOURCE_ENVELOPE_EXCEEDED", `${label} exceeds the byte envelope.`, {
        stage,
        dimension,
        observed: entry.size,
        limit: maxBytes,
        restartFrom,
      });
    }

    const chunks = [];
    let observed = 0;
    let position = 0;
    while (observed <= maxBytes) {
      // Reading one byte beyond the admitted envelope detects growth between
      // stat and read while keeping allocation bounded.
      const capacity = Math.min(64 * 1024, maxBytes - observed + 1);
      const chunk = Buffer.allocUnsafe(capacity);
      const { bytesRead } = await handle.read(chunk, 0, capacity, position);
      if (bytesRead === 0) break;
      observed += bytesRead;
      position += bytesRead;
      if (observed > maxBytes) {
        throw new PipelineError("RESOURCE_ENVELOPE_EXCEEDED", `${label} exceeds the byte envelope.`, {
          stage,
          dimension,
          observed,
          limit: maxBytes,
          restartFrom,
        });
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const settledEntry = await handle.stat();
    if (
      observed !== entry.size
      || settledEntry.dev !== entry.dev
      || settledEntry.ino !== entry.ino
      || settledEntry.size !== entry.size
      || settledEntry.mtimeMs !== entry.mtimeMs
      || settledEntry.ctimeMs !== entry.ctimeMs
    ) {
      throw new PipelineError("SOURCE_FILE_CHANGED", `${label} changed during bounded capture.`, {
        stage,
        restartFrom,
      });
    }
    // Descriptor stability proves the captured bytes; the final path check
    // proves that the named source coordinate still addresses those bytes.
    let settledPathEntry;
    try {
      settledPathEntry = await fileSystem.lstat(path);
    } catch {
      throw new PipelineError("SOURCE_FILE_CHANGED", `${label} changed its addressed path during bounded capture.`, {
        stage,
        reason: "path_unavailable_after_capture",
        restartFrom,
      });
    }
    if (
      !settledPathEntry.isFile()
      || settledPathEntry.isSymbolicLink()
      || settledPathEntry.dev !== entry.dev
      || settledPathEntry.ino !== entry.ino
      || settledPathEntry.size !== entry.size
      || settledPathEntry.mtimeMs !== entry.mtimeMs
      || settledPathEntry.ctimeMs !== entry.ctimeMs
    ) {
      throw new PipelineError("SOURCE_FILE_CHANGED", `${label} changed its addressed path during bounded capture.`, {
        stage,
        reason: "path_identity_changed",
        restartFrom,
      });
    }
    return Buffer.concat(chunks, observed);
  } catch (error) {
    const admitted = admittedPipelineError(error);
    primaryError = admitted
      ? new PipelineError(admitted.code, admitted.message, admitted.details)
      : new PipelineError("SOURCE_CAPTURE_FAILED", `${label} could not complete its bounded capture.`, {
        stage,
        reason: boundedErrorMessage(error, "source_capture_failed"),
        restartFrom,
      });
    throw primaryError;
  } finally {
    try {
      await handle.close();
    } catch (error) {
      if (primaryError === null) {
        throw new PipelineError("SOURCE_FILE_CLOSE_FAILED", `${label} requires operator recovery after capture.`, {
          stage,
          reason: boundedErrorMessage(error, "source_close_failed"),
          restartFrom,
        });
      }
    }
  }
}

export async function readJson(path, { maxBytes = DEFAULT_LIMITS.sourceBytes } = {}) {
  const bytes = await readBoundedFile(path, { maxBytes });
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new PipelineError("INVALID_JSON", "Token source must contain valid JSON.", {
      stage: "parse",
      reason: boundedErrorMessage(error, "invalid_json"),
      restartFrom: "source",
    });
  }
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || utilTypes.isProxy(value) || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertSafeKey(key, path) {
  if (reservedKeys.has(key)) {
    throw new PipelineError("RESERVED_KEY", `Reserved object key at ${path}.`, {
      stage: "admission",
      tokenPath: path,
      restartFrom: "source",
    });
  }
}

function assertDepth(value, depth, limits, path) {
  const pending = [{ value, depth, path }];
  const active = new WeakSet();
  let sourceNodes = 1;
  let sourceStringBytes = 0;
  const sourceNodeLimit = limits.sourceNodes ?? DEFAULT_LIMITS.sourceNodes;
  const admitNode = child => {
    sourceNodes += 1;
    if (sourceNodes > sourceNodeLimit) {
      throw new PipelineError("RESOURCE_ENVELOPE_EXCEEDED", "Token source exceeds the node envelope.", {
        stage: "preflight",
        dimension: "source_nodes",
        observed: sourceNodes,
        limit: sourceNodeLimit,
        tokenPath: child.path,
        restartFrom: "source",
      });
    }
    pending.push(child);
  };
  const admitString = (input, tokenPath) => {
    sourceStringBytes += Buffer.byteLength(input, "utf8");
    if (sourceStringBytes > limits.sourceBytes) {
      throw new PipelineError("RESOURCE_ENVELOPE_EXCEEDED", "Token source exceeds the string-byte envelope.", {
        stage: "preflight",
        dimension: "source_string_bytes",
        observed: sourceStringBytes,
        limit: limits.sourceBytes,
        tokenPath,
        restartFrom: "source",
      });
    }
  };
  while (pending.length > 0) {
    const current = pending.pop();
    if (current.leave) {
      active.delete(current.value);
      continue;
    }
    if (current.depth > limits.depth) {
      throw new PipelineError("RESOURCE_ENVELOPE_EXCEEDED", "Token source exceeds the nesting envelope.", {
        stage: "preflight",
        dimension: "depth",
        observed: current.depth,
        limit: limits.depth,
        tokenPath: current.path,
        restartFrom: "source",
      });
    }
    if (typeof current.value === "string") {
      admitString(current.value, current.path);
      continue;
    }
    if (
      current.value === null
      || typeof current.value === "boolean"
      || (typeof current.value === "number" && Number.isFinite(current.value))
    ) {
      continue;
    }
    if (typeof current.value !== "object") {
      throw new PipelineError("INVALID_JSON_VALUE", "Token source values must stay within the JSON data model.", {
        stage: "admission",
        tokenPath: current.path || "$",
        observedType: typeof current.value,
        restartFrom: "source",
      });
    }
    // A Proxy is executable caller behavior rather than JSON-owned data.
    // Detect it before any array, prototype, key, or descriptor reflection so
    // admission returns a typed result without invoking caller traps.
    if (utilTypes.isProxy(current.value)) {
      throw new PipelineError("INVALID_JSON_VALUE", "Token source values require an owned JSON data snapshot.", {
        stage: "admission",
        tokenPath: current.path || "$",
        reason: "proxy_value",
        restartFrom: "source",
      });
    }
    if (active.has(current.value)) {
      throw new PipelineError("INVALID_JSON_VALUE", "Token source values must form an acyclic JSON tree.", {
        stage: "admission",
        tokenPath: current.path || "$",
        reason: "cyclic_reference",
        restartFrom: "source",
      });
    }
    active.add(current.value);
    pending.push({ ...current, leave: true });
    if (Array.isArray(current.value)) {
      if (sourceNodes + current.value.length > sourceNodeLimit) {
        throw new PipelineError("RESOURCE_ENVELOPE_EXCEEDED", "Token source exceeds the node envelope.", {
          stage: "preflight",
          dimension: "source_nodes",
          observed: sourceNodes + current.value.length,
          limit: sourceNodeLimit,
          tokenPath: current.path,
          restartFrom: "source",
        });
      }
      const ownKeys = Reflect.ownKeys(current.value).filter(key => key !== "length");
      const denseIndexes = ownKeys.every(key => (
        typeof key === "string"
        && /^(?:0|[1-9][0-9]*)$/u.test(key)
        && Number(key) < current.value.length
        && Object.getOwnPropertyDescriptor(current.value, key)?.enumerable === true
        && Object.hasOwn(Object.getOwnPropertyDescriptor(current.value, key) ?? {}, "value")
      ));
      if (!denseIndexes || ownKeys.length !== current.value.length) {
        throw new PipelineError("INVALID_JSON_VALUE", "Token source arrays require dense JSON elements.", {
          stage: "admission",
          tokenPath: current.path || "$",
          reason: "sparse_or_extended_array",
          restartFrom: "source",
        });
      }
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        const descriptor = Object.getOwnPropertyDescriptor(current.value, String(index));
        admitNode({
          value: descriptor.value,
          depth: current.depth + 1,
          path: `${current.path}[${index}]`,
        });
      }
    } else if (isRecord(current.value)) {
      const ownKeys = Reflect.ownKeys(current.value);
      for (let index = ownKeys.length - 1; index >= 0; index -= 1) {
        const key = ownKeys[index];
        const descriptor = Object.getOwnPropertyDescriptor(current.value, key);
        if (
          typeof key !== "string"
          || descriptor?.enumerable !== true
          || !Object.hasOwn(descriptor ?? {}, "value")
        ) {
          throw new PipelineError("INVALID_JSON_VALUE", "Token source objects require enumerable string data properties.", {
            stage: "admission",
            tokenPath: current.path || "$",
            reason: "non_json_property",
            restartFrom: "source",
          });
        }
        const childPath = current.path ? `${current.path}.${key}` : key;
        assertSafeKey(key, childPath);
        admitString(key, childPath);
        admitNode({ value: descriptor.value, depth: current.depth + 1, path: childPath });
      }
    } else {
      throw new PipelineError("INVALID_JSON_VALUE", "Token source objects require a plain JSON object shape.", {
        stage: "admission",
        tokenPath: current.path || "$",
        reason: "non_plain_object",
        restartFrom: "source",
      });
    }
  }
  return {
    sourceNodes,
    sourceStringBytes,
    // Downstream graph work reads this owned snapshot rather than returning to
    // caller-controlled object identities after admission.
    snapshot: structuredClone(value),
  };
}

export function snapshotJsonTree(value, { limits = DEFAULT_LIMITS, path = "" } = {}) {
  return assertDepth(value, 0, { ...DEFAULT_LIMITS, ...limits }, path);
}

export function normalizeCssName(path) {
  return path
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .replace(/-+/gu, "-");
}

function invalidDtcgValue(tokenPath, expectedType, reason) {
  throw new PipelineError("INVALID_DTCG_VALUE", `Token ${tokenPath} requires a valid ${expectedType} value.`, {
    stage: "admission",
    tokenPath,
    expectedType,
    reason,
    restartFrom: "source",
  });
}

function assertExactValueKeys(value, expectedKeys, tokenPath, type) {
  if (!isRecord(value)) invalidDtcgValue(tokenPath, type, "object_required");
  const actualKeys = Object.keys(value).sort(compareOrdinal);
  const allowedKeys = [...expectedKeys].sort(compareOrdinal);
  if (
    actualKeys.length !== allowedKeys.length
    || actualKeys.some((key, index) => key !== allowedKeys[index])
  ) {
    invalidDtcgValue(tokenPath, type, "unexpected_value_shape");
  }
}

function componentInRange(component, minimum, maximum, includeMaximum = true) {
  return component >= minimum && (includeMaximum ? component <= maximum : component < maximum);
}

function validateColorValue(value, tokenPath) {
  if (!isRecord(value)) invalidDtcgValue(tokenPath, "color", "structured_color_required");
  const actualKeys = Object.keys(value).sort(compareOrdinal);
  const allowedKeys = ["alpha", "colorSpace", "components", "hex"];
  if (
    actualKeys.some(key => !allowedKeys.includes(key))
    || !Object.hasOwn(value, "colorSpace")
    || !Object.hasOwn(value, "components")
  ) {
    invalidDtcgValue(tokenPath, "color", "unexpected_value_shape");
  }
  if (typeof value.colorSpace !== "string" || !supportedColorSpaces.has(value.colorSpace)) {
    invalidDtcgValue(tokenPath, "color", "unsupported_color_space");
  }
  if (!Array.isArray(value.components) || value.components.length !== 3) {
    invalidDtcgValue(tokenPath, "color", "three_components_required");
  }
  if (Object.hasOwn(value, "alpha") && (
    typeof value.alpha !== "number"
    || !Number.isFinite(value.alpha)
    || !componentInRange(value.alpha, 0, 1)
  )) {
    invalidDtcgValue(tokenPath, "color", "alpha_out_of_range");
  }
  if (Object.hasOwn(value, "hex") && (
    typeof value.hex !== "string"
    || !/^#[0-9a-fA-F]{6}$/u.test(value.hex)
  )) {
    invalidDtcgValue(tokenPath, "color", "six_digit_hex_required");
  }

  const numericComponent = (index, minimum, maximum, includeMaximum = true) => {
    const component = value.components[index];
    if (component === "none") return;
    if (
      typeof component !== "number"
      || !Number.isFinite(component)
      || !componentInRange(component, minimum, maximum, includeMaximum)
    ) {
      invalidDtcgValue(tokenPath, "color", `component_${index}_out_of_range`);
    }
  };
  if (["srgb", "srgb-linear", "display-p3", "a98-rgb", "prophoto-rgb", "rec2020", "xyz-d65", "xyz-d50"].includes(value.colorSpace)) {
    for (let index = 0; index < 3; index += 1) numericComponent(index, 0, 1);
  } else if (["hsl", "hwb"].includes(value.colorSpace)) {
    numericComponent(0, 0, 360, false);
    numericComponent(1, 0, 100);
    numericComponent(2, 0, 100);
  } else if (value.colorSpace === "lab") {
    numericComponent(0, 0, 100);
    numericComponent(1, -Infinity, Infinity);
    numericComponent(2, -Infinity, Infinity);
  } else if (value.colorSpace === "lch") {
    numericComponent(0, 0, 100);
    numericComponent(1, 0, Infinity);
    numericComponent(2, 0, 360, false);
  } else if (value.colorSpace === "oklab") {
    numericComponent(0, 0, 1);
    numericComponent(1, -Infinity, Infinity);
    numericComponent(2, -Infinity, Infinity);
  } else {
    numericComponent(0, 0, 1);
    numericComponent(1, 0, Infinity);
    numericComponent(2, 0, 360, false);
  }
}

function validateDirectTokenValue(type, value, tokenPath) {
  if (type === "boolean") {
    if (typeof value !== "boolean") invalidDtcgValue(tokenPath, type, "boolean_required");
    return;
  }
  if (type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      invalidDtcgValue(tokenPath, type, "finite_json_number_required");
    }
    return;
  }
  if (type === "string") {
    if (typeof value !== "string") invalidDtcgValue(tokenPath, type, "string_required");
    return;
  }
  if (type === "color") {
    validateColorValue(value, tokenPath);
    return;
  }
  const units = type === "dimension" ? new Set(["px", "rem"]) : new Set(["ms", "s"]);
  assertExactValueKeys(value, ["unit", "value"], tokenPath, type);
  if (typeof value.value !== "number" || !Number.isFinite(value.value)) {
    invalidDtcgValue(tokenPath, type, "finite_numeric_value_required");
  }
  if (typeof value.unit !== "string" || !units.has(value.unit)) {
    invalidDtcgValue(tokenPath, type, "unsupported_unit");
  }
}

function assertMetadata(node, path, allowedProperties) {
  for (const key of Object.keys(node)) {
    if (key.startsWith("$") && !allowedProperties.has(key)) {
      throw new PipelineError("UNSUPPORTED_DTCG_FEATURE", `Property ${key} at ${path || "$"} is outside the admitted subset.`, {
        stage: "admission",
        tokenPath: path || "$",
        property: key,
        restartFrom: "source",
      });
    }
  }
  if (Object.hasOwn(node, "$description") && typeof node.$description !== "string") {
    throw new PipelineError("INVALID_DTCG_STRUCTURE", `Description at ${path || "$"} requires a JSON string.`, {
      stage: "admission",
      tokenPath: path || "$",
      property: "$description",
      restartFrom: "source",
    });
  }
  if (Object.hasOwn(node, "$extensions") && !isRecord(node.$extensions)) {
    throw new PipelineError("INVALID_DTCG_STRUCTURE", `Extensions at ${path || "$"} require a JSON object.`, {
      stage: "admission",
      tokenPath: path || "$",
      property: "$extensions",
      restartFrom: "source",
    });
  }
  if (Object.hasOwn(node, "$deprecated") && !["boolean", "string"].includes(typeof node.$deprecated)) {
    throw new PipelineError("INVALID_DTCG_STRUCTURE", `Deprecation metadata at ${path || "$"} requires a boolean or string.`, {
      stage: "admission",
      tokenPath: path || "$",
      property: "$deprecated",
      restartFrom: "source",
    });
  }
  if (Object.hasOwn(node, "$type") && typeof node.$type !== "string") {
    throw new PipelineError("INVALID_DTCG_STRUCTURE", `Type metadata at ${path || "$"} requires a JSON string.`, {
      stage: "admission",
      tokenPath: path || "$",
      property: "$type",
      restartFrom: "source",
    });
  }
}

function assertTokenOrGroupName(name, path) {
  if (name.startsWith("$") || /[{}.]/u.test(name)) {
    throw new PipelineError("INVALID_TOKEN_PATH", `Token and group name ${name} at ${path} uses a reserved path character.`, {
      stage: "admission",
      tokenPath: path,
      restartFrom: "source",
    });
  }
}

export function collectTokens(document, { limits = DEFAULT_LIMITS } = {}) {
  limits = { ...DEFAULT_LIMITS, ...limits };
  document = assertDepth(document, 0, limits, "").snapshot;
  if (!isRecord(document)) {
    throw new PipelineError("INVALID_DTCG_STRUCTURE", "A token document requires a root JSON object.", {
      stage: "admission",
      tokenPath: "$",
      restartFrom: "source",
    });
  }
  const tokens = new Map();
  const walk = (node, path = [], inheritedType = null) => {
    const nodePath = path.join(".");
    if (!isRecord(node)) {
      throw new PipelineError("INVALID_DTCG_STRUCTURE", `Token or group ${nodePath || "$"} requires a JSON object.`, {
        stage: "admission",
        tokenPath: nodePath || "$",
        restartFrom: "source",
      });
    }
    const isToken = Object.hasOwn(node, "$value");
    assertMetadata(node, nodePath, isToken ? tokenProperties : groupProperties);
    const type = typeof node.$type === "string" ? node.$type : inheritedType;
    if (type && !supportedTokenTypes.has(type)) {
      throw new PipelineError("UNSUPPORTED_DTCG_FEATURE", `${nodePath || "Token document"} uses a type outside the admitted subset.`, {
        stage: "admission",
        tokenPath: nodePath || "$",
        observedType: type,
        restartFrom: "source",
      });
    }
    if (isToken) {
      const tokenPath = nodePath;
      if (!tokenPath) {
        throw new PipelineError("INVALID_TOKEN_PATH", "A token requires a stable path.", {
          stage: "admission",
          restartFrom: "source",
        });
      }
      const childProperty = Object.keys(node).find(key => !key.startsWith("$"));
      if (childProperty) {
        throw new PipelineError("TOKEN_GROUP_CONFLICT", `Token ${tokenPath} also declares child ${childProperty}.`, {
          stage: "admission",
          tokenPath,
          childProperty,
          restartFrom: "source",
        });
      }
      const alias = typeof node.$value === "string" ? node.$value.match(referencePattern) : null;
      if (!type && !alias) {
        throw new PipelineError("MISSING_TYPE", `Token ${tokenPath} requires an inherited or local $type.`, {
          stage: "admission",
          tokenPath,
          restartFrom: "source",
        });
      }
      if (!alias) validateDirectTokenValue(type, node.$value, tokenPath);
      if (tokens.has(tokenPath)) {
        throw new PipelineError("DUPLICATE_TOKEN", `Token ${tokenPath} appears more than once.`, {
          stage: "admission",
          tokenPath,
          restartFrom: "source",
        });
      }
      tokens.set(tokenPath, {
        path: tokenPath,
        type,
        value: structuredClone(node.$value),
        description: typeof node.$description === "string" ? node.$description : null,
        extensions: isRecord(node.$extensions) ? structuredClone(node.$extensions) : {},
      });
      if (tokens.size > limits.tokens) {
        throw new PipelineError("RESOURCE_ENVELOPE_EXCEEDED", "Token count exceeds the configured envelope.", {
          stage: "admission",
          dimension: "tokens",
          observed: tokens.size,
          limit: limits.tokens,
          tokenPath,
          restartFrom: "source",
        });
      }
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("$")) continue;
      const childPath = [...path, key].join(".");
      assertSafeKey(key, childPath);
      assertTokenOrGroupName(key, childPath);
      walk(child, [...path, key], type);
    }
  };
  walk(document);
  return tokens;
}

export function validateTokenGraph(document, { limits = DEFAULT_LIMITS } = {}) {
  limits = { ...DEFAULT_LIMITS, ...limits };
  const tokens = collectTokens(document, { limits });
  const edges = new Map([...tokens.keys()].map(path => [path, []]));
  const normalizedNames = new Map();
  let referenceCount = 0;

  for (const token of tokens.values()) {
    const normalized = normalizeCssName(token.path);
    const existing = normalizedNames.get(normalized);
    if (existing && existing !== token.path) {
      throw new PipelineError("NORMALIZED_NAME_COLLISION", "Two token paths share one CSS identifier.", {
        stage: "target_preflight",
        normalizedName: normalized,
        tokenPaths: [existing, token.path],
        restartFrom: "source",
      });
    }
    normalizedNames.set(normalized, token.path);
    const match = typeof token.value === "string" ? token.value.match(referencePattern) : null;
    if (!match) continue;
    referenceCount += 1;
    if (referenceCount > limits.references) {
      throw new PipelineError("RESOURCE_ENVELOPE_EXCEEDED", "Reference count exceeds the configured envelope.", {
        stage: "graph",
        dimension: "references",
        observed: referenceCount,
        limit: limits.references,
        tokenPath: token.path,
        restartFrom: "source",
      });
    }
    const target = tokens.get(match[1]);
    if (!target) {
      throw new PipelineError("UNRESOLVED_REFERENCE", `Token ${token.path} references ${match[1]}.`, {
        stage: "graph",
        tokenPath: token.path,
        reference: match[1],
        restartFrom: "source",
      });
    }
    edges.get(token.path).push(target.path);
  }

  const state = new Map();
  const aliasDepths = new Map();
  const activeIndexes = new Map();
  let visits = 0;
  let maximumAliasDepth = 0;
  for (const startPath of tokens.keys()) {
    visits += 1;
    if (state.get(startPath) === "done") continue;
    const frames = [{ path: startPath, nextTargetIndex: 0, aliasDepth: 1 }];
    state.set(startPath, "active");
    activeIndexes.set(startPath, 0);
    while (frames.length > 0) {
      const frame = frames.at(-1);
      const targets = edges.get(frame.path);
      if (frame.nextTargetIndex < targets.length) {
        const target = targets[frame.nextTargetIndex];
        frame.nextTargetIndex += 1;
        visits += 1;
        const standing = state.get(target);
        if (standing === "active") {
          const cycleStart = activeIndexes.get(target);
          throw new PipelineError("ALIAS_CYCLE", "Alias graph contains a cycle.", {
            stage: "graph",
            referencePath: [...frames.slice(cycleStart).map(entry => entry.path), target],
            restartFrom: "source",
          });
        }
        if (standing === "done") {
          frame.aliasDepth = Math.max(frame.aliasDepth, 1 + aliasDepths.get(target));
          continue;
        }
        const observedDepth = frames.length + 1;
        if (observedDepth > limits.aliasDepth) {
          throw new PipelineError("RESOURCE_ENVELOPE_EXCEEDED", "Alias depth exceeds the configured envelope.", {
            stage: "graph",
            dimension: "alias_depth",
            observed: observedDepth,
            limit: limits.aliasDepth,
            tokenPath: target,
            restartFrom: "source",
          });
        }
        state.set(target, "active");
        activeIndexes.set(target, frames.length);
        frames.push({ path: target, nextTargetIndex: 0, aliasDepth: 1 });
        continue;
      }
      if (frame.aliasDepth > limits.aliasDepth) {
        throw new PipelineError("RESOURCE_ENVELOPE_EXCEEDED", "Alias depth exceeds the configured envelope.", {
          stage: "graph",
          dimension: "alias_depth",
          observed: frame.aliasDepth,
          limit: limits.aliasDepth,
          tokenPath: frame.path,
          restartFrom: "source",
        });
      }
      frames.pop();
      activeIndexes.delete(frame.path);
      state.set(frame.path, "done");
      aliasDepths.set(frame.path, frame.aliasDepth);
      maximumAliasDepth = Math.max(maximumAliasDepth, frame.aliasDepth);
      if (frames.length > 0) {
        const parent = frames.at(-1);
        parent.aliasDepth = Math.max(parent.aliasDepth, 1 + frame.aliasDepth);
        if (parent.aliasDepth > limits.aliasDepth) {
          throw new PipelineError("RESOURCE_ENVELOPE_EXCEEDED", "Alias depth exceeds the configured envelope.", {
            stage: "graph",
            dimension: "alias_depth",
            observed: parent.aliasDepth,
            limit: limits.aliasDepth,
            tokenPath: parent.path,
            restartFrom: "source",
          });
        }
      }
    }
  }

  // Alias-only tokens may inherit type from their resolved target. Every
  // untyped token is assigned once, so this second pass remains O(N + E).
  for (const startToken of tokens.values()) {
    if (startToken.type) continue;
    const trail = [];
    let current = startToken;
    while (!current.type) {
      trail.push(current);
      const targetPath = edges.get(current.path)[0];
      if (!targetPath) {
        throw new PipelineError("MISSING_TYPE", `Token ${current.path} requires an inherited, local, or referenced type.`, {
          stage: "graph",
          tokenPath: current.path,
          restartFrom: "source",
        });
      }
      current = tokens.get(targetPath);
    }
    for (const token of trail) token.type = current.type;
  }

  for (const token of tokens.values()) {
    const targetPath = edges.get(token.path)[0];
    if (!targetPath) continue;
    const target = tokens.get(targetPath);
    if (target.type !== token.type) {
      throw new PipelineError("REFERENCE_TYPE_MISMATCH", `Token ${token.path} and ${target.path} use different types.`, {
        stage: "graph",
        tokenPath: token.path,
        reference: target.path,
        expectedType: token.type,
        observedType: target.type,
        restartFrom: "source",
      });
    }
  }

  return {
    tokens,
    edges,
    metrics: {
      tokenCount: tokens.size,
      referenceCount,
      graphVisits: visits,
      maximumAliasDepth,
      normalizedNameCount: normalizedNames.size,
    },
  };
}

export function resolveTokens(validation) {
  const resolved = new Map();
  for (const startPath of validation.tokens.keys()) {
    if (resolved.has(startPath)) continue;
    const chain = [];
    let path = startPath;
    while (!resolved.has(path)) {
      chain.push(path);
      const token = validation.tokens.get(path);
      const match = typeof token.value === "string" ? token.value.match(referencePattern) : null;
      if (!match) break;
      path = match[1];
    }
    while (chain.length > 0) {
      const currentPath = chain.pop();
      const token = validation.tokens.get(currentPath);
      const match = typeof token.value === "string" ? token.value.match(referencePattern) : null;
      const value = match ? resolved.get(match[1]).value : structuredClone(token.value);
      resolved.set(currentPath, Object.freeze({ ...token, value }));
    }
  }
  return resolved;
}

export function deepMerge(...documents) {
  let aggregateNodes = 0;
  let aggregateStringBytes = 0;
  const admittedDocuments = [];
  for (const document of documents) {
    const observed = assertDepth(document, 0, DEFAULT_LIMITS, "");
    admittedDocuments.push(observed.snapshot);
    aggregateNodes += observed.sourceNodes;
    aggregateStringBytes += observed.sourceStringBytes;
    if (aggregateNodes > DEFAULT_LIMITS.sourceNodes || aggregateStringBytes > DEFAULT_LIMITS.sourceBytes) {
      const dimension = aggregateNodes > DEFAULT_LIMITS.sourceNodes ? "source_nodes" : "source_string_bytes";
      throw new PipelineError("RESOURCE_ENVELOPE_EXCEEDED", "Merged token sources exceed the configured envelope.", {
        stage: "source_merge",
        dimension,
        observed: dimension === "source_nodes" ? aggregateNodes : aggregateStringBytes,
        limit: dimension === "source_nodes" ? DEFAULT_LIMITS.sourceNodes : DEFAULT_LIMITS.sourceBytes,
        restartFrom: "source",
      });
    }
  }
  const merge = (left, right) => {
    if (!isRecord(left) || !isRecord(right) || Object.hasOwn(right, "$value")) {
      return structuredClone(right);
    }
    const output = structuredClone(left);
    for (const [key, value] of Object.entries(right)) {
      assertSafeKey(key, key);
      output[key] = Object.hasOwn(output, key) ? merge(output[key], value) : structuredClone(value);
    }
    return output;
  };
  return admittedDocuments.reduce((current, document) => merge(current, document), {});
}

function tokenPaths(document) {
  const paths = [];
  const walk = (node, path = []) => {
    if (!isRecord(node)) return;
    if (Object.hasOwn(node, "$value")) {
      paths.push(path.join("."));
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (!key.startsWith("$")) walk(value, [...path, key]);
    }
  };
  walk(document);
  return paths;
}

export function mergeTokenLayers(layers) {
  const admittedLayers = assertDepth(
    layers,
    0,
    { ...DEFAULT_LIMITS, depth: DEFAULT_LIMITS.depth + 2 },
    "layers",
  ).snapshot;
  if (!Array.isArray(admittedLayers)) {
    throw new PipelineError("INVALID_JSON_VALUE", "Token layers require a dense JSON array.", {
      stage: "source_merge",
      tokenPath: "layers",
      reason: "array_required",
      restartFrom: "source",
    });
  }
  const owners = new Map();
  let document = {};
  for (const layer of admittedLayers) {
    const paths = tokenPaths(layer.document);
    for (const path of paths) {
      const previous = owners.get(path);
      if (previous && layer.role !== "variant") {
        throw new PipelineError("SOURCE_COLLISION", `Token ${path} has more than one source owner.`, {
          stage: "source_merge",
          tokenPath: path,
          sourceOwners: [previous, layer.name],
          restartFrom: "source",
        });
      }
      owners.set(path, layer.name);
    }
    document = deepMerge(document, layer.document);
  }
  return { document, owners };
}

export function semanticDiff(accepted, candidate) {
  const beforeValidation = accepted ? validateTokenGraph(accepted) : null;
  const afterValidation = validateTokenGraph(candidate);
  const before = beforeValidation ? resolveTokens(beforeValidation) : new Map();
  const after = resolveTokens(afterValidation);
  const beforeRaw = beforeValidation?.tokens ?? new Map();
  const afterRaw = afterValidation.tokens;
  const added = [];
  const removed = [];
  const changedTypes = [];
  const changedDescriptions = [];
  const changedExtensions = [];
  const changedAliasTargets = [];
  const changedValues = [];
  for (const [path, token] of after) {
    const previous = before.get(path);
    if (!previous) {
      added.push(path);
      continue;
    }
    if (previous.type !== token.type) changedTypes.push(path);
    if (previous.description !== token.description) changedDescriptions.push(path);
    if (stableStringify(previous.extensions) !== stableStringify(token.extensions)) changedExtensions.push(path);
    const previousRaw = beforeRaw.get(path)?.value;
    const candidateRaw = afterRaw.get(path)?.value;
    const previousAliasTarget = typeof previousRaw === "string" ? previousRaw.match(referencePattern)?.[1] ?? null : null;
    const candidateAliasTarget = typeof candidateRaw === "string" ? candidateRaw.match(referencePattern)?.[1] ?? null : null;
    if (previousAliasTarget !== candidateAliasTarget) {
      changedAliasTargets.push(path);
    } else if (stableStringify(previous.value) !== stableStringify(token.value)) {
      changedValues.push(path);
    }
  }
  for (const path of before.keys()) if (!after.has(path)) removed.push(path);
  return {
    added,
    removed,
    changedTypes,
    changedDescriptions,
    changedExtensions,
    changedAliasTargets,
    changedValues,
  };
}

export function sanitizeDiagnostic(error) {
  const admitted = admittedPipelineError(error);
  if (admitted) {
    return {
      code: admitted.code,
      message: admitted.message,
      details: admitted.details,
    };
  }
  return { code: "UNEXPECTED_PIPELINE_FAILURE", message: "Pipeline execution returned an unexpected failure.", details: {} };
}
