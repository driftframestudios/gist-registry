import "../node-runtime-admission.mjs";

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
  deepMerge,
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

function srgb(hex, components, alpha = 1) {
  return { colorSpace: "srgb", components, alpha, hex };
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
  const validation = validateTokenGraph(result.document);
  assert.equal(validation.metrics.tokenCount, 2);
  assert.deepEqual(
    validation.tokens.get("action.background").value,
    srgb("#2546f5", [0.1450980392, 0.2745098039, 0.9607843137]),
  );
  assert.deepEqual(result.sourceMap.map(entry => entry.tokenPath), ["action.background", "action.focus-ring"]);
});

test("Figma-shaped colors require bounded RGBA channels before DTCG adaptation", () => {
  const snapshot = {
    collections: [{
      id: "collection-1",
      name: "Synthetic collection",
      modes: [{ id: "mode-1", name: "Light" }],
      variables: [{
        id: "variable-1",
        name: "action/background",
        resolvedType: "COLOR",
        valuesByMode: { "mode-1": "#2546f5" },
      }],
    }],
  };
  assert.throws(
    () => adaptFigmaSnapshot(snapshot),
    error => error instanceof PipelineError
      && error.code === "FIGMA_VALUE_INVALID"
      && error.details.reason === "rgba_object_required",
  );
});

test("the declared DTCG subset admits each direct value shape and inferred alias type", () => {
  const directValues = {
    boolean: true,
    color: srgb("#2546f5", [0.1450980392, 0.2745098039, 0.9607843137]),
    dimension: { value: -0.5, unit: "rem" },
    duration: { value: 1.5, unit: "s" },
    number: -2.25,
    string: "Synthetic label",
  };
  const document = {};
  for (const [type, value] of Object.entries(directValues)) {
    document[type] = {
      base: { $type: type, $value: value },
      alias: { $value: `{${type}.base}` },
    };
  }
  const validation = validateTokenGraph(document);
  assert.equal(validation.metrics.tokenCount, 12);
  assert.equal(validation.metrics.referenceCount, 6);
  for (const type of Object.keys(directValues)) {
    assert.equal(validation.tokens.get(`${type}.alias`).type, type);
  }
});

for (const [label, color] of [
  ["hsl none", { colorSpace: "hsl", components: ["none", 0, 100], hex: "#ffffff" }],
  ["lab", { colorSpace: "lab", components: [60.17, 93.54, -60.5], alpha: 1 }],
  ["lch", { colorSpace: "lch", components: [60.17, 111.4, 327.11] }],
  ["oklab", { colorSpace: "oklab", components: [0.7, -0.1, 0.2] }],
  ["oklch", { colorSpace: "oklch", components: [0.7, 0.32, 328.363] }],
  ["xyz", { colorSpace: "xyz-d65", components: [0.59, 0.28, 0.97] }],
]) {
  test(`structured color admission accepts ${label}`, () => {
    assert.equal(validateTokenGraph({ sample: { $type: "color", $value: color } }).metrics.tokenCount, 1);
  });
}

for (const [label, type, value, reason] of [
  ["boolean text", "boolean", "true", "boolean_required"],
  ["number text", "number", "1", "finite_json_number_required"],
  ["string number", "string", 1, "string_required"],
  ["dimension scalar", "dimension", 4, "object_required"],
  ["dimension missing unit", "dimension", { value: 4 }, "unexpected_value_shape"],
  ["dimension extra member", "dimension", { value: 4, unit: "px", fallback: 4 }, "unexpected_value_shape"],
  ["dimension unsupported unit", "dimension", { value: 4, unit: "pt" }, "unsupported_unit"],
  ["duration unsupported unit", "duration", { value: 120, unit: "frames" }, "unsupported_unit"],
  ["legacy hex color", "color", "#2546f5", "structured_color_required"],
  ["unknown color space", "color", { colorSpace: "synthetic", components: [0, 0, 0] }, "unsupported_color_space"],
  ["short color components", "color", { colorSpace: "srgb", components: [0, 0] }, "three_components_required"],
  ["sRGB component range", "color", { colorSpace: "srgb", components: [1.1, 0, 0] }, "component_0_out_of_range"],
  ["hue upper boundary", "color", { colorSpace: "hsl", components: [360, 50, 50] }, "component_0_out_of_range"],
  ["negative chroma", "color", { colorSpace: "oklch", components: [0.7, -0.1, 30] }, "component_1_out_of_range"],
  ["alpha range", "color", { colorSpace: "srgb", components: [0, 0, 0], alpha: 2 }, "alpha_out_of_range"],
  ["short hex fallback", "color", { colorSpace: "srgb", components: [0, 0, 0], hex: "#000" }, "six_digit_hex_required"],
  ["color extra member", "color", { colorSpace: "srgb", components: [0, 0, 0], fallback: "#000000" }, "unexpected_value_shape"],
]) {
  test(`DTCG value admission rejects ${label}`, () => {
    assert.throws(
      () => validateTokenGraph({ sample: { $type: type, $value: value } }),
      error => error instanceof PipelineError
        && error.code === "INVALID_DTCG_VALUE"
        && error.details.expectedType === type
        && error.details.reason === reason,
    );
  });
}

test("direct-call admission rejects non-finite and non-JSON values", () => {
  const customPrototype = Object.create({ inherited: true });
  customPrototype.value = "synthetic";
  const sparse = [];
  sparse.length = 2;
  sparse[1] = "synthetic";
  const cyclic = {};
  cyclic.self = cyclic;
  const accessor = {};
  Object.defineProperty(accessor, "value", { enumerable: true, get: () => "synthetic" });
  for (const value of [NaN, Infinity, undefined, 1n, new Date(0), new Map(), customPrototype, sparse, cyclic, accessor]) {
    assert.throws(
      () => validateTokenGraph({ sample: { $type: "string", $value: value } }),
      error => error instanceof PipelineError && error.code === "INVALID_JSON_VALUE",
    );
  }
});

test("direct-call admission returns typed Proxy friction without invoking traps", () => {
  const cases = [
    {
      label: "token graph",
      code: "INVALID_JSON_VALUE",
      run: value => validateTokenGraph(value),
      target: { sample: { $type: "string", $value: "synthetic" } },
    },
    {
      label: "nested token value",
      code: "INVALID_JSON_VALUE",
      run: value => validateTokenGraph({ sample: { $type: "string", $value: value } }),
      target: { source: "synthetic" },
    },
    {
      label: "source merge",
      code: "INVALID_JSON_VALUE",
      run: value => deepMerge(value),
      target: { sample: { $type: "string", $value: "synthetic" } },
    },
    {
      label: "layer merge",
      code: "INVALID_JSON_VALUE",
      run: value => mergeTokenLayers([{ name: "synthetic", role: "source", document: value }]),
      target: { sample: { $type: "string", $value: "synthetic" } },
    },
    {
      label: "Figma snapshot",
      code: "SOURCE_BOUNDARY_REJECTED",
      run: value => adaptFigmaSnapshot(value),
      target: { collections: [] },
    },
  ];

  for (const fixture of cases) {
    let trapCalls = 0;
    const failTrap = () => {
      trapCalls += 1;
      throw new Error(`caller trap escaped ${fixture.label} admission`);
    };
    const value = new Proxy(fixture.target, {
      get: failTrap,
      getOwnPropertyDescriptor: failTrap,
      getPrototypeOf: failTrap,
      has: failTrap,
      ownKeys: failTrap,
    });
    assert.throws(
      () => fixture.run(value),
      error => error instanceof PipelineError
        && error.code === fixture.code
        && error.details.reason === "proxy_value",
      fixture.label,
    );
    assert.equal(trapCalls, 0, fixture.label);
  }
});

test("a token and child group at one path return the structural conflict", () => {
  assert.throws(
    () => validateTokenGraph({
      action: {
        $type: "number",
        $value: 1,
        pressed: { $value: 2 },
      },
    }),
    error => error instanceof PipelineError
      && error.code === "TOKEN_GROUP_CONFLICT"
      && error.details.childProperty === "pressed",
  );
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

function aliasTopologyDocument(selectedValue, { base = 1, alternate = 1 } = {}) {
  return {
    base: { $type: "number", $value: base },
    alternate: { $type: "number", $value: alternate },
    selected: { $type: "number", $value: selectedValue },
  };
}

for (const [label, accepted, candidate] of [
  ["literal to alias", aliasTopologyDocument(1), aliasTopologyDocument("{base}")],
  ["alias to literal", aliasTopologyDocument("{base}"), aliasTopologyDocument(1)],
  ["equal alias target change", aliasTopologyDocument("{base}"), aliasTopologyDocument("{alternate}")],
  ["unequal alias target change", aliasTopologyDocument("{base}", { alternate: 2 }), aliasTopologyDocument("{alternate}", { alternate: 2 })],
]) {
  test(`semantic diff classifies ${label} once as topology`, () => {
    const diff = semanticDiff(accepted, candidate);
    assert.deepEqual(diff.changedAliasTargets, ["selected"]);
    assert.deepEqual(diff.changedValues, []);
  });
}

test("semantic diff reports resolved value changes when alias topology stays stable", () => {
  const diff = semanticDiff(
    aliasTopologyDocument("{base}", { base: 1 }),
    aliasTopologyDocument("{base}", { base: 2 }),
  );
  assert.deepEqual(diff.changedAliasTargets, []);
  assert.deepEqual(diff.changedValues, ["base", "selected"]);
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
