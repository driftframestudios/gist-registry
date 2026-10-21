import assert from "node:assert/strict";
import { lstat, mkdtemp, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { evaluateControlledObservation, inspectPngScreenshot, OBSERVER_RESOURCE_LIMITS, ObserverError, readBoundedRegularFile, readJson, selectTier, validateBitmapCaptureEnvelope, validateBitmapScreenshotBytes, validateInventory, validateMatrix } from "../src/contracts.mjs";
import { packageRoot } from "../tools/paths.mjs";

const inventory = await readJson(resolve(packageRoot, "inventory/decisions.json"));
const matrix = await readJson(resolve(packageRoot, "inventory/matrix.json"));
const accepted = await readJson(resolve(packageRoot, "fixtures/accepted/observations.json"));

test("JSON admission bounds bytes and requires a directly addressed regular file", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-observer-json-"));
  const oversized = join(root, "oversized.json");
  await writeFile(oversized, "{}");
  await truncate(oversized, OBSERVER_RESOURCE_LIMITS.jsonBytes + 1);
  await assert.rejects(
    readJson(oversized),
    error => (
      error instanceof ObserverError &&
      error.code === "RESOURCE_LIMIT_EXCEEDED" &&
      error.details.boundary === "json_input.bytes"
    ),
  );

  const source = join(root, "source.json");
  const linked = join(root, "linked.json");
  await writeFile(source, "{}\n");
  await symlink(source, linked);
  await assert.rejects(
    readJson(linked),
    error => error instanceof ObserverError && error.code === "SOURCE_FILE_INVALID",
  );
});

test("bounded capture preserves typed recovery when an opened source becomes unreadable", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-observer-capture-"));
  const source = join(root, "source.bin");
  await writeFile(source, "bounded bytes");
  const entry = await lstat(source);
  let closed = false;
  const fileSystem = {
    lstat: async () => entry,
    open: async () => ({
      stat: async () => entry,
      read: async () => {
        throw new Error("injected descriptor read failure");
      },
      close: async () => {
        closed = true;
      },
    }),
  };

  await assert.rejects(
    readBoundedRegularFile(source, {
      boundary: "artifact_source.fixture",
      maxBytes: OBSERVER_RESOURCE_LIMITS.artifactBytes,
      restartFrom: "candidate",
      fileSystem,
    }),
    error => (
      error instanceof ObserverError &&
      error.code === "SOURCE_CAPTURE_FAILED" &&
      error.details.boundary === "artifact_source.fixture" &&
      error.details.restartFrom === "candidate"
    ),
  );
  assert.equal(closed, true);
});

test("decision inventory maps each target to one fitting oracle and controlled fault", () => {
  assert.deepEqual(validateInventory(inventory), {
    targetCount: 5,
    evidenceClasses: ["bitmap_crop", "computed_style", "geometry", "interaction", "semantic"],
  });
  assert.equal(new Set(inventory.targets.map(target => target.fault)).size, inventory.targets.length);
});

test("finite matrix carries the declared accessibility and media dimensions", () => {
  assert.deepEqual(validateMatrix(matrix), {
    scenarioCount: 10,
    textScales: [1, 2, 4],
    directions: ["ltr", "rtl"],
    media: ["print", "screen"],
    states: ["accepted", "invalid", "pending", "stale", "success", "warning"],
  });
});

test("inventory, matrix, and tier selection admit descriptor values before business validation", () => {
  const accessorInventory = structuredClone(inventory);
  let inventoryGetterCalls = 0;
  Object.defineProperty(accessorInventory.targets[0], "decision", {
    enumerable: true,
    configurable: true,
    get() {
      inventoryGetterCalls += 1;
      return "untrusted getter value";
    },
  });
  assert.throws(
    () => validateInventory(accessorInventory),
    error => error instanceof ObserverError
      && error.code === "INVALID_CONTRACT"
      && error.details.boundary === "decision_inventory.targets[0]"
      && error.details.reason === "accessor_fields_present"
      && error.details.restartFrom === "inventory",
  );
  assert.equal(inventoryGetterCalls, 0);

  const accessorMatrix = structuredClone(matrix);
  let matrixGetterCalls = 0;
  Object.defineProperty(accessorMatrix.scenarios[0].viewport, "width", {
    enumerable: true,
    configurable: true,
    get() {
      matrixGetterCalls += 1;
      return 1440;
    },
  });
  assert.throws(
    () => validateMatrix(accessorMatrix),
    error => error instanceof ObserverError
      && error.code === "INVALID_CONTRACT"
      && error.details.boundary === "observation_matrix.scenarios[0].viewport"
      && error.details.reason === "accessor_fields_present"
      && error.details.restartFrom === "matrix",
  );
  assert.equal(matrixGetterCalls, 0);

  let selectionGetterCalls = 0;
  const accessorSelection = {};
  Object.defineProperty(accessorSelection, "tier", {
    enumerable: true,
    configurable: true,
    get() {
      selectionGetterCalls += 1;
      return "full";
    },
  });
  assert.throws(
    () => selectTier(accessorSelection, inventory, matrix),
    error => error instanceof ObserverError
      && error.code === "INVALID_CONTRACT"
      && error.details.boundary === "tier_selection"
      && error.details.reason === "accessor_fields_present"
      && error.details.restartFrom === "selection",
  );
  assert.equal(selectionGetterCalls, 0);
});

test("admission accepts transparent proxies without reading through get traps", () => {
  let getTrapCalls = 0;
  const proxiedInventory = structuredClone(inventory);
  proxiedInventory.targets = new Proxy(proxiedInventory.targets, {
    get(target, key, receiver) {
      getTrapCalls += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  const proxiedMatrix = structuredClone(matrix);
  proxiedMatrix.scenarios = new Proxy(proxiedMatrix.scenarios, {
    get(target, key, receiver) {
      getTrapCalls += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  const selection = new Proxy({ tier: "smoke" }, {
    get(target, key, receiver) {
      getTrapCalls += 1;
      return Reflect.get(target, key, receiver);
    },
  });

  assert.equal(validateInventory(proxiedInventory).targetCount, inventory.targets.length);
  assert.equal(validateMatrix(proxiedMatrix).scenarioCount, matrix.scenarios.length);
  assert.equal(selectTier(selection, proxiedInventory, proxiedMatrix).tier, "smoke");
  assert.equal(getTrapCalls, 0);
});

test("admission rejects Array subclasses before invoking inherited iteration", () => {
  let iteratorCalls = 0;
  class ActiveArray extends Array {
    [Symbol.iterator]() {
      iteratorCalls += 1;
      throw new Error("array iteration escaped admission");
    }
  }
  const subclassInventory = structuredClone(inventory);
  subclassInventory.targets = new ActiveArray(...subclassInventory.targets);

  assert.throws(
    () => validateInventory(subclassInventory),
    error => error instanceof ObserverError
      && error.code === "INVALID_CONTRACT"
      && error.details.boundary === "decision_inventory.targets"
      && error.details.reason === "plain_array_required"
      && error.details.restartFrom === "inventory",
  );
  assert.equal(iteratorCalls, 0);
});

test("inventory and matrix reject fields outside their closed contracts", () => {
  const inventoryWithExtra = structuredClone(inventory);
  inventoryWithExtra.generatedAt = "later";
  assert.throws(
    () => validateInventory(inventoryWithExtra),
    error => error instanceof ObserverError && error.code === "INVALID_CONTRACT" && error.details.unknown.includes("generatedAt"),
  );

  const targetWithExtra = structuredClone(inventory);
  targetWithExtra.targets[0].selector = "#family";
  assert.throws(
    () => validateInventory(targetWithExtra),
    error => error instanceof ObserverError && error.code === "INVALID_CONTRACT" && error.details.unknown.includes("selector"),
  );

  const matrixWithExtra = structuredClone(matrix);
  matrixWithExtra.scenarios[0].browser = "chromium";
  assert.throws(
    () => validateMatrix(matrixWithExtra),
    error => error instanceof ObserverError && error.code === "INVALID_CONTRACT" && error.details.unknown.includes("browser"),
  );

  const viewportWithExtra = structuredClone(matrix);
  viewportWithExtra.scenarios[0].viewport.scale = 2;
  assert.throws(
    () => validateMatrix(viewportWithExtra),
    error => error instanceof ObserverError && error.code === "INVALID_CONTRACT" && error.details.unknown.includes("scale"),
  );
});

test("inventory caps target count and UTF-8 identifier plus prose bytes", () => {
  const tooMany = structuredClone(inventory);
  tooMany.targets = Array.from({ length: OBSERVER_RESOURCE_LIMITS.targets + 1 }, (_, index) => ({
    ...inventory.targets[0],
    id: `target-${index}`,
    fault: `fault-${index}`,
  }));
  assert.throws(
    () => validateInventory(tooMany),
    error => error instanceof ObserverError && error.code === "RESOURCE_LIMIT_EXCEEDED" && error.details.boundary === "decision_inventory.targets",
  );

  const wideIdentifier = structuredClone(inventory);
  wideIdentifier.targets[0].id = "é".repeat(Math.floor(OBSERVER_RESOURCE_LIMITS.identifierBytes / 2) + 1);
  assert.throws(
    () => validateInventory(wideIdentifier),
    error => error instanceof ObserverError && error.code === "RESOURCE_LIMIT_EXCEEDED" && error.details.boundary === "decision_target.id",
  );

  const wideProse = structuredClone(inventory);
  wideProse.targets[0].decision = "é".repeat(Math.floor(OBSERVER_RESOURCE_LIMITS.proseBytes / 2) + 1);
  assert.throws(
    () => validateInventory(wideProse),
    error => error instanceof ObserverError && error.code === "RESOURCE_LIMIT_EXCEEDED" && error.details.boundary === "decision_target.decision",
  );
});

test("matrix caps scenario count and viewport dimensions", () => {
  const tooMany = structuredClone(matrix);
  tooMany.scenarios = Array.from({ length: OBSERVER_RESOURCE_LIMITS.scenarios + 1 }, (_, index) => ({
    ...matrix.scenarios[0],
    id: `scenario-${index}`,
  }));
  assert.throws(
    () => validateMatrix(tooMany),
    error => error instanceof ObserverError && error.code === "RESOURCE_LIMIT_EXCEEDED" && error.details.boundary === "observation_matrix.scenarios",
  );

  const oversizedViewport = structuredClone(matrix);
  oversizedViewport.scenarios[0].viewport.width = OBSERVER_RESOURCE_LIMITS.viewportWidth + 1;
  assert.throws(
    () => validateMatrix(oversizedViewport),
    error => error instanceof ObserverError && error.code === "VIEWPORT_INVALID",
  );

  const exactPixelProduct = structuredClone(matrix);
  exactPixelProduct.scenarios[0].viewport = { width: 2048, height: 2048 };
  assert.doesNotThrow(() => validateMatrix(exactPixelProduct));

  const excessivePixelProduct = structuredClone(matrix);
  excessivePixelProduct.scenarios[0].viewport = { width: 2049, height: 2048 };
  assert.throws(
    () => validateMatrix(excessivePixelProduct),
    error => (
      error instanceof ObserverError
      && error.code === "RESOURCE_LIMIT_EXCEEDED"
      && error.details.boundary === "matrix_scenario.baseline.viewportPixels"
    ),
  );
});

test("bitmap admission caps crop, decoded pixels, regions, and encoded bytes before comparison", () => {
  assert.deepEqual(
    validateBitmapCaptureEnvelope({
      cropWidth: 2048,
      cropHeight: 2048,
      pixelWidth: 2048,
      pixelHeight: 2048,
      cardCount: OBSERVER_RESOURCE_LIMITS.bitmapCardRegions,
    }),
    {
      cropWidth: 2048,
      cropHeight: 2048,
      pixelWidth: 2048,
      pixelHeight: 2048,
      cardCount: OBSERVER_RESOURCE_LIMITS.bitmapCardRegions,
      pixels: OBSERVER_RESOURCE_LIMITS.bitmapPixels,
    },
  );
  for (const [candidate, boundary] of [
    [{ cropWidth: 2048, cropHeight: 2048, pixelWidth: 2049, pixelHeight: 2048, cardCount: 2 }, "bitmap.pixels"],
    [{ cropWidth: OBSERVER_RESOURCE_LIMITS.bitmapCropWidth + 1, cropHeight: 1, pixelWidth: 1, pixelHeight: 1, cardCount: 2 }, "bitmap.cropWidth"],
    [{ cropWidth: 1, cropHeight: OBSERVER_RESOURCE_LIMITS.bitmapCropHeight + 1, pixelWidth: 1, pixelHeight: 1, cardCount: 2 }, "bitmap.cropHeight"],
    [{ cropWidth: 1, cropHeight: 1, pixelWidth: 1, pixelHeight: 1, cardCount: OBSERVER_RESOURCE_LIMITS.bitmapCardRegions + 1 }, "bitmap.cardRegions"],
  ]) {
    assert.throws(
      () => validateBitmapCaptureEnvelope(candidate),
      error => error instanceof ObserverError && error.code === "RESOURCE_LIMIT_EXCEEDED" && error.details.boundary === boundary,
    );
  }
  assert.equal(
    validateBitmapScreenshotBytes(OBSERVER_RESOURCE_LIMITS.bitmapScreenshotBytes, "bitmap.visibleScreenshotBytes"),
    OBSERVER_RESOURCE_LIMITS.bitmapScreenshotBytes,
  );
  assert.throws(
    () => validateBitmapScreenshotBytes(OBSERVER_RESOURCE_LIMITS.bitmapScreenshotBytes + 1, "bitmap.visibleScreenshotBytes"),
    error => error instanceof ObserverError && error.code === "RESOURCE_LIMIT_EXCEEDED" && error.details.boundary === "bitmap.visibleScreenshotBytes",
  );

  const exactBoundaryPng = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(exactBoundaryPng);
  exactBoundaryPng.writeUInt32BE(13, 8);
  exactBoundaryPng.write("IHDR", 12, "ascii");
  exactBoundaryPng.writeUInt32BE(2048, 16);
  exactBoundaryPng.writeUInt32BE(2048, 20);
  assert.deepEqual(inspectPngScreenshot(exactBoundaryPng, "bitmap.testScreenshotBytes"), {
    pixelWidth: 2048,
    pixelHeight: 2048,
  });
  assert.throws(
    () => inspectPngScreenshot(Buffer.alloc(24), "bitmap.testScreenshotBytes"),
    error => error instanceof ObserverError && error.code === "BITMAP_INPUT_INVALID",
  );

  let bitmapGetCalls = 0;
  const proxiedPng = new Proxy(exactBoundaryPng, {
    get(source, key, receiver) {
      bitmapGetCalls += 1;
      return Reflect.get(source, key, receiver);
    },
  });
  assert.throws(
    () => inspectPngScreenshot(proxiedPng, "bitmap.testScreenshotBytes"),
    error => error instanceof ObserverError
      && error.code === "BITMAP_INPUT_INVALID"
      && error.details.restartFrom === "receiver_bitmap_boundary",
  );
  assert.equal(bitmapGetCalls, 0);
});

test("exported bitmap and observation evaluators snapshot plain data before reading values", () => {
  let envelopeGetterCalls = 0;
  const envelope = {
    cropHeight: 100,
    pixelWidth: 100,
    pixelHeight: 100,
    cardCount: 2,
  };
  Object.defineProperty(envelope, "cropWidth", {
    enumerable: true,
    configurable: true,
    get() {
      envelopeGetterCalls += 1;
      return 100;
    },
  });
  assert.throws(
    () => validateBitmapCaptureEnvelope(envelope),
    error => error instanceof ObserverError
      && error.code === "INVALID_CONTRACT"
      && error.details.boundary === "bitmap_capture"
      && error.details.reason === "accessor_fields_present"
      && error.details.restartFrom === "receiver_bitmap_boundary",
  );
  assert.equal(envelopeGetterCalls, 0);

  const target = structuredClone(inventory.targets.find(candidate => candidate.oracle === "semantic"));
  let targetGetterCalls = 0;
  Object.defineProperty(target, "oracle", {
    enumerable: true,
    configurable: true,
    get() {
      targetGetterCalls += 1;
      return "semantic";
    },
  });
  assert.throws(
    () => evaluateControlledObservation(target, accepted["family-label"]),
    error => error instanceof ObserverError
      && error.code === "INVALID_CONTRACT"
      && error.details.boundary === "controlled_observation.target"
      && error.details.reason === "accessor_fields_present"
      && error.details.restartFrom === "inventory",
  );
  assert.equal(targetGetterCalls, 0);

  let observedGetCalls = 0;
  const proxiedObservation = new Proxy(structuredClone(accepted["family-label"]), {
    get(source, key, receiver) {
      observedGetCalls += 1;
      return Reflect.get(source, key, receiver);
    },
  });
  assert.equal(
    evaluateControlledObservation(
      inventory.targets.find(candidate => candidate.oracle === "semantic"),
      proxiedObservation,
    ).status,
    "pass",
  );
  assert.equal(observedGetCalls, 0);
});

test("tier selection builds the exact executable applicability plan", () => {
  const smoke = selectTier({ tier: "smoke" }, inventory, matrix);
  assert.deepEqual(smoke.targets, ["family-label", "stale-settlement"]);
  assert.equal(smoke.scenarios.length, 2);
  assert.equal(smoke.expectedWork, 6);
  assert.deepEqual(smoke.caseCounts, { observation: 2, controlledFault: 2, scenarioContract: 2 });
  assert.deepEqual(smoke.cases.map(entry => entry.id), [
    "observe--family-label--baseline",
    "fault--family-label--baseline",
    "observe--stale-settlement--baseline",
    "fault--stale-settlement--baseline",
    "scenario--baseline",
    "scenario--script-independent",
  ]);
  const changed = selectTier({ tier: "changed_boundary", changedTargetIds: ["narrow-reflow", "action-token"] }, inventory, matrix);
  assert.deepEqual(changed.targets, ["narrow-reflow", "action-token"]);
  assert.equal(changed.scenarios.length, 4);
  assert.equal(changed.expectedWork, 12);
  assert.deepEqual(changed.caseCounts, { observation: 6, controlledFault: 2, scenarioContract: 4 });
  const full = selectTier({ tier: "full" }, inventory, matrix);
  assert.equal(full.targets.length, 5);
  assert.equal(full.scenarios.length, 10);
  assert.equal(full.expectedWork, 57);
  assert.deepEqual(full.caseCounts, { observation: 42, controlledFault: 5, scenarioContract: 10 });
  assert.equal(new Set(full.cases.map(entry => entry.id)).size, full.expectedWork);
});

test("applicability topology rejects unknown scenarios before it forms cases", () => {
  const candidate = structuredClone(inventory);
  candidate.targets[0].scenarioIds.push("future-coordinate");
  assert.throws(
    () => selectTier({ tier: "full" }, candidate, matrix),
    error => error instanceof ObserverError && error.code === "SCENARIO_UNKNOWN" && error.details.unknownScenarioIds.includes("future-coordinate"),
  );

  const detachedFault = structuredClone(inventory);
  detachedFault.targets[0].faultScenarioId = "script-independent";
  assert.throws(
    () => validateInventory(detachedFault),
    error => error instanceof ObserverError && error.code === "FAULT_SCENARIO_INAPPLICABLE",
  );
});

test("changed-boundary selection returns typed guidance for an unknown target", () => {
  assert.throws(
    () => selectTier({ tier: "changed_boundary", changedTargetIds: ["unowned-target"] }, inventory, matrix),
    error => error instanceof ObserverError && error.code === "TARGET_UNKNOWN" && error.details.restartFrom === "selection",
  );
});

for (const target of inventory.targets) {
  test(`${target.oracle} oracle accepts its controlled observation and rejects its matching fault`, async () => {
    const rejected = await readJson(resolve(packageRoot, `fixtures/rejected/${target.fault === "computed" ? "computed-style" : target.fault}.json`));
    assert.equal(evaluateControlledObservation(target, accepted[target.id]).status, "pass");
    assert.equal(evaluateControlledObservation(target, rejected).status, "fail");
  });
}

test("semantic oracle requires a visible, named, viewport-contained label above its control", () => {
  const target = inventory.targets.find(candidate => candidate.oracle === "semantic");
  const base = accepted[target.id];
  const mutations = [
    { ...base, accessibleName: "" },
    { ...base, labelVisible: false },
    { ...base, label: { ...base.label, width: 0, right: base.label.left } },
    { ...base, label: { ...base.label, left: -20, right: -20 + base.label.width } },
    { ...base, label: { ...base.label, top: base.control.top, bottom: base.control.top + base.label.height }, labelPosition: "other" },
  ];
  for (const mutation of mutations) {
    assert.equal(evaluateControlledObservation(target, mutation).status, "fail");
  }
});

test("geometry oracle requires named controls, contained content, and ordered non-overlapping cards", () => {
  const target = inventory.targets.find(candidate => candidate.oracle === "geometry");
  const base = accepted[target.id];
  const mutations = [
    { ...base, controls: [] },
    { ...base, scrollWidth: base.viewportWidth + 1 },
    { ...base, controls: base.controls.map((control, index) => index === 0 ? { ...control, height: 43 } : control) },
    { ...base, controls: base.controls.map((control, index) => index === 0 ? { ...control, width: 43, right: control.left + 43 } : control) },
    { ...base, controls: base.controls.map((control, index) => index === 0 ? { ...control, left: -1, right: control.width - 1 } : control) },
    { ...base, controls: base.controls.map((control, index) => index === 0 ? { ...control, id: base.controls[1].id } : control) },
    { ...base, controls: base.controls.filter(control => control.id !== "family") },
    { ...base, cards: base.cards.map(card => card.id === "accepted" ? { ...card, top: base.cards[0].top, bottom: base.cards[0].bottom } : card) },
    { ...base, cards: [...base.cards].reverse().map((card, index) => ({ ...card, top: 200 + index * 152, bottom: 288 + index * 152 })) },
    { ...base, cards: base.cards.map((card, index) => index === 0 ? { ...card, scrollHeight: card.clientHeight + 20 } : card) },
    { ...base, workflow: { ...base.workflow, scrollWidth: base.workflow.clientWidth + 20 } },
  ];
  for (const mutation of mutations) {
    assert.equal(evaluateControlledObservation(target, mutation).status, "fail");
  }
});

test("bitmap oracle requires a visible raster difference with zero changed pixels inside card regions", () => {
  const target = inventory.targets.find(candidate => candidate.oracle === "bitmap_crop");
  const base = accepted[target.id];
  const mutations = [
    { ...base, referenceSha256: base.screenshotSha256 },
    { ...base, metric: { ...base.metric, changedPixels: 0 } },
    { ...base, metric: { ...base.metric, cardPixels: 0 } },
    { ...base, metric: { ...base.metric, cardChangedPixels: 1 } },
    { ...base, metric: { ...base.metric, totalPixels: base.metric.totalPixels + 1 } },
  ];
  for (const mutation of mutations) {
    assert.equal(evaluateControlledObservation(target, mutation).status, "fail");
  }
});

test("expected contract stays aligned with inventory and matrix", async () => {
  const expected = await readJson(resolve(packageRoot, "expected/observer-contract.json"));
  assert.equal(expected.decisionCount, inventory.targets.length);
  assert.equal(expected.scenarioCount, matrix.scenarios.length);
  assert.deepEqual(expected.evidenceClasses, inventory.targets.map(target => target.oracle));
  assert.deepEqual(expected.coordinateKinds, {
    source: "generated_output_manifest",
    receiver: "production_build_manifest",
    subject: "synthetic_receiver_fixture",
  });
  assert.deepEqual(expected.casePlan, {
    smoke: selectTier({ tier: "smoke" }, inventory, matrix).expectedWork,
    changedBoundaryExample: selectTier({ tier: "changed_boundary", changedTargetIds: ["narrow-reflow", "action-token"] }, inventory, matrix).expectedWork,
    full: selectTier({ tier: "full" }, inventory, matrix).expectedWork,
  });
});
