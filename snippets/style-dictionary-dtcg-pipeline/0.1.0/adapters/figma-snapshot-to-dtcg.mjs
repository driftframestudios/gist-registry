import {
  DEFAULT_LIMITS,
  PipelineError,
  compareOrdinal,
  normalizeCssName,
  snapshotJsonTree,
} from "../src/contract.mjs";

const typeMap = Object.freeze({
  BOOLEAN: "boolean",
  COLOR: "color",
  FLOAT: "number",
  STRING: "string",
});

const sensitiveText = /(?:api[_ -]?key|authorization|bearer|password|private[_ -]?url|secret|token\s*[:=])/iu;
const privateLocator = /https?:\/\/(?:localhost|127\.0\.0\.1|[^/]*\.internal)(?:[/:]|$)/iu;
const reservedSegments = new Set(["__proto__", "prototype", "constructor"]);

function invalidSourceValue(variable, reason) {
  throw new PipelineError("FIGMA_VALUE_INVALID", `Variable ${variable.name} requires a valid ${variable.resolvedType} value.`, {
    stage: "figma_adapter",
    variableId: variable.id,
    sourceType: variable.resolvedType,
    reason,
    restartFrom: "source_snapshot",
  });
}

function channelToHex(channel) {
  return Math.round(channel * 255).toString(16).padStart(2, "0");
}

function adaptSourceValue(variable, value) {
  if (variable.resolvedType === "BOOLEAN") {
    if (typeof value !== "boolean") invalidSourceValue(variable, "boolean_required");
    return value;
  }
  if (variable.resolvedType === "FLOAT") {
    if (typeof value !== "number" || !Number.isFinite(value)) invalidSourceValue(variable, "finite_number_required");
    return value;
  }
  if (variable.resolvedType === "STRING") {
    if (typeof value !== "string") invalidSourceValue(variable, "string_required");
    return value;
  }
  const prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || (prototype !== Object.prototype && prototype !== null)
  ) {
    invalidSourceValue(variable, "rgba_object_required");
  }
  const keys = Object.keys(value).sort(compareOrdinal);
  if (!(["b", "g", "r"].every(key => keys.includes(key)) && keys.every(key => ["a", "b", "g", "r"].includes(key)))) {
    invalidSourceValue(variable, "rgba_object_shape");
  }
  const alpha = Object.hasOwn(value, "a") ? value.a : 1;
  for (const [channel, component] of [["r", value.r], ["g", value.g], ["b", value.b], ["a", alpha]]) {
    if (typeof component !== "number" || !Number.isFinite(component) || component < 0 || component > 1) {
      invalidSourceValue(variable, `${channel}_channel_out_of_range`);
    }
  }
  return {
    colorSpace: "srgb",
    components: [value.r, value.g, value.b],
    alpha,
    hex: `#${channelToHex(value.r)}${channelToHex(value.g)}${channelToHex(value.b)}`,
  };
}

function safeSegments(name) {
  if (typeof name !== "string" || !name.trim()) {
    throw new PipelineError("FIGMA_NAME_REQUIRED", "Each source variable requires a stable name.", {
      stage: "figma_adapter",
      restartFrom: "source_snapshot",
    });
  }
  const segments = name
    .split("/")
    .map(segment => segment.trim().toLowerCase().replace(/[^a-z0-9-]+/gu, "-"))
    .filter(Boolean);
  if (segments.length === 0) {
    throw new PipelineError("FIGMA_NAME_REQUIRED", "Each source variable requires a stable normalized name.", {
      stage: "figma_adapter",
      restartFrom: "source_snapshot",
    });
  }
  const reserved = segments.find(segment => reservedSegments.has(segment));
  if (reserved) {
    throw new PipelineError("FIGMA_NAME_RESERVED", "A source variable name contains a reserved object segment.", {
      stage: "figma_adapter",
      reservedSegment: reserved,
      restartFrom: "source_snapshot",
    });
  }
  return segments;
}

function assignToken(root, segments, token) {
  let cursor = root;
  for (const segment of segments.slice(0, -1)) {
    if (Object.hasOwn(cursor, segment) && Object.hasOwn(cursor[segment], "$value")) {
      throw new PipelineError("FIGMA_NAME_COLLISION", "A source group and token share one normalized path.", {
        stage: "figma_adapter",
        tokenPath: segments.join("."),
        restartFrom: "source_snapshot",
      });
    }
    // Create an own group explicitly. Reading through `??=` would accept an
    // inherited Object-prototype member such as `toString` as the next group.
    if (!Object.hasOwn(cursor, segment)) cursor[segment] = Object.create(null);
    cursor = cursor[segment];
  }
  const leaf = segments.at(-1);
  if (Object.hasOwn(cursor, leaf)) {
    throw new PipelineError("FIGMA_NAME_COLLISION", "Two source variables share one normalized path.", {
      stage: "figma_adapter",
      tokenPath: segments.join("."),
      restartFrom: "source_snapshot",
    });
  }
  cursor[leaf] = token;
}

function inspectPublicBoundary(value, path = "snapshot") {
  let snapshot;
  try {
    snapshot = snapshotJsonTree(value, {
      limits: { ...DEFAULT_LIMITS, depth: 64 },
      path,
    }).snapshot;
  } catch (error) {
    if (error instanceof PipelineError && error.code === "RESOURCE_ENVELOPE_EXCEEDED") {
      throw new PipelineError(
        "SOURCE_BOUNDARY_LIMIT_EXCEEDED",
        "The source snapshot exceeds the bounded inspection envelope.",
        {
          stage: "figma_adapter",
          dimension: error.details.dimension,
          sourcePath: error.details.tokenPath ?? path,
          observed: error.details.observed,
          limit: error.details.limit,
          depthLimit: 64,
          nodeLimit: DEFAULT_LIMITS.sourceNodes,
          restartFrom: "source_snapshot",
        },
      );
    }
    if (error instanceof PipelineError && ["INVALID_JSON_VALUE", "RESERVED_KEY"].includes(error.code)) {
      throw new PipelineError(
        "SOURCE_BOUNDARY_REJECTED",
        "The source snapshot requires an owned JSON data tree.",
        {
          stage: "figma_adapter",
          sourcePath: error.details.tokenPath ?? path,
          reason: error.details.reason ?? "invalid_json_shape",
          restartFrom: "source_snapshot",
        },
      );
    }
    throw error;
  }

  const pending = [{ value: snapshot, path }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current.value === "string") {
      if (sensitiveText.test(current.value) || privateLocator.test(current.value)) {
        throw new PipelineError("SOURCE_BOUNDARY_REJECTED", "The source snapshot contains a private or secret-shaped string.", {
          stage: "figma_adapter",
          sourcePath: current.path,
          restartFrom: "source_snapshot",
        });
      }
      continue;
    }
    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        pending.push({
          value: current.value[index],
          path: `${current.path}[${index}]`,
        });
      }
      continue;
    }
    if (current.value && typeof current.value === "object") {
      for (const [key, child] of Object.entries(current.value)) {
        pending.push({
          value: child,
          path: `${current.path}.${key}`,
        });
      }
    }
  }
  return snapshot;
}

export function adaptFigmaSnapshot(snapshot, { modeName = "Light" } = {}) {
  snapshot = inspectPublicBoundary(snapshot);
  if (!snapshot || !Array.isArray(snapshot.collections)) {
    throw new PipelineError("FIGMA_COLLECTIONS_REQUIRED", "The source snapshot requires a collections array.", {
      stage: "figma_adapter",
      restartFrom: "source_snapshot",
    });
  }

  const document = { $description: "Candidate tokens adapted from a realistic synthetic Figma-shaped snapshot." };
  const sourceMap = [];
  const normalizedNames = new Map();

  for (const collection of snapshot.collections) {
    const mode = collection.modes?.find(candidate => candidate.name === modeName);
    if (!mode) {
      throw new PipelineError("FIGMA_MODE_REQUIRED", `Collection ${collection.name ?? collection.id} requires mode ${modeName}.`, {
        stage: "figma_adapter",
        collectionId: collection.id,
        restartFrom: "source_snapshot",
      });
    }
    for (const variable of collection.variables ?? []) {
      const type = typeMap[variable.resolvedType];
      if (!type) {
        throw new PipelineError("FIGMA_TYPE_UNSUPPORTED", `Variable ${variable.name} uses an unsupported source type.`, {
          stage: "figma_adapter",
          variableId: variable.id,
          sourceType: variable.resolvedType,
          restartFrom: "source_snapshot",
        });
      }
      const segments = safeSegments(variable.name);
      const path = segments.join(".");
      const normalized = normalizeCssName(path);
      if (normalizedNames.has(normalized)) {
        throw new PipelineError("FIGMA_NORMALIZED_NAME_COLLISION", "Two source variables share one generated identifier.", {
          stage: "figma_adapter",
          normalizedName: normalized,
          variableIds: [normalizedNames.get(normalized), variable.id],
          restartFrom: "source_snapshot",
        });
      }
      normalizedNames.set(normalized, variable.id);
      if (!Object.hasOwn(variable.valuesByMode ?? {}, mode.id)) {
        throw new PipelineError("FIGMA_MODE_VALUE_REQUIRED", `Variable ${variable.name} requires a value for ${modeName}.`, {
          stage: "figma_adapter",
          variableId: variable.id,
          modeId: mode.id,
          restartFrom: "source_snapshot",
        });
      }
      assignToken(document, segments, {
        $type: type,
        $value: adaptSourceValue(variable, variable.valuesByMode[mode.id]),
        ...(typeof variable.description === "string" && variable.description.trim()
          ? { $description: variable.description.trim() }
          : {}),
      });
      sourceMap.push({ tokenPath: path, collectionId: collection.id, variableId: variable.id, modeId: mode.id });
    }
  }

  sourceMap.sort((left, right) => compareOrdinal(left.tokenPath, right.tokenPath));
  return { document, sourceMap };
}
