import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { adaptFigmaSnapshot } from "../adapters/figma-snapshot-to-dtcg.mjs";
import { BUILD_MATRIX, coordinateId } from "../config/build-matrix.mjs";
import {
  DEFAULT_LIMITS,
  PipelineError,
  mergeTokenLayers,
  semanticDiff,
  stableStringify,
  validateTokenGraph,
} from "../src/contract.mjs";
import { loadCoordinate } from "../tools/load-coordinate.mjs";
import { packageRoot } from "../tools/paths.mjs";

async function fixture(path) {
  return JSON.parse(await readFile(resolve(packageRoot, path), "utf8"));
}

test("all brand and mode coordinates share the complete admitted graph", async () => {
  const observed = [];
  for (const coordinate of BUILD_MATRIX) {
    const { validation } = await loadCoordinate(coordinate);
    observed.push({ coordinate: coordinateId(coordinate), ...validation.metrics });
  }
  assert.deepEqual(
    observed.map(({ coordinate, tokenCount, referenceCount }) => ({ coordinate, tokenCount, referenceCount })),
    [
      { coordinate: "acme-dark", tokenCount: 39, referenceCount: 24 },
      { coordinate: "acme-light", tokenCount: 39, referenceCount: 24 },
      { coordinate: "research-dark", tokenCount: 39, referenceCount: 24 },
      { coordinate: "research-light", tokenCount: 39, referenceCount: 24 },
    ],
  );
});

test("Figma-shaped input adapts through a bounded source map", async () => {
  const snapshot = await fixture("fixtures/accepted/figma-snapshot.json");
  const result = adaptFigmaSnapshot(snapshot);
  assert.equal(result.sourceMap.length, 2);
  assert.equal(validateTokenGraph(result.document).metrics.tokenCount, 2);
  assert.deepEqual(result.sourceMap.map(entry => entry.tokenPath), ["action.background", "action.focus-ring"]);
});

test("Figma-shaped input rejects reserved paths before object assignment", () => {
  const snapshot = {
    collections: [{
      id: "collection-1",
      name: "Synthetic collection",
      modes: [{ id: "mode-1", name: "Light" }],
      variables: [{
        id: "variable-1",
        name: "constructor/synthetic-probe",
        resolvedType: "STRING",
        valuesByMode: { "mode-1": "synthetic" },
      }],
    }],
  };
  assert.throws(
    () => adaptFigmaSnapshot(snapshot),
    error => error instanceof PipelineError && error.code === "FIGMA_NAME_RESERVED",
  );
  assert.equal(Object.hasOwn(Object, "synthetic-probe"), false);
});

test("Figma-shaped input creates own groups for inherited Object names", () => {
  const snapshot = {
    collections: [{
      id: "collection-1",
      name: "Synthetic collection",
      modes: [{ id: "mode-1", name: "Light" }],
      variables: [{
        id: "variable-1",
        name: "toString/synthetic-probe",
        resolvedType: "STRING",
        valuesByMode: { "mode-1": "synthetic" },
      }],
    }],
  };
  const result = adaptFigmaSnapshot(snapshot);
  assert.equal(Object.hasOwn(result.document, "tostring"), true);
  assert.equal(result.document.tostring["synthetic-probe"].$value, "synthetic");
});

for (const [path, code] of [
  ["fixtures/rejected/alias-cycle.json", "ALIAS_CYCLE"],
  ["fixtures/rejected/missing-reference.json", "UNRESOLVED_REFERENCE"],
  ["fixtures/rejected/type-mismatch.json", "REFERENCE_TYPE_MISMATCH"],
  ["fixtures/rejected/normalized-name-collision.json", "NORMALIZED_NAME_COLLISION"],
  ["fixtures/rejected/reserved-key.json", "RESERVED_KEY"],
]) {
  test(`rejected graph fixture returns ${code}`, async () => {
    const document = await fixture(path);
    assert.throws(() => validateTokenGraph(document), error => error instanceof PipelineError && error.code === code);
  });
}

for (const [path, code] of [
  ["fixtures/rejected/figma-unsupported-type.json", "FIGMA_TYPE_UNSUPPORTED"],
  ["fixtures/rejected/figma-incomplete-mode.json", "FIGMA_MODE_VALUE_REQUIRED"],
  ["fixtures/rejected/figma-normalized-name-collision.json", "FIGMA_NORMALIZED_NAME_COLLISION"],
  ["fixtures/rejected/figma-private-description.json", "SOURCE_BOUNDARY_REJECTED"],
]) {
  test(`rejected Figma fixture returns ${code}`, async () => {
    const document = await fixture(path);
    assert.throws(() => adaptFigmaSnapshot(document), error => error instanceof PipelineError && error.code === code);
  });
}

test("semantic diff leads with receiver-relevant changes", async () => {
  const accepted = (await loadCoordinate({ brand: "acme", mode: "light" })).document;
  const candidate = (await loadCoordinate({ brand: "research", mode: "light" })).document;
  assert.deepEqual(semanticDiff(accepted, candidate), {
    added: [],
    removed: [],
    changedTypes: [],
    changedDescriptions: [],
    changedExtensions: [],
    changedAliasTargets: ["action.background", "action.background-pressed", "action.focus-ring"],
    changedValues: ["component.action-button.background", "component.action-button.background-pressed", "component.action-button.focus-ring", "component.select.focus-ring"],
  });
});

test("independent source layers keep one owner per token path", async () => {
  const collision = await fixture("fixtures/rejected/source-collision.json");
  assert.throws(
    () => mergeTokenLayers(collision.layers),
    error => error instanceof PipelineError && error.code === "SOURCE_COLLISION",
  );
});

test("the compatibility envelope returns unsupported DTCG types to source review", async () => {
  const document = await fixture("fixtures/rejected/unsupported-dtcg-feature.json");
  assert.throws(
    () => validateTokenGraph(document),
    error => error instanceof PipelineError && error.code === "UNSUPPORTED_DTCG_FEATURE",
  );
});

function syntheticGraph(size, { fanOut = false } = {}) {
  const root = { base: { $type: "number", $value: 1 } };
  for (let index = 1; index < size; index += 1) {
    root[`token-${index}`] = {
      $type: "number",
      $value: `{${fanOut ? "base" : index === 1 ? "base" : `token-${index - 1}`}}`,
    };
  }
  return root;
}

function reverseOrderedAliasChain(size) {
  const root = {};
  for (let index = size - 1; index >= 1; index -= 1) {
    root[`token-${index}`] = {
      $type: "number",
      $value: `{${index === 1 ? "base" : `token-${index - 1}`}}`,
    };
  }
  root.base = { $type: "number", $value: 1 };
  return root;
}

function deeplyNestedValue(depth) {
  let value = { $type: "number", $value: 1 };
  for (let index = 0; index < depth; index += 1) value = { branch: value };
  return value;
}

for (const size of [100, 1_000, 10_000]) {
  test(`graph admission stays linear at ${size} synthetic tokens`, () => {
    const validation = validateTokenGraph(syntheticGraph(size, { fanOut: true }));
    assert.equal(validation.metrics.tokenCount, size);
    assert.equal(validation.metrics.referenceCount, size - 1);
    assert.equal(validation.metrics.graphVisits, size + size - 1);
  });
}

test("alias depth has an explicit finite envelope", () => {
  assert.throws(
    () => validateTokenGraph(syntheticGraph(130), { limits: { sourceBytes: 512_000, depth: 32, tokens: 20_000, references: 40_000, aliasDepth: 128, generatedFiles: 32, generatedBytes: 4_000_000 } }),
    error => error instanceof PipelineError && error.code === "RESOURCE_ENVELOPE_EXCEEDED" && error.details.dimension === "alias_depth",
  );
});

test("a reverse-ordered 10k alias chain returns the typed depth boundary", () => {
  assert.throws(
    () => validateTokenGraph(reverseOrderedAliasChain(10_000)),
    error => error instanceof PipelineError
      && error.code === "RESOURCE_ENVELOPE_EXCEEDED"
      && error.details.dimension === "alias_depth",
  );
});

test("a 10k nested source layer returns the typed nesting boundary", () => {
  assert.throws(
    () => mergeTokenLayers([
      { name: "synthetic-layer", role: "source", document: deeplyNestedValue(10_000) },
    ]),
    error => error instanceof PipelineError
      && error.code === "RESOURCE_ENVELOPE_EXCEEDED"
      && error.details.dimension === "depth",
  );
});

test("a 10k nested Figma-shaped snapshot returns the typed inspection boundary", () => {
  const snapshot = { collections: [] };
  snapshot.syntheticInspectionBranch = deeplyNestedValue(10_000);
  assert.throws(
    () => adaptFigmaSnapshot(snapshot),
    error => error instanceof PipelineError
      && error.code === "SOURCE_BOUNDARY_LIMIT_EXCEEDED"
      && error.details.depthLimit === 64,
  );
});

test("token admission bounds string leaves before cloning token values", () => {
  assert.throws(
    () => validateTokenGraph({
      oversized: { $type: "string", $value: "x".repeat(DEFAULT_LIMITS.sourceBytes + 1) },
    }),
    error => error instanceof PipelineError
      && error.code === "RESOURCE_ENVELOPE_EXCEEDED"
      && error.details.dimension === "source_string_bytes",
  );
});

test("Figma-shaped input bounds aggregate string leaves before adaptation", () => {
  assert.throws(
    () => adaptFigmaSnapshot({
      collections: [],
      syntheticDescription: "x".repeat(DEFAULT_LIMITS.sourceBytes + 1),
    }),
    error => error instanceof PipelineError
      && error.code === "SOURCE_BOUNDARY_LIMIT_EXCEEDED"
      && error.details.dimension === "source_string_bytes",
  );
});

test("source admission bounds sparse node shapes before cloning", () => {
  const sparse = [];
  sparse.length = DEFAULT_LIMITS.sourceNodes + 1;
  assert.throws(
    () => validateTokenGraph({ sparse }),
    error => error instanceof PipelineError
      && error.code === "RESOURCE_ENVELOPE_EXCEEDED"
      && error.details.dimension === "source_nodes",
  );
});

test("stable serialization orders object keys", () => {
  assert.equal(stableStringify({ z: 1, a: { y: 2, b: 3 } }), '{\n  "a": {\n    "b": 3,\n    "y": 2\n  },\n  "z": 1\n}\n');
});

test("stable serialization keeps ordinal order across process locales", async () => {
  const contractUrl = new URL("../src/contract.mjs", import.meta.url).href;
  const program = `import { stableStringify } from ${JSON.stringify(contractUrl)}; process.stdout.write(stableStringify({ "z": 1, "å": 2, "a": 3 }));`;
  const run = locale => new Promise((resolveRun, rejectRun) => {
    execFile(
      process.execPath,
      ["--input-type=module", "--eval", program],
      { env: { ...process.env, LC_ALL: locale, LANG: locale } },
      (error, stdout) => error ? rejectRun(error) : resolveRun(stdout),
    );
  });
  const [english, swedish] = await Promise.all([run("en_US.UTF-8"), run("sv_SE.UTF-8")]);
  assert.equal(english, swedish);
  assert.equal(english, '{\n  "a": 3,\n  "z": 1,\n  "å": 2\n}\n');
});
