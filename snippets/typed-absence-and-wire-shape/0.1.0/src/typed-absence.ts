type RoutePatchShape = {
  summary?: string;
  fallbackRoute?: string | null;
  headers?: Readonly<Record<string, string>>;
  retryLimit?: number;
  enabled?: boolean;
  displayLabel?: string;
};

export type RoutePatch = Readonly<RoutePatchShape>;
export type RoutePatchWire = Readonly<RoutePatchShape>;

export type PresenceCaseMeaning =
  | "omitted-retains-current"
  | "null-clears-current"
  | "present-object-replaces-current"
  | "zero-disables-retry"
  | "false-disables-route"
  | "empty-string-is-intentional";

export const routePatchPresenceMeanings = Object.freeze({
  summary: "omitted-retains-current",
  fallbackRoute: "null-clears-current",
  headers: "present-object-replaces-current",
  retryLimit: "zero-disables-retry",
  enabled: "false-disables-route",
  displayLabel: "empty-string-is-intentional",
} satisfies Readonly<Record<keyof RoutePatch, PresenceCaseMeaning>>);

const knownFields = new Set<string>(Object.keys(routePatchPresenceMeanings));

type MutableRoutePatchWire = {
  -readonly [Key in keyof RoutePatchWire]: RoutePatchWire[Key];
};

export class WireShapeError extends TypeError {
  readonly field: string;
  readonly path: readonly string[];

  constructor(path: string | readonly string[], message: string) {
    const segments = typeof path === "string" ? [path] : [...path];
    const field = segments.reduce((rendered, segment, index) => {
      const isReadableSegment = /^[A-Za-z_$][A-Za-z0-9_$-]*$/u.test(segment);
      if (index === 0) {
        return isReadableSegment ? segment : `[${JSON.stringify(segment)}]`;
      }
      return isReadableSegment
        ? `${rendered}.${segment}`
        : `${rendered}[${JSON.stringify(segment)}]`;
    }, "");
    super(`${field}: ${message}`);
    this.name = "WireShapeError";
    this.field = field;
    this.path = Object.freeze(segments);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function snapshotOwnDataProperties(
  record: Record<string, unknown>,
  { owner = [], admittedKeys }: {
    owner?: readonly string[];
    admittedKeys?: ReadonlySet<string>;
  } = {},
): ReadonlyMap<string, unknown> {
  const snapshot = new Map<string, unknown>();

  for (const propertyKey of Reflect.ownKeys(record)) {
    const key = typeof propertyKey === "string" ? propertyKey : String(propertyKey);
    const path = [...owner, key];
    if (
      typeof propertyKey !== "string" ||
      (admittedKeys !== undefined && !admittedKeys.has(key))
    ) {
      throw new WireShapeError(path, "is not a recognized field");
    }

    const descriptor = Object.getOwnPropertyDescriptor(record, propertyKey);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      throw new WireShapeError(
        path,
        "must be an enumerable own data property",
      );
    }
    if (descriptor.value === undefined) {
      throw new WireShapeError(
        path,
        "is present with undefined, which JSON cannot represent",
      );
    }
    snapshot.set(key, descriptor.value);
  }

  return snapshot;
}

function parseString(field: string, value: unknown): string {
  if (typeof value !== "string") {
    throw new WireShapeError(field, "must be a string");
  }
  return value;
}

function parseFallbackRoute(value: unknown): string | null {
  if (value === null || typeof value === "string") {
    return value;
  }
  throw new WireShapeError("fallbackRoute", "must be a string or null");
}

function parseHeaders(value: unknown): Readonly<Record<string, string>> {
  if (!isPlainRecord(value)) {
    throw new WireShapeError("headers", "must be a plain object");
  }

  const properties = snapshotOwnDataProperties(value, { owner: ["headers"] });
  const entries: Array<[string, string]> = [];
  for (const [key, headerValue] of properties) {
    if (typeof headerValue !== "string") {
      throw new WireShapeError(["headers", key], "must be a string");
    }
    entries.push([key, headerValue]);
  }
  const headers = Object.fromEntries(entries);
  Object.setPrototypeOf(headers, null);
  return Object.freeze(headers);
}

function parseRetryLimit(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new WireShapeError(
      "retryLimit",
      "must be a non-negative safe integer",
    );
  }
  return Object.is(value, -0) ? 0 : value;
}

function parseEnabled(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new WireShapeError("enabled", "must be a boolean");
  }
  return value;
}

export function projectRoutePatch(input: unknown): RoutePatchWire {
  if (!isPlainRecord(input)) {
    throw new WireShapeError("$", "must be a plain object");
  }
  const properties = snapshotOwnDataProperties(input, {
    admittedKeys: knownFields,
  });

  const output: MutableRoutePatchWire = {};

  // TARGET: omission remains visible because only an own property enters the wire shape.
  if (properties.has("summary")) {
    output.summary = parseString("summary", properties.get("summary"));
  }
  if (properties.has("fallbackRoute")) {
    output.fallbackRoute = parseFallbackRoute(properties.get("fallbackRoute"));
  }
  if (properties.has("headers")) {
    output.headers = parseHeaders(properties.get("headers"));
  }

  // CONTRAST: truthiness would discard 0, false, and the intentional empty label.
  if (properties.has("retryLimit")) {
    output.retryLimit = parseRetryLimit(properties.get("retryLimit"));
  }
  if (properties.has("enabled")) {
    output.enabled = parseEnabled(properties.get("enabled"));
  }
  if (properties.has("displayLabel")) {
    output.displayLabel = parseString(
      "displayLabel",
      properties.get("displayLabel"),
    );
  }

  for (const key of properties.keys()) {
    if (!Object.hasOwn(output, key)) {
      throw new WireShapeError(key, "has no wire projection");
    }
  }

  // GUARD: detached null-prototype data and a frozen result preserve the accepted snapshot.
  Object.setPrototypeOf(output, null);
  return Object.freeze(output);
}
