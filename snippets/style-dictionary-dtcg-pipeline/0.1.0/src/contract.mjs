import { createHash } from "node:crypto";
import { open } from "node:fs/promises";

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
  } = {},
) {
  assertByteLimit(maxBytes);
  const handle = await open(path, "r");
  try {
    const entry = await handle.stat();
    if (!entry.isFile()) {
      throw new PipelineError("REGULAR_FILE_REQUIRED", `${label} must be a regular file.`, {
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
    return Buffer.concat(chunks, observed);
  } finally {
    await handle.close();
  }
}

export async function readJson(path, { maxBytes = DEFAULT_LIMITS.sourceBytes } = {}) {
  const bytes = await readBoundedFile(path, { maxBytes });
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new PipelineError("INVALID_JSON", "Token source must contain valid JSON.", {
      stage: "parse",
      reason: error.message,
      restartFrom: "source",
    });
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        admitNode({
          value: current.value[index],
          depth: current.depth + 1,
          path: `${current.path}[${index}]`,
        });
      }
    } else if (isRecord(current.value)) {
      for (const key in current.value) {
        if (!Object.hasOwn(current.value, key)) continue;
        const childPath = current.path ? `${current.path}.${key}` : key;
        assertSafeKey(key, childPath);
        admitString(key, childPath);
        admitNode({ value: current.value[key], depth: current.depth + 1, path: childPath });
      }
    }
  }
  return { sourceNodes, sourceStringBytes };
}

export function normalizeCssName(path) {
  return path
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .replace(/-+/gu, "-");
}

export function collectTokens(document, { limits = DEFAULT_LIMITS } = {}) {
  limits = { ...DEFAULT_LIMITS, ...limits };
  assertDepth(document, 0, limits, "");
  const tokens = new Map();
  const walk = (node, path = [], inheritedType = null) => {
    if (!isRecord(node)) return;
    const type = typeof node.$type === "string" ? node.$type : inheritedType;
    if (Object.hasOwn(node, "$value")) {
      const tokenPath = path.join(".");
      if (!tokenPath) {
        throw new PipelineError("INVALID_TOKEN_PATH", "A token requires a stable path.", {
          stage: "admission",
          restartFrom: "source",
        });
      }
      if (!type) {
        throw new PipelineError("MISSING_TYPE", `Token ${tokenPath} requires an inherited or local $type.`, {
          stage: "admission",
          tokenPath,
          restartFrom: "source",
        });
      }
      if (!supportedTokenTypes.has(type)) {
        throw new PipelineError("UNSUPPORTED_DTCG_FEATURE", `Token ${tokenPath} uses a type outside the admitted subset.`, {
          stage: "admission",
          tokenPath,
          observedType: type,
          restartFrom: "source",
        });
      }
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
      assertSafeKey(key, [...path, key].join("."));
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
  for (const document of documents) {
    const observed = assertDepth(document, 0, DEFAULT_LIMITS, "");
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
  return documents.reduce((current, document) => merge(current, document), {});
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
  const owners = new Map();
  let document = {};
  for (const layer of layers) {
    assertDepth(layer.document, 0, DEFAULT_LIMITS, "");
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
    if (typeof previousRaw === "string" && referencePattern.test(previousRaw) && previousRaw !== candidateRaw) {
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
  if (error instanceof PipelineError) return error.toJSON();
  return { code: "UNEXPECTED_PIPELINE_FAILURE", message: "Pipeline execution returned an unexpected failure.", details: {} };
}
