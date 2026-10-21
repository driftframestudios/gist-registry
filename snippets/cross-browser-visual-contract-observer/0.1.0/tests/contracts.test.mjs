import assert from "node:assert/strict";
import { lstat, mkdtemp, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { evaluateControlledObservation, OBSERVER_RESOURCE_LIMITS, ObserverError, readBoundedRegularFile, readJson, selectTier, validateInventory, validateMatrix } from "../src/contracts.mjs";
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
