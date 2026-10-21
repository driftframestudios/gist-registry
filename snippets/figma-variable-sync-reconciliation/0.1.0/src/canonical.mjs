import { createHash } from "node:crypto";

export function compareOrdinal(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalTypeError(code, path) {
  const error = new TypeError(`Canonical JSON ${path} is outside the admitted ${code} contract.`);
  error.code = code;
  return error;
}

function recordEntries(value, path) {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw canonicalTypeError("plain_record", path);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => typeof key !== "string")) {
    throw canonicalTypeError("string_keys", path);
  }
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !("value" in descriptor)) {
      throw canonicalTypeError("enumerable_data_property", `${path}.${key}`);
    }
  }
  return keys.map(key => [key, descriptors[key].value]);
}

function arrayValues(value, path) {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw canonicalTypeError("plain_array", path);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors).filter(key => key !== "length");
  if (
    keys.length !== value.length
    || keys.some((key, index) => {
      const descriptor = descriptors[key];
      return typeof key !== "string"
        || key !== String(index)
        || !descriptor.enumerable
        || !("value" in descriptor);
    })
  ) {
    throw canonicalTypeError("dense_data_array", path);
  }
  return keys.map(key => descriptors[key].value);
}

function canonicalizeValue(value, path, active) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw canonicalTypeError("unambiguous_finite_number", path);
    }
    return value;
  }
  if (typeof value !== "object") {
    throw canonicalTypeError("json_value", path);
  }
  if (active.has(value)) throw canonicalTypeError("acyclic_value", path);

  active.add(value);
  try {
    if (Array.isArray(value)) {
      return arrayValues(value, path)
        .map((child, index) => canonicalizeValue(child, `${path}[${index}]`, active));
    }
    return Object.fromEntries(
      recordEntries(value, path)
        .sort(([left], [right]) => compareOrdinal(left, right))
        .map(([key, child]) => [key, canonicalizeValue(child, `${path}.${key}`, active)]),
    );
  } finally {
    active.delete(value);
  }
}

export function canonicalize(value) {
  return canonicalizeValue(value, "$", new WeakSet());
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

export function digest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

const secretKeyPattern = /(?:api[_-]?key|authorization|password|secret|token)/iu;
const secretValuePattern = /(?:bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]{12,})/iu;

export function assertSanitizedReceipt(value, path = "$") {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertSanitizedReceipt(child, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (secretKeyPattern.test(key)) {
        throw new TypeError(`Receipt key ${path}.${key} is credential-shaped.`);
      }
      assertSanitizedReceipt(child, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === "string" && secretValuePattern.test(value)) {
    throw new TypeError(`Receipt value ${path} is credential-shaped.`);
  }
}
