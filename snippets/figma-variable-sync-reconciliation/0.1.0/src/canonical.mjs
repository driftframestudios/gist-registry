import { createHash } from "node:crypto";

export function compareOrdinal(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareOrdinal(left, right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
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
