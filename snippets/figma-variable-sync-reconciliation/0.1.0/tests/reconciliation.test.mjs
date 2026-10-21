import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assertSanitizedReceipt, canonicalJson, digest } from "../src/canonical.mjs";
import {
  MAX_CHECKPOINT_OBSERVATIONS,
  MAX_CHECKPOINT_OBSERVATION_WINDOW,
  synchronizeVariables,
} from "../src/coordinator.mjs";
import { FakeVariableRemote } from "../src/fake-remote.mjs";
import { ExecutionInterruptedError, LeaseError, PlanError } from "../src/errors.mjs";
import {
  encodedBatchBytes,
  orderOperations,
  PLANNER_RESOURCE_LIMITS,
  planOperations,
} from "../src/planner.mjs";
import {
  admitRemoteIntentObservation,
  admitRemoteSettlement,
  admitRemoteSnapshot,
  REMOTE_CONTRACT_LIMITS,
} from "../src/remote-contract.mjs";
import { InMemoryCheckpointStore, InMemoryLeaseStore } from "../src/stores.mjs";

const fixture = JSON.parse(
  await readFile(new URL("../fixtures/accepted-sync.json", import.meta.url), "utf8"),
);
const cycleFixture = JSON.parse(
  await readFile(new URL("../fixtures/dependency-cycle.json", import.meta.url), "utf8"),
);
const observationTranscriptSeed = digest({
  schemaVersion: "0.1.0",
  owner: "checkpoint_observation_transcript",
});

function transcriptDigest(baseDigest, observations, startIndex = 0) {
  return observations.reduce(
    (previousDigest, observation, offset) => digest({
      previousDigest,
      index: startIndex + offset,
      observation,
    }),
    baseDigest,
  );
}

function settlementTranscriptDigest(
  { runId, planDigest, initialRemoteRevision },
  plan,
  completedBatchCount,
) {
  const completedOperationCount = plan.batches
    .slice(0, completedBatchCount)
    .reduce((count, batch) => count + batch.operations.length, 0);
  return digest({
    schemaVersion: "0.1.0",
    owner: "checkpoint_settlement_coordinate",
    runId,
    planDigest,
    initialRemoteRevision,
    completedBatchCount,
    completedOperationCount,
    expectedRemoteRevision: initialRemoteRevision + completedBatchCount,
  });
}

function harness(overrides = {}) {
  let nowMs = fixture.clockStartMs;
  return {
    remote: new FakeVariableRemote(fixture.remote),
    leaseStore: new InMemoryLeaseStore(),
    checkpointStore: new InMemoryCheckpointStore(),
    clock: { now: () => nowMs },
    sleep: async (durationMs) => {
      nowMs += durationMs;
    },
    ...overrides,
  };
}

async function runWith(h, overrides = {}) {
  return synchronizeVariables({
    runId: fixture.runId,
    owner: fixture.owner,
    operations: fixture.operations,
    maxBatchBytes: fixture.maxBatchBytes,
    ...h,
    ...overrides,
  });
}

function asyncMethodAdapter(target, methodNames, calls = []) {
  return Object.fromEntries(
    methodNames.map((methodName) => [
      methodName,
      async (...args) => {
        await Promise.resolve();
        calls.push(methodName);
        return target[methodName](...args);
      },
    ]),
  );
}

function remoteWithSnapshotFault(remote, faultAt, invalidSnapshot) {
  let snapshotCalls = 0;
  return {
    applyBatch: remote.applyBatch.bind(remote),
    readIntentResults: remote.readIntentResults.bind(remote),
    snapshot() {
      snapshotCalls += 1;
      return snapshotCalls === faultAt ? invalidSnapshot : remote.snapshot();
    },
  };
}

test("planner produces stable topological batches and detects cycles", () => {
  const ordered = orderOperations(fixture.operations);
  assert.deepEqual(
    ordered.map((operation) => operation.id),
    [
      "01-create-successor",
      "02-update-legacy-label",
      "03-rewire-component",
      "04-deprecate-legacy",
    ],
  );
  const plan = planOperations(fixture.operations, { maxBatchBytes: fixture.maxBatchBytes });
  assert.equal(plan.operationCount, 4);
  assert.equal(plan.edgeCount, 3);
  assert.ok(plan.batches.length >= 2);
  assert.throws(
    () => orderOperations(cycleFixture.operations),
    (error) => error instanceof PlanError && error.code === "dependency_cycle",
  );
});

test("temporary coordinates carry an explicit dependency on their creator", () => {
  const creator = {
    id: "create-source",
    type: "create_variable",
    tempId: "tmp:source",
    dependsOn: [],
    payload: { name: "source", resolvedType: "COLOR", value: "#315cf5" },
  };
  const referencingCreate = {
    id: "create-receiver",
    type: "create_variable",
    tempId: "tmp:receiver",
    dependsOn: [],
    payload: {
      name: "receiver",
      resolvedType: "COLOR",
      value: "#315cf5",
      referenceTo: "tmp:source",
    },
  };
  const targetingUpdate = {
    id: "update-source",
    type: "update_variable",
    targetId: "tmp:source",
    dependsOn: [],
    payload: { name: "source.current" },
  };

  for (const [consumer, field] of [
    [referencingCreate, "payload.referenceTo"],
    [targetingUpdate, "targetId"],
  ]) {
    assert.throws(
      () => orderOperations([consumer, creator]),
      (error) =>
        error instanceof PlanError
        && error.code === "temporary_reference_dependency_required"
        && error.details.operationId === consumer.id
        && error.details.creatorOperationId === creator.id
        && error.details.field === field,
    );
  }

  referencingCreate.dependsOn = [creator.id];
  assert.deepEqual(
    orderOperations([referencingCreate, creator]).map(({ id }) => id),
    [creator.id, referencingCreate.id],
  );
});

test("canonical objects and remote snapshots use locale-independent ordinal order", () => {
  const keys = { "é": 4, "a": 2, "Ä": 3, "A": 1 };
  assert.equal(
    canonicalJson(keys),
    '{\n  "A": 1,\n  "a": 2,\n  "Ä": 3,\n  "é": 4\n}\n',
  );

  const remote = new FakeVariableRemote({
    variables: Object.keys(keys).map((id) => ({
      id,
      name: id,
      resolvedType: "STRING",
      value: id,
    })),
  });
  assert.deepEqual(
    remote.snapshot().variables.map(({ id }) => id),
    ["A", "a", "Ä", "é"],
  );
});

test("planner and canonical digests admit one explicit JSON data model", () => {
  const baseOperation = {
    id: "create-json-value",
    type: "create_variable",
    tempId: "tmp:json-value",
    dependsOn: [],
    payload: { name: "json.value", resolvedType: "STRING", value: "accepted" },
  };
  const customPrototype = Object.create({ inherited: true });
  customPrototype.own = "value";
  const cyclic = {};
  cyclic.self = cyclic;
  const sparse = [];
  sparse[1] = "value";
  const extended = ["value"];
  extended.note = "outside-json-array";
  const accessor = {};
  Object.defineProperty(accessor, "value", { enumerable: true, get: () => "value" });

  for (const value of [
    new Map([["key", "value"]]),
    new Set(["value"]),
    new Date("2026-10-21T00:00:00.000Z"),
    new Uint8Array([1, 2, 3]),
    customPrototype,
    cyclic,
    sparse,
    extended,
    accessor,
    -0,
    undefined,
  ]) {
    const operation = {
      ...baseOperation,
      payload: { ...baseOperation.payload, value },
    };
    assert.throws(
      () => planOperations([operation]),
      error =>
        error instanceof PlanError
        && (error.code === "non_json_value" || error.code === "invalid_number"),
    );
    assert.throws(() => canonicalJson(value), TypeError);
  }

  const left = { alpha: [1, { beta: "first" }] };
  const sameMeaningDifferentOrder = { alpha: [1, { beta: "first" }] };
  const changedMeaning = { alpha: [1, { beta: "second" }] };
  assert.equal(digest(left), digest(sameMeaningDifferentOrder));
  assert.notEqual(digest(left), digest(changedMeaning));
  assert.doesNotThrow(() => planOperations([baseOperation]));

  const nullPrototypeValue = Object.create(null);
  nullPrototypeValue.accepted = true;
  assert.doesNotThrow(() => planOperations([{
    ...baseOperation,
    payload: { ...baseOperation.payload, value: nullPrototypeValue },
  }]));

  const admittedValues = [null, true, false, 0, 1, "1", [], [1], {}, { a: 1 }, { a: "1" }];
  const planDigests = admittedValues.map(value => planOperations([{
    ...baseOperation,
    payload: { ...baseOperation.payload, value },
  }]).planDigest);
  assert.equal(new Set(planDigests).size, admittedValues.length);
});

test("array and result admission establishes a data-only shape before reading values", () => {
  let operationReads = 0;
  const operations = [];
  Object.defineProperty(operations, "0", {
    enumerable: true,
    get() {
      operationReads += 1;
      throw new Error("operation getter executed");
    },
  });
  operations.length = 1;
  assert.throws(
    () => planOperations(operations),
    error => error instanceof PlanError && error.code === "invalid_operation_list",
  );
  assert.equal(operationReads, 0);

  const operation = structuredClone(fixture.operations[1]);
  let resultReads = 0;
  const results = [];
  Object.defineProperty(results, "0", {
    enumerable: true,
    get() {
      resultReads += 1;
      throw new Error("result getter executed");
    },
  });
  results.length = 1;
  const arrayAdmission = admitRemoteSettlement(
    { disposition: "applied", remoteRevision: 8, results },
    [operation],
  );
  assert.equal(arrayAdmission.accepted, false);
  assert.equal(arrayAdmission.reason, "result_set_shape");
  assert.equal(resultReads, 0);

  let operationIdReads = 0;
  const result = {
    type: operation.type,
    targetId: operation.targetId,
  };
  Object.defineProperty(result, "operationId", {
    enumerable: true,
    get() {
      operationIdReads += 1;
      throw new Error("operation id getter executed");
    },
  });
  const recordAdmission = admitRemoteSettlement(
    { disposition: "applied", remoteRevision: 8, results: [result] },
    [operation],
  );
  assert.equal(recordAdmission.accepted, false);
  assert.equal(recordAdmission.reason, "field_shape");
  assert.equal(operationIdReads, 0);
});

test("remote result envelopes reject oversized dense and sparse arrays before element inspection", () => {
  const operation = structuredClone(fixture.operations[1]);
  let denseElementReads = 0;
  const dense = [{}, {}];
  Object.defineProperty(dense, "0", {
    enumerable: true,
    get() {
      denseElementReads += 1;
      throw new Error("oversized dense element executed");
    },
  });
  const sparse = [];
  sparse.length = 2;

  for (const results of [dense, sparse]) {
    const settlement = admitRemoteSettlement(
      { disposition: "applied", remoteRevision: 8, results },
      [operation],
    );
    assert.equal(settlement.accepted, false);
    assert.equal(settlement.reason, "result_set_shape");

    const observation = admitRemoteIntentObservation(
      { remoteRevision: 8, results },
      [operation],
    );
    assert.equal(observation.accepted, false);
    assert.equal(observation.reason, "result_set_shape");
  }
  assert.equal(denseElementReads, 0);
});

test("present optional fields with undefined values fail typed planner admission", () => {
  const create = structuredClone(fixture.operations[0]);
  const update = structuredClone(fixture.operations[1]);
  const candidates = [
    { ...create, tempId: undefined },
    { ...create, dependsOn: undefined },
    { ...create, payload: { ...create.payload, name: undefined } },
    { ...update, targetId: undefined },
    { ...update, expectedVersion: undefined },
    { ...update, payload: undefined },
  ];
  for (const candidate of candidates) {
    assert.throws(
      () => planOperations([candidate]),
      error => error instanceof PlanError,
    );
  }
});

test("operation and payload records reject executable or inherited object shape", () => {
  const operation = Object.create({ inherited: true });
  Object.assign(operation, {
    id: "custom-operation",
    type: "create_variable",
    tempId: "tmp:custom-operation",
    dependsOn: [],
    payload: { name: "custom", resolvedType: "STRING", value: "value" },
  });
  assert.throws(
    () => planOperations([operation]),
    error => error instanceof PlanError && error.code === "invalid_operation",
  );

  const payload = Object.create({ inherited: true });
  Object.assign(payload, { name: "custom", resolvedType: "STRING", value: "value" });
  assert.throws(
    () => planOperations([{ ...operation, __proto__: Object.prototype, payload }]),
    error => error instanceof PlanError && error.code === "invalid_payload",
  );
});

test("remote snapshot admission is exact, bounded, unique, and JSON-shaped", () => {
  const valid = new FakeVariableRemote(fixture.remote).snapshot();
  assert.equal(admitRemoteSnapshot(valid).accepted, true);

  const duplicate = structuredClone(valid);
  duplicate.variables.push(structuredClone(duplicate.variables[0]));
  const unknownField = structuredClone(valid);
  unknownField.variables[0].unexpected = true;
  const cyclic = structuredClone(valid);
  cyclic.variables[0].value = {};
  cyclic.variables[0].value.self = cyclic.variables[0].value;
  let deepValue = "leaf";
  for (let depth = 0; depth <= REMOTE_CONTRACT_LIMITS.valueDepth; depth += 1) {
    deepValue = [deepValue];
  }
  const deep = structuredClone(valid);
  deep.variables[0].value = deepValue;
  const oversizedString = structuredClone(valid);
  oversizedString.variables[0].value = "x".repeat(REMOTE_CONTRACT_LIMITS.stringBytes + 1);
  const nonJson = structuredClone(valid);
  nonJson.variables[0].value = new Map([["a", 1]]);

  for (const invalid of [
    { ...valid, revision: -1 },
    { ...valid, variables: {} },
    duplicate,
    unknownField,
    cyclic,
    deep,
    oversizedString,
    nonJson,
  ]) {
    assert.equal(admitRemoteSnapshot(invalid).accepted, false);
  }
});

test("invalid initial, settled, and final snapshots return typed friction at durable boundaries", async () => {
  const operation = structuredClone(fixture.operations[1]);
  const invalidSnapshot = { revision: fixture.remote.revision, variables: {} };
  const expectations = [
    { faultAt: 1, source: "initial_snapshot", restartAt: "reconcile:initial", nextBatchIndex: null },
    { faultAt: 2, source: "settled_snapshot", restartAt: "reconcile:batch:0", nextBatchIndex: 0 },
    { faultAt: 3, source: "final_snapshot", restartAt: "reconcile:final", nextBatchIndex: 1 },
  ];

  for (const expectation of expectations) {
    const base = harness();
    const remote = remoteWithSnapshotFault(base.remote, expectation.faultAt, invalidSnapshot);
    const result = await runWith(
      { ...base, remote },
      { operations: [operation], maxBatchBytes: 4096 },
    );
    assert.equal(result.status, "friction");
    assert.equal(result.code, "remote_protocol_invalid");
    assert.equal(result.details.source, expectation.source);
    assert.equal(result.details.reason, "snapshot_variables");
    assert.equal(result.restartAt, expectation.restartAt);
    const checkpoint = base.checkpointStore.load(fixture.runId);
    assert.equal(checkpoint?.nextBatchIndex ?? null, expectation.nextBatchIndex);
  }
});

test("preflight rejects unsafe coordinates and operation envelopes before calling collaborators", async () => {
  const calls = [];
  const collaborators = {
    remote: {
      snapshot() {
        calls.push("remote.snapshot");
      },
    },
    checkpointStore: {
      claimFence() {
        calls.push("checkpoint.claimFence");
      },
      load() {
        calls.push("checkpoint.load");
      },
      save() {
        calls.push("checkpoint.save");
      },
    },
    leaseStore: {
      acquire() {
        calls.push("lease.acquire");
      },
    },
    clock: {
      now() {
        calls.push("clock.now");
        return fixture.clockStartMs;
      },
    },
  };

  await assert.rejects(
    runWith(collaborators, { runId: "sk-abcdefghijklmnop" }),
    (error) => error instanceof PlanError && error.code === "credential_shaped_input",
  );
  assert.deepEqual(calls, []);

  await assert.rejects(
    runWith(collaborators, { owner: "../writer" }),
    (error) => error instanceof PlanError && error.code === "invalid_run_coordinate",
  );
  assert.deepEqual(calls, []);

  const operationWithExtraField = { ...fixture.operations[0], traceContext: "synthetic" };
  await assert.rejects(
    runWith(collaborators, { operations: [operationWithExtraField] }),
    (error) => error instanceof PlanError && error.code === "operation_field_outside_contract",
  );
  assert.deepEqual(calls, []);

  let deeplyNestedValue = "leaf";
  for (let depth = 0; depth < 64; depth += 1) {
    deeplyNestedValue = { branch: deeplyNestedValue };
  }
  const deeplyNestedOperation = structuredClone(fixture.operations[0]);
  deeplyNestedOperation.payload.value = deeplyNestedValue;
  await assert.rejects(
    runWith(collaborators, { operations: [deeplyNestedOperation] }),
    (error) => error instanceof PlanError && error.code === "value_limit_exceeded",
  );
  assert.deepEqual(calls, []);
});

test("planner rejects oversized string, batch, and aggregate plan envelopes before cloning or digesting", () => {
  const oversizedString = structuredClone(fixture.operations[0]);
  oversizedString.payload.value = "x".repeat(PLANNER_RESOURCE_LIMITS.valueStringBytes + 1);
  assert.throws(
    () => planOperations([oversizedString]),
    (error) => error instanceof PlanError && error.code === "value_string_limit_exceeded",
  );

  assert.throws(
    () => planOperations(fixture.operations, {
      maxBatchBytes: PLANNER_RESOURCE_LIMITS.batchBytes + 1,
    }),
    (error) => error instanceof PlanError && error.code === "invalid_batch_limit",
  );

  const boundedLeaf = "x".repeat(PLANNER_RESOURCE_LIMITS.valueStringBytes);
  const template = {
    id: "create-0000",
    type: "create_variable",
    tempId: "tmp:0000",
    dependsOn: [],
    payload: { name: "space.scale.0000", resolvedType: "STRING", value: boundedLeaf },
  };
  const operationBytes = Buffer.byteLength(JSON.stringify(template), "utf8");
  const operationCount = Math.ceil(PLANNER_RESOURCE_LIMITS.planBytes / operationBytes) + 1;
  const oversizedPlan = Array.from({ length: operationCount }, (_, index) => {
    const suffix = String(index).padStart(4, "0");
    return {
      ...template,
      id: `create-${suffix}`,
      tempId: `tmp:${suffix}`,
      payload: { ...template.payload, name: `space.scale.${suffix}` },
    };
  });
  assert.throws(
    () => planOperations(oversizedPlan, { maxBatchBytes: PLANNER_RESOURCE_LIMITS.batchBytes }),
    (error) => error instanceof PlanError && error.code === "plan_size_limit_exceeded",
  );
});

test("accepted synchronization publishes the successor and rewires the component", async () => {
  const h = harness();
  const receipt = await runWith(h);
  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.operationCount, 4);
  assert.equal(receipt.initialRemoteRevision, 7);
  assert.equal(receipt.resumedFromBatch, 0);
  assertSanitizedReceipt(receipt);

  const snapshot = h.remote.snapshot();
  const successorId = receipt.tempIdToRealId["tmp:color-accent-current"];
  assert.ok(successorId);
  assert.equal(snapshot.variables.find((item) => item.id === successorId).name, "color.accent.current");
  assert.equal(snapshot.variables.find((item) => item.id === "var_0002").referenceTo, successorId);
  assert.equal(snapshot.variables.find((item) => item.id === "var_0001").deprecated, true);
});

test("async remote, store, lease, clock, and fault collaborators settle before acceptance", async () => {
  const base = harness();
  const calls = [];
  let releaseSettled = false;
  const asyncLeaseStore = asyncMethodAdapter(base.leaseStore, ["acquire", "renew"], calls);
  asyncLeaseStore.release = async (...args) => {
    await Promise.resolve();
    calls.push("release");
    const result = base.leaseStore.release(...args);
    releaseSettled = true;
    return result;
  };
  const result = await runWith({
    remote: asyncMethodAdapter(
      base.remote,
      ["snapshot", "applyBatch", "readIntentResults"],
      calls,
    ),
    checkpointStore: asyncMethodAdapter(
      base.checkpointStore,
      ["claimFence", "load", "save"],
      calls,
    ),
    leaseStore: asyncLeaseStore,
    clock: asyncMethodAdapter(base.clock, ["now"], calls),
    sleep: async (durationMs) => base.sleep(durationMs),
  }, {
    faultFor: async () => null,
  });

  assert.equal(result.status, "accepted");
  assert.equal(releaseSettled, true);
  assert.equal(calls.at(-1), "release");
  for (const methodName of [
    "acquire",
    "renew",
    "claimFence",
    "load",
    "save",
    "snapshot",
    "applyBatch",
    "now",
  ]) {
    assert.ok(calls.includes(methodName), methodName);
  }
});

test("async retry and outcome-unknown rejections enter the same bounded reconciliation path", async () => {
  const base = harness();
  const result = await runWith({
    ...base,
    remote: asyncMethodAdapter(
      base.remote,
      ["snapshot", "applyBatch", "readIntentResults"],
    ),
    checkpointStore: asyncMethodAdapter(
      base.checkpointStore,
      ["claimFence", "load", "save"],
    ),
    leaseStore: asyncMethodAdapter(base.leaseStore, ["acquire", "renew", "release"]),
  }, {
    faultFor: async ({ batchIndex, attempt }) => {
      if (batchIndex === 0 && attempt === 0) {
        return { kind: "retry_after", retryAfterMs: 125 };
      }
      if (batchIndex === 0 && attempt === 1) {
        return { kind: "response_lost" };
      }
      return null;
    },
  });

  assert.equal(result.status, "accepted");
  assert.ok(result.observations.some(({ classification }) => classification === "bounded_retry"));
  assert.ok(result.observations.some(({ classification }) => classification === "already_applied"));
  assert.ok(
    result.observations.some(
      ({ classification }) => classification === "reconciled_after_unknown_outcome",
    ),
  );
});

test("an async lease-release rejection is awaited and returns a typed recovery owner", async () => {
  const base = harness();
  const leaseStore = asyncMethodAdapter(base.leaseStore, ["acquire", "renew"]);
  leaseStore.release = async () => {
    await Promise.resolve();
    throw new Error("synthetic release transport fault");
  };

  await assert.rejects(
    runWith({ ...base, leaseStore }),
    (error) =>
      error instanceof LeaseError
      && error.code === "lease_release_failed"
      && error.details.restartAt === "inspect_writer_lease",
  );

  const plan = planOperations(fixture.operations, { maxBatchBytes: fixture.maxBatchBytes });
  assert.equal(base.checkpointStore.load(fixture.runId).nextBatchIndex, plan.batches.length);
  assert.equal(base.remote.snapshot().revision, fixture.remote.revision + plan.batches.length);
});

test("a primary async collaborator failure retains authority when lease release also rejects", async () => {
  const base = harness();
  const primaryFailure = new Error("synthetic checkpoint read fault");
  let causeReads = 0;
  const existingCause = new Error("existing primary context");
  Object.defineProperty(primaryFailure, "cause", {
    configurable: false,
    get() {
      causeReads += 1;
      return existingCause;
    },
  });
  const checkpointStore = {
    claimFence: async (...args) => base.checkpointStore.claimFence(...args),
    load: async () => {
      throw primaryFailure;
    },
    save: async (...args) => base.checkpointStore.save(...args),
  };
  const leaseStore = asyncMethodAdapter(base.leaseStore, ["acquire", "renew"]);
  leaseStore.release = async () => {
    throw new Error("synthetic lease release fault");
  };

  await assert.rejects(
    runWith({ ...base, checkpointStore, leaseStore }),
    (error) =>
      error === primaryFailure
      && causeReads === 0
      && Object.getOwnPropertyDescriptor(error, "cause").get !== undefined
      && error.secondaryFailure.source === "writer_lease_release"
      && error.secondaryFailure.code === "lease_release_failed"
      && error.secondaryFailure.restartAt === "inspect_writer_lease",
  );
  assert.equal(causeReads, 0);
});

test("typed operational outcomes retain primary authority when lease release also rejects", async () => {
  const cases = [
    {
      expectedStatus: "conflict",
      expectedCode: "remote_revision_changed",
      execution: {
        faultFor: ({ batchIndex, attempt }) =>
          batchIndex === 0 && attempt === 0
            ? { kind: "concurrent_drift", targetId: "var_0001", changes: { value: "#486ff7" } }
            : null,
      },
    },
    {
      expectedStatus: "friction",
      expectedCode: "retry_budget_exhausted",
      execution: {
        maxRetries: 0,
        faultFor: ({ batchIndex, attempt }) =>
          batchIndex === 0 && attempt === 0
            ? { kind: "retry_after", retryAfterMs: 1 }
            : null,
      },
    },
    {
      expectedStatus: "interrupted",
      expectedCode: "execution_interrupted",
      execution: {
        faultFor: ({ batchIndex, attempt }) =>
          batchIndex === 0 && attempt === 0 ? { kind: "interrupt_after_apply" } : null,
      },
    },
  ];

  for (const scenario of cases) {
    const base = harness();
    const leaseStore = asyncMethodAdapter(base.leaseStore, ["acquire", "renew"]);
    leaseStore.release = async () => {
      throw new Error("synthetic lease release fault");
    };

    const result = await runWith({ ...base, leaseStore }, scenario.execution);

    assert.equal(result.status, scenario.expectedStatus);
    assert.equal(result.code, scenario.expectedCode);
    assert.deepEqual(result.secondaryFailure, {
      source: "writer_lease_release",
      code: "lease_release_failed",
      owner: fixture.owner,
      generation: 1,
      restartAt: "inspect_writer_lease",
    });
  }
});

test("Retry-After is bounded, observed, and followed by the accepted path", async () => {
  const h = harness();
  const receipt = await runWith(h, {
    faultFor: ({ batchIndex, attempt }) =>
      batchIndex === 0 && attempt === 0 ? { kind: "retry_after", retryAfterMs: 125 } : null,
  });
  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.elapsedMs, 125);
  assert.equal(receipt.observations[0].classification, "bounded_retry");
});

test("Retry-After admits a safe non-negative integer before checkpointing or sleeping", async () => {
  const h = harness();
  let sleepCalls = 0;
  const result = await runWith(
    {
      ...h,
      sleep: async () => {
        sleepCalls += 1;
      },
    },
    {
      faultFor: ({ batchIndex, attempt }) =>
        batchIndex === 0 && attempt === 0
          ? { kind: "retry_after", retryAfterMs: -1 }
          : null,
    },
  );

  assert.equal(result.status, "friction");
  assert.equal(result.code, "remote_protocol_invalid");
  assert.equal(result.details.source, "retry_after");
  assert.equal(result.details.reason, "retry_after_ms");
  assert.equal(result.restartAt, "reconcile:batch:0");
  assert.equal(sleepCalls, 0);
  const checkpoint = h.checkpointStore.load(fixture.runId);
  assert.equal(checkpoint.nextBatchIndex, 0);
  assert.deepEqual(checkpoint.observations, []);
});

test("a lost success response is read and reconciled before progress continues", async () => {
  const h = harness();
  const receipt = await runWith(h, {
    faultFor: ({ batchIndex, attempt }) =>
      batchIndex === 0 && attempt === 0 ? { kind: "response_lost" } : null,
  });
  assert.equal(receipt.status, "accepted");
  assert.ok(receipt.observations.some((item) => item.classification === "already_applied"));
  assert.ok(
    receipt.observations.some(
      (item) => item.classification === "reconciled_after_unknown_outcome",
    ),
  );
});

test("an unobserved pre-apply timeout is read as absent and retried", async () => {
  const h = harness();
  const receipt = await runWith(h, {
    faultFor: ({ batchIndex, attempt }) =>
      batchIndex === 0 && attempt === 0 ? { kind: "timeout_before_apply" } : null,
  });
  assert.equal(receipt.status, "accepted");
  assert.ok(receipt.observations.some((item) => item.classification === "safe_to_retry"));
});

test("a partial apply settlement preserves the durable checkpoint as typed protocol friction", async () => {
  const base = harness();
  const remoteBefore = base.remote.snapshot();
  const underlyingRemote = base.remote;
  const partialRemote = {
    snapshot: underlyingRemote.snapshot.bind(underlyingRemote),
    readIntentResults: underlyingRemote.readIntentResults.bind(underlyingRemote),
    applyBatch(operations, options) {
      return underlyingRemote.applyBatch([operations[0]], options);
    },
  };

  const result = await runWith({ ...base, remote: partialRemote });

  assert.equal(result.status, "friction");
  assert.equal(result.code, "remote_protocol_invalid");
  assert.equal(result.details.source, "apply_batch");
  assert.equal(result.details.reason, "result_count");
  assert.equal(result.details.expectedCount, 2);
  assert.equal(result.details.observedCount, 1);
  assert.equal(result.restartAt, "reconcile:batch:0");
  const checkpoint = base.checkpointStore.load(fixture.runId);
  assert.equal(checkpoint.nextBatchIndex, 0);
  assert.equal(checkpoint.expectedRemoteRevision, remoteBefore.revision);
  assert.equal(checkpoint.expectedRemoteStateDigest, digest(remoteBefore));
});

test("a duplicate operation result cannot satisfy an exact apply settlement", async () => {
  const base = harness();
  const underlyingRemote = base.remote;
  const duplicateResultRemote = {
    snapshot: underlyingRemote.snapshot.bind(underlyingRemote),
    readIntentResults: underlyingRemote.readIntentResults.bind(underlyingRemote),
    applyBatch(operations, options) {
      const settlement = underlyingRemote.applyBatch(operations, options);
      return {
        ...settlement,
        results: [settlement.results[0], settlement.results[0]],
      };
    },
  };

  const result = await runWith({ ...base, remote: duplicateResultRemote });

  assert.equal(result.status, "friction");
  assert.equal(result.code, "remote_protocol_invalid");
  assert.equal(result.details.source, "apply_batch");
  assert.equal(result.details.reason, "duplicate_operation_id");
  assert.equal(base.checkpointStore.load(fixture.runId).nextBatchIndex, 0);
});

test("an incomplete intent observation preserves the checkpoint before classification", async () => {
  const base = harness();
  const remoteBefore = base.remote.snapshot();
  const underlyingRemote = base.remote;
  const incompleteObservationRemote = {
    snapshot: underlyingRemote.snapshot.bind(underlyingRemote),
    applyBatch: underlyingRemote.applyBatch.bind(underlyingRemote),
    readIntentResults() {
      return { remoteRevision: underlyingRemote.snapshot().revision, results: [] };
    },
  };

  const result = await runWith(
    { ...base, remote: incompleteObservationRemote },
    {
      faultFor: ({ batchIndex, attempt }) =>
        batchIndex === 0 && attempt === 0 ? { kind: "timeout_before_apply" } : null,
    },
  );

  assert.equal(result.status, "friction");
  assert.equal(result.code, "remote_protocol_invalid");
  assert.equal(result.details.source, "intent_observation");
  assert.equal(result.details.reason, "result_count");
  assert.equal(result.restartAt, "reconcile:batch:0");
  assert.deepEqual(base.remote.snapshot(), remoteBefore);
  const checkpoint = base.checkpointStore.load(fixture.runId);
  assert.equal(checkpoint.nextBatchIndex, 0);
  assert.equal(checkpoint.expectedRemoteStateDigest, digest(remoteBefore));
});

test("an intent observation cannot alias two created temporary identities", async () => {
  const operations = [
    {
      id: "create-one",
      type: "create_variable",
      tempId: "tmp:one",
      dependsOn: [],
      payload: { name: "one", resolvedType: "STRING", value: "one" },
    },
    {
      id: "create-two",
      type: "create_variable",
      tempId: "tmp:two",
      dependsOn: [],
      payload: { name: "two", resolvedType: "STRING", value: "two" },
    },
  ];
  const base = harness({ remote: new FakeVariableRemote() });
  const underlyingRemote = base.remote;
  const aliasingObservationRemote = {
    snapshot: underlyingRemote.snapshot.bind(underlyingRemote),
    applyBatch: underlyingRemote.applyBatch.bind(underlyingRemote),
    readIntentResults(operationIds) {
      const observation = underlyingRemote.readIntentResults(operationIds);
      const firstTargetId = observation.results[0].result.targetId;
      observation.results[1].result.targetId = firstTargetId;
      return observation;
    },
  };

  const result = await runWith(
    { ...base, remote: aliasingObservationRemote },
    {
      runId: "duplicate-created-observation",
      operations,
      maxBatchBytes: 4096,
      faultFor: ({ batchIndex, attempt }) =>
        batchIndex === 0 && attempt === 0 ? { kind: "response_lost" } : null,
    },
  );

  assert.equal(result.status, "friction");
  assert.equal(result.code, "remote_protocol_invalid");
  assert.equal(result.details.source, "intent_observation");
  assert.equal(result.details.reason, "duplicate_created_target_id");
  const checkpoint = base.checkpointStore.load("duplicate-created-observation");
  assert.equal(checkpoint.nextBatchIndex, 0);
  assert.deepEqual(checkpoint.tempIdToRealId, {});
});

test("same-batch temporary targets reconcile under arbitrary transport order", async () => {
  const operations = [
    {
      id: "create-same-batch",
      type: "create_variable",
      tempId: "tmp:same-batch",
      dependsOn: [],
      payload: { name: "before", resolvedType: "STRING", value: "value" },
    },
    {
      id: "update-same-batch",
      type: "update_variable",
      targetId: "tmp:same-batch",
      expectedVersion: 1,
      dependsOn: ["create-same-batch"],
      payload: { name: "after" },
    },
  ];

  for (const faultKind of [null, "response_lost", "interrupt_after_apply"]) {
    const base = harness({ remote: new FakeVariableRemote() });
    const underlyingRemote = base.remote;
    const reorderedRemote = {
      snapshot: underlyingRemote.snapshot.bind(underlyingRemote),
      applyBatch(batch, options) {
        const settlement = underlyingRemote.applyBatch(batch, options);
        settlement.results.reverse();
        return settlement;
      },
      readIntentResults(operationIds) {
        const observation = underlyingRemote.readIntentResults(operationIds);
        observation.results.reverse();
        return observation;
      },
    };
    const runId = `same-batch-${faultKind ?? "direct"}`;
    const first = await runWith(
      { ...base, remote: reorderedRemote },
      {
        runId,
        operations,
        maxBatchBytes: 4096,
        faultFor: ({ batchIndex, attempt }) =>
          batchIndex === 0 && attempt === 0 && faultKind ? { kind: faultKind } : null,
      },
    );
    const receipt = faultKind === "interrupt_after_apply"
      ? await runWith(
          { ...base, remote: reorderedRemote },
          { runId, operations, maxBatchBytes: 4096 },
        )
      : first;

    if (faultKind === "interrupt_after_apply") assert.equal(first.status, "interrupted");
    assert.equal(receipt.status, "accepted");
    assert.equal(receipt.tempIdToRealId["tmp:same-batch"], "var_0001");
    assert.equal(underlyingRemote.snapshot().variables[0].name, "after");
    assert.equal(underlyingRemote.snapshot().variables[0].version, 2);
  }
});

test("the durable identity ledger rejects reused and preexisting create targets", async () => {
  const create = (suffix) => ({
    id: `create-${suffix}`,
    type: "create_variable",
    tempId: `tmp:${suffix}`,
    dependsOn: [],
    payload: { name: suffix, resolvedType: "STRING", value: suffix },
  });
  const operations = [create("one"), create("two")];
  const maxBatchBytes = encodedBatchBytes([operations[0]]);

  const base = harness({ remote: new FakeVariableRemote() });
  const underlyingRemote = base.remote;
  let firstTargetId;
  let applyCount = 0;
  const reusedIdRemote = {
    snapshot: underlyingRemote.snapshot.bind(underlyingRemote),
    readIntentResults: underlyingRemote.readIntentResults.bind(underlyingRemote),
    applyBatch(batch, options) {
      const settlement = underlyingRemote.applyBatch(batch, options);
      applyCount += 1;
      if (applyCount === 1) firstTargetId = settlement.results[0].targetId;
      if (applyCount === 2) settlement.results[0].targetId = firstTargetId;
      return settlement;
    },
  };
  const reused = await runWith(
    { ...base, remote: reusedIdRemote },
    { runId: "reused-create-id", operations, maxBatchBytes },
  );
  assert.equal(reused.status, "friction");
  assert.equal(reused.code, "remote_protocol_invalid");
  assert.equal(reused.details.source, "created_identity_transfer");
  assert.equal(reused.details.reason, "created_target_identity_reused");
  const checkpoint = base.checkpointStore.load("reused-create-id");
  assert.equal(checkpoint.nextBatchIndex, 1);
  assert.deepEqual(checkpoint.knownRemoteVariableIds, ["var_0001"]);

  const existingBase = harness();
  const existingUnderlying = existingBase.remote;
  const preexistingIdRemote = {
    snapshot: existingUnderlying.snapshot.bind(existingUnderlying),
    readIntentResults: existingUnderlying.readIntentResults.bind(existingUnderlying),
    applyBatch(batch, options) {
      const settlement = existingUnderlying.applyBatch(batch, options);
      settlement.results[0].targetId = fixture.remote.variables[0].id;
      return settlement;
    },
  };
  const preexisting = await runWith(
    { ...existingBase, remote: preexistingIdRemote },
    { runId: "preexisting-create-id", operations: [create("new")], maxBatchBytes: 4096 },
  );
  assert.equal(preexisting.status, "friction");
  assert.equal(preexisting.details.reason, "created_target_identity_reused");
});

test("created identity transfer verifies settled state and retains deleted identities", async () => {
  const create = {
    id: "create-then-delete",
    type: "create_variable",
    tempId: "tmp:create-then-delete",
    dependsOn: [],
    payload: { name: "temporary", resolvedType: "STRING", value: "temporary" },
  };
  const remove = {
    id: "delete-created",
    type: "delete_variable",
    targetId: create.tempId,
    expectedVersion: 1,
    dependsOn: [create.id],
    payload: {},
  };
  const base = harness({ remote: new FakeVariableRemote() });
  const accepted = await runWith(base, {
    runId: "create-delete-ledger",
    operations: [create, remove],
    maxBatchBytes: 4096,
  });
  assert.equal(accepted.status, "accepted");
  assert.equal(base.remote.snapshot().variables.length, 0);
  const checkpoint = base.checkpointStore.load("create-delete-ledger");
  assert.deepEqual(checkpoint.knownRemoteVariableIds, ["var_0001"]);
  assert.equal(checkpoint.tempIdToRealId[create.tempId], "var_0001");
  const resumed = await runWith(base, {
    runId: "create-delete-ledger",
    operations: [create, remove],
    maxBatchBytes: 4096,
  });
  assert.equal(resumed.status, "accepted");

  const mismatchBase = harness({ remote: new FakeVariableRemote() });
  const mismatchUnderlying = mismatchBase.remote;
  let applied = false;
  const mismatchedSnapshotRemote = {
    readIntentResults: mismatchUnderlying.readIntentResults.bind(mismatchUnderlying),
    applyBatch(batch, options) {
      const settlement = mismatchUnderlying.applyBatch(batch, options);
      applied = true;
      return settlement;
    },
    snapshot() {
      const snapshot = mismatchUnderlying.snapshot();
      if (applied) snapshot.variables[0].name = "unexpected";
      return snapshot;
    },
  };
  const mismatch = await runWith(
    { ...mismatchBase, remote: mismatchedSnapshotRemote },
    { runId: "created-state-mismatch", operations: [create], maxBatchBytes: 4096 },
  );
  assert.equal(mismatch.status, "friction");
  assert.equal(mismatch.details.reason, "created_target_state_mismatch");
});

test("settled state must equal the complete projected batch transition", async () => {
  const base = harness();
  const underlyingRemote = base.remote;
  let applied = false;
  const sideEffectSnapshotRemote = {
    readIntentResults: underlyingRemote.readIntentResults.bind(underlyingRemote),
    applyBatch(batch, options) {
      const settlement = underlyingRemote.applyBatch(batch, options);
      applied = true;
      return settlement;
    },
    snapshot() {
      const snapshot = underlyingRemote.snapshot();
      if (applied) {
        snapshot.variables.find(({ id }) => id === "var_0002").value = "unexpected-side-effect";
      }
      return snapshot;
    },
  };

  const result = await runWith(
    { ...base, remote: sideEffectSnapshotRemote },
    { operations: [structuredClone(fixture.operations[1])], maxBatchBytes: 4096 },
  );

  assert.equal(result.status, "friction");
  assert.equal(result.code, "remote_protocol_invalid");
  assert.equal(result.details.source, "settled_state_transition");
  assert.equal(result.details.reason, "batch_transition_state_mismatch");
  assert.equal(base.checkpointStore.load(fixture.runId).nextBatchIndex, 0);
});

test("resume after post-apply interruption replays the intent set idempotently", async () => {
  const h = harness();
  const interrupted = await runWith(h, {
    faultFor: ({ batchIndex, attempt }) =>
      batchIndex === 0 && attempt === 0 ? { kind: "interrupt_after_apply" } : null,
  });
  assert.equal(interrupted.status, "interrupted");
  assert.equal(interrupted.restartAt, "batch:0");

  const resumed = await runWith(h);
  assert.equal(resumed.status, "accepted");
  assert.ok(resumed.observations.some((item) => item.classification === "idempotent_replay"));
});

test("resume verifies the complete projected transition before accepting recorded intents", async () => {
  const base = harness();
  const underlyingRemote = base.remote;
  let applyCalls = 0;
  let exposeUnrelatedSideEffect = false;
  const remote = {
    applyBatch(operations, options) {
      applyCalls += 1;
      return underlyingRemote.applyBatch(operations, options);
    },
    readIntentResults: underlyingRemote.readIntentResults.bind(underlyingRemote),
    snapshot() {
      const snapshot = underlyingRemote.snapshot();
      if (exposeUnrelatedSideEffect) {
        snapshot.variables.find(({ id }) => id === "var_0002").name = "unreported.side.effect";
      }
      return snapshot;
    },
  };

  const interrupted = await runWith({ ...base, remote }, {
    faultFor: ({ batchIndex, attempt }) =>
      batchIndex === 0 && attempt === 0 ? { kind: "interrupt_after_apply" } : null,
  });
  assert.equal(interrupted.status, "interrupted");
  const durableBeforeResume = base.checkpointStore.load(fixture.runId);
  assert.equal(durableBeforeResume.pendingTransition.batchIndex, 0);
  exposeUnrelatedSideEffect = true;
  const applyCallsBeforeResume = applyCalls;

  const resumed = await runWith({ ...base, remote });

  assert.equal(resumed.status, "friction");
  assert.equal(resumed.code, "remote_protocol_invalid");
  assert.equal(resumed.details.source, "resume_state_transition");
  assert.equal(resumed.details.reason, "batch_transition_state_mismatch");
  assert.equal(applyCalls, applyCallsBeforeResume);
  assert.deepEqual(base.checkpointStore.load(fixture.runId), durableBeforeResume);
});

test("same-revision state drift stops resume before another remote mutation", async () => {
  const base = harness();
  const underlyingRemote = base.remote;
  let applyCalls = 0;
  let exposeDrift = false;
  const stateDriftRemote = {
    snapshot() {
      const snapshot = underlyingRemote.snapshot();
      if (exposeDrift) snapshot.variables[0].value = "#486ff7";
      return snapshot;
    },
    readIntentResults: underlyingRemote.readIntentResults.bind(underlyingRemote),
    applyBatch(operations, options) {
      applyCalls += 1;
      if (applyCalls === 2) {
        throw new ExecutionInterruptedError({ phase: "before_apply" });
      }
      return underlyingRemote.applyBatch(operations, options);
    },
  };

  const interrupted = await runWith({ ...base, remote: stateDriftRemote });
  assert.equal(interrupted.status, "interrupted");
  const checkpointBeforeResume = base.checkpointStore.load(fixture.runId);
  assert.equal(checkpointBeforeResume.nextBatchIndex, 1);
  exposeDrift = true;
  const applyCallsBeforeResume = applyCalls;

  const resumed = await runWith({ ...base, remote: stateDriftRemote });

  assert.equal(resumed.status, "conflict");
  assert.equal(resumed.code, "checkpoint_remote_drift");
  assert.equal(resumed.batchIndex, 1);
  assert.equal(resumed.details.expectedRevision, resumed.details.observedRevision);
  assert.notEqual(resumed.details.expectedStateDigest, resumed.details.observedStateDigest);
  assert.equal(resumed.restartAt, "reconcile:resume");
  assert.equal(applyCalls, applyCallsBeforeResume);
  assert.deepEqual(base.checkpointStore.load(fixture.runId), checkpointBeforeResume);
});

test("resume rejects a checkpoint whose identity ledger omits a live remote variable", async () => {
  const base = harness();
  const accepted = await runWith(base);
  assert.equal(accepted.status, "accepted");
  const checkpoint = base.checkpointStore.load(fixture.runId);
  checkpoint.knownRemoteVariableIds = checkpoint.knownRemoteVariableIds.filter(
    (remoteId) => remoteId !== "var_0002",
  );
  base.checkpointStore.save(fixture.runId, checkpoint, {
    fencingToken: base.checkpointStore.inspectFence(fixture.runId),
  });
  let applyCalls = 0;
  const remote = {
    snapshot: base.remote.snapshot.bind(base.remote),
    readIntentResults: base.remote.readIntentResults.bind(base.remote),
    applyBatch(...args) {
      applyCalls += 1;
      return base.remote.applyBatch(...args);
    },
  };

  const resumed = await runWith({ ...base, remote });
  assert.equal(resumed.status, "friction");
  assert.equal(resumed.code, "checkpoint_invalid");
  assert.equal(resumed.details.reason, "remote_identity_ledger_missing");
  assert.equal(resumed.restartAt, "inspect_checkpoint");
  assert.equal(applyCalls, 0);
});

test("drift between interrupted application and resume returns a typed conflict", async () => {
  const h = harness();
  const interrupted = await runWith(h, {
    faultFor: ({ batchIndex, attempt }) =>
      batchIndex === 0 && attempt === 0 ? { kind: "interrupt_after_apply" } : null,
  });
  assert.equal(interrupted.status, "interrupted");
  h.remote.injectDrift("var_0001", { value: "#486ff7" });

  const resumed = await runWith(h);
  assert.equal(resumed.status, "conflict");
  assert.equal(resumed.code, "checkpoint_remote_drift");
  assert.equal(resumed.details.expectedRevision, 7);
  assert.equal(resumed.details.observedRevision, 9);
  assert.notEqual(resumed.details.expectedStateDigest, resumed.details.observedStateDigest);
  assert.equal(resumed.restartAt, "reconcile:resume");
});

test("drift after completion fails final revision and state reconciliation", async () => {
  const h = harness();
  const accepted = await runWith(h);
  assert.equal(accepted.status, "accepted");
  h.remote.injectDrift("var_0001", { value: "#486ff7" });

  const rerun = await runWith(h);
  assert.equal(rerun.status, "conflict");
  assert.equal(rerun.code, "final_remote_drift");
  assert.equal(rerun.details.expectedRevision, accepted.finalRemoteRevision);
  assert.equal(rerun.details.observedRevision, accepted.finalRemoteRevision + 1);
  assert.notEqual(rerun.details.expectedStateDigest, rerun.details.observedStateDigest);
  assert.equal(rerun.restartAt, "reconcile:final");
});

test("checkpoint admission rejects completed progress with a missing settlement transcript", async () => {
  const h = harness();
  const accepted = await runWith(h);
  assert.equal(accepted.status, "accepted");
  const checkpoint = h.checkpointStore.load(fixture.runId);
  checkpoint.observations = [];
  h.checkpointStore.save(fixture.runId, checkpoint, {
    fencingToken: h.checkpointStore.inspectFence(fixture.runId),
  });
  const remoteBefore = h.remote.snapshot();

  const result = await runWith(h);
  assert.equal(result.status, "friction");
  assert.equal(result.code, "checkpoint_invalid");
  assert.equal(result.details.reason, "settlement_missing");
  assert.equal(result.restartAt, "inspect_checkpoint");
  assert.deepEqual(h.remote.snapshot(), remoteBefore);
});

test("checkpoint admission rejects a retained observation that breaks the transcript digest", async () => {
  const h = harness();
  const accepted = await runWith(h);
  assert.equal(accepted.status, "accepted");
  const checkpoint = h.checkpointStore.load(fixture.runId);
  checkpoint.observations[0].attempt = 1;
  h.checkpointStore.save(fixture.runId, checkpoint, {
    fencingToken: h.checkpointStore.inspectFence(fixture.runId),
  });
  const remoteBefore = h.remote.snapshot();

  const result = await runWith(h);

  assert.equal(result.status, "friction");
  assert.equal(result.code, "checkpoint_invalid");
  assert.equal(result.details.reason, "observation_transcript_digest");
  assert.equal(result.restartAt, "inspect_checkpoint");
  assert.deepEqual(h.remote.snapshot(), remoteBefore);
});

test("a truncated transcript cannot advance past a batch without a verifiable settlement", async () => {
  const runId = "truncated-settlement-guard";
  const operations = [
    {
      id: "update-first-variable",
      type: "update_variable",
      targetId: "var_0001",
      expectedVersion: 1,
      dependsOn: [],
      payload: { name: "first-variable-updated" },
    },
    {
      id: "update-second-variable",
      type: "update_variable",
      targetId: "var_0002",
      expectedVersion: 2,
      dependsOn: [],
      payload: { name: "second-variable-updated" },
    },
  ];
  const maxBatchBytes = Math.max(...operations.map(operation => encodedBatchBytes([operation])));
  const plan = planOperations(operations, { maxBatchBytes });
  assert.equal(plan.batches.length, 2);
  const remote = new FakeVariableRemote(fixture.remote);
  const remoteBefore = remote.snapshot();
  const checkpointStore = new InMemoryCheckpointStore();
  const observations = Array.from(
    { length: MAX_CHECKPOINT_OBSERVATION_WINDOW },
    () => ({
      batchIndex: 1,
      attempt: 0,
      classification: "bounded_retry",
      retryAfterMs: 0,
    }),
  );
  const observationBaseDigest = digest({ owner: "forged_truncated_prefix" });
  const settlementBaseDigest = digest({ owner: "forged_settlement_prefix" });
  checkpointStore.claimFence(runId, 1);
  checkpointStore.save(runId, {
    schemaVersion: "0.1.0",
    runId,
    planDigest: plan.planDigest,
    nextBatchIndex: 1,
    expectedRemoteRevision: remoteBefore.revision,
    expectedRemoteStateDigest: digest(remoteBefore),
    initialRemoteRevision: remoteBefore.revision - 1,
    maxResolvedBatchBytes: 0,
    pendingTransition: null,
    tempIdToRealId: {},
    knownRemoteVariableIds: remoteBefore.variables.map(({ id }) => id),
    observationCount: MAX_CHECKPOINT_OBSERVATION_WINDOW + 1,
    observationBaseDigest,
    observationDigest: transcriptDigest(observationBaseDigest, observations, 1),
    settlementCount: 1,
    settlementBaseCount: 1,
    settlementBaseDigest,
    settlementDigest: settlementBaseDigest,
    observations,
  }, { fencingToken: 1 });

  const result = await synchronizeVariables({
    runId,
    owner: fixture.owner,
    operations,
    remote,
    leaseStore: new InMemoryLeaseStore(),
    checkpointStore,
    maxBatchBytes,
    clock: { now: () => fixture.clockStartMs },
  });

  assert.equal(result.status, "friction");
  assert.equal(result.code, "checkpoint_invalid");
  assert.equal(result.details.reason, "settlement_transcript_base");
  assert.equal(result.restartAt, "inspect_checkpoint");
  assert.deepEqual(remote.snapshot(), remoteBefore);
  assert.equal(
    remote.snapshot().variables.find(({ id }) => id === "var_0001").name,
    "color.accent.legacy",
  );
  assert.equal(
    remote.snapshot().variables.find(({ id }) => id === "var_0002").name,
    "component.action.background",
  );
});

test("checkpoint admission rejects progress coordinates outside the planned batches", async () => {
  const h = harness();
  const accepted = await runWith(h);
  assert.equal(accepted.status, "accepted");
  const checkpoint = h.checkpointStore.load(fixture.runId);
  checkpoint.nextBatchIndex += 1;
  h.checkpointStore.save(fixture.runId, checkpoint, {
    fencingToken: h.checkpointStore.inspectFence(fixture.runId),
  });
  const remoteBefore = h.remote.snapshot();

  const result = await runWith(h);
  assert.equal(result.status, "friction");
  assert.equal(result.code, "checkpoint_invalid");
  assert.equal(result.details.reason, "integer_field");
  assert.equal(result.details.field, "nextBatchIndex");
  assert.equal(result.restartAt, "inspect_checkpoint");
  assert.deepEqual(h.remote.snapshot(), remoteBefore);
});

test("checkpoint admission rejects executable shapes before remote observation", async () => {
  const plan = planOperations(fixture.operations, { maxBatchBytes: fixture.maxBatchBytes });
  const snapshot = new FakeVariableRemote(fixture.remote).snapshot();
  const settlementSeed = settlementTranscriptDigest(
    {
      runId: fixture.runId,
      planDigest: plan.planDigest,
      initialRemoteRevision: snapshot.revision,
    },
    plan,
    0,
  );
  const baseCheckpoint = {
    schemaVersion: "0.1.0",
    runId: fixture.runId,
    planDigest: plan.planDigest,
    nextBatchIndex: 0,
    expectedRemoteRevision: snapshot.revision,
    expectedRemoteStateDigest: digest(snapshot),
    initialRemoteRevision: snapshot.revision,
    maxResolvedBatchBytes: 0,
    pendingTransition: null,
    tempIdToRealId: {},
    knownRemoteVariableIds: snapshot.variables.map(({ id }) => id),
    observationCount: 0,
    observationBaseDigest: observationTranscriptSeed,
    observationDigest: observationTranscriptSeed,
    settlementCount: 0,
    settlementBaseCount: 0,
    settlementBaseDigest: settlementSeed,
    settlementDigest: settlementSeed,
    observations: [],
  };
  let getterReads = 0;
  const accessorCheckpoint = { ...baseCheckpoint };
  Object.defineProperty(accessorCheckpoint, "planDigest", {
    enumerable: true,
    get() {
      getterReads += 1;
      throw new Error("checkpoint getter executed");
    },
  });
  const symbolCheckpoint = { ...baseCheckpoint, [Symbol("outside-contract")]: true };
  const inheritedCheckpoint = Object.assign(
    Object.create({ inherited: true }),
    baseCheckpoint,
  );

  for (const checkpoint of [accessorCheckpoint, symbolCheckpoint, inheritedCheckpoint]) {
    let snapshotCalls = 0;
    const leaseStore = new InMemoryLeaseStore();
    const result = await runWith({
      checkpointStore: {
        claimFence: (_runId, fencingToken) => fencingToken,
        load: () => checkpoint,
        save: () => {
          throw new Error("save should remain unreachable");
        },
      },
      leaseStore,
      remote: {
        snapshot() {
          snapshotCalls += 1;
          return snapshot;
        },
      },
      clock: { now: () => fixture.clockStartMs },
      sleep: async () => {},
    });
    assert.equal(result.status, "friction");
    assert.equal(result.code, "checkpoint_invalid");
    assert.equal(snapshotCalls, 0);
    assert.equal(leaseStore.inspect(), null);
  }
  assert.equal(getterReads, 0);
});

test("checkpoint persistence admits and confirms the store-returned record", async () => {
  for (const saveResult of [undefined, null, { stale: true }]) {
    const base = harness();
    let applyCalls = 0;
    const remote = {
      snapshot: base.remote.snapshot.bind(base.remote),
      readIntentResults: base.remote.readIntentResults.bind(base.remote),
      applyBatch(...args) {
        applyCalls += 1;
        return base.remote.applyBatch(...args);
      },
    };
    const result = await runWith({
      ...base,
      remote,
      checkpointStore: {
        claimFence: (_runId, fencingToken) => fencingToken,
        load: () => null,
        save: () => saveResult,
      },
    });
    assert.equal(result.status, "friction");
    assert.equal(result.code, "checkpoint_persistence_invalid");
    assert.equal(result.restartAt, "persist:initial_checkpoint");
    assert.equal(applyCalls, 0);
    assert.equal(base.leaseStore.inspect(), null);
  }
});

test("remote diagnostics retain structural location without source vocabulary", async () => {
  const sensitiveKey = "private_partner_api_token_name";
  const remote = new FakeVariableRemote(fixture.remote);
  const malformedSnapshot = remote.snapshot();
  const malformedValue = {};
  Object.defineProperty(malformedValue, sensitiveKey, {
    enumerable: false,
    value: "value",
  });
  malformedSnapshot.variables[0].value = malformedValue;
  const result = await runWith({
    ...harness(),
    remote: {
      snapshot: () => malformedSnapshot,
      applyBatch: remote.applyBatch.bind(remote),
      readIntentResults: remote.readIntentResults.bind(remote),
    },
  });
  const serialized = JSON.stringify(result);
  assert.equal(result.status, "friction");
  assert.equal(result.code, "remote_protocol_invalid");
  assert.equal(result.details.path, "variables[0].value.property[0]");
  assert.equal(serialized.includes(sensitiveKey), false);
  assert.ok(Buffer.byteLength(serialized, "utf8") < 2_048);
});

test("a full observation envelope returns friction before another remote mutation", async () => {
  const h = harness();
  const plan = planOperations(fixture.operations, { maxBatchBytes: fixture.maxBatchBytes });
  const remoteBefore = h.remote.snapshot();
  const setupFencingToken = 1;
  const observations = Array.from({ length: MAX_CHECKPOINT_OBSERVATION_WINDOW }, () => ({
    batchIndex: 0,
    attempt: 0,
    classification: "bounded_retry",
    retryAfterMs: 0,
  }));
  const observationBaseDigest = digest({ owner: "admitted_truncated_observation_prefix" });
  const settlementSeed = settlementTranscriptDigest(
    {
      runId: fixture.runId,
      planDigest: plan.planDigest,
      initialRemoteRevision: remoteBefore.revision,
    },
    plan,
    0,
  );
  const firstObservationIndex = MAX_CHECKPOINT_OBSERVATIONS - observations.length;
  h.checkpointStore.claimFence(fixture.runId, setupFencingToken);
  h.checkpointStore.save(fixture.runId, {
    schemaVersion: "0.1.0",
    runId: fixture.runId,
    planDigest: plan.planDigest,
    nextBatchIndex: 0,
    expectedRemoteRevision: remoteBefore.revision,
    expectedRemoteStateDigest: digest(remoteBefore),
    initialRemoteRevision: remoteBefore.revision,
    maxResolvedBatchBytes: 0,
    pendingTransition: null,
    tempIdToRealId: {},
    knownRemoteVariableIds: remoteBefore.variables.map(({ id }) => id),
    observationCount: MAX_CHECKPOINT_OBSERVATIONS,
    observationBaseDigest,
    observationDigest: transcriptDigest(
      observationBaseDigest,
      observations,
      firstObservationIndex,
    ),
    settlementCount: 0,
    settlementBaseCount: 0,
    settlementBaseDigest: settlementSeed,
    settlementDigest: settlementSeed,
    observations,
  }, { fencingToken: setupFencingToken });

  const result = await runWith(h);
  assert.equal(result.status, "friction");
  assert.equal(result.code, "observation_limit_exceeded");
  assert.equal(result.details.limit, MAX_CHECKPOINT_OBSERVATIONS);
  assert.equal(result.restartAt, "batch:0");
  assert.deepEqual(h.remote.snapshot(), remoteBefore);
});

test("final reconciliation compares state even when the reported revision stays fixed", async () => {
  const h = harness();
  const accepted = await runWith(h);
  assert.equal(accepted.status, "accepted");
  const underlyingRemote = h.remote;
  const stateDriftRemote = {
    snapshot() {
      const snapshot = underlyingRemote.snapshot();
      snapshot.variables[0].value = "#486ff7";
      return snapshot;
    },
    applyBatch: underlyingRemote.applyBatch.bind(underlyingRemote),
    readIntentResults: underlyingRemote.readIntentResults.bind(underlyingRemote),
  };

  const rerun = await runWith({ ...h, remote: stateDriftRemote });
  assert.equal(rerun.status, "conflict");
  assert.equal(rerun.code, "final_remote_drift");
  assert.equal(rerun.details.expectedRevision, rerun.details.observedRevision);
  assert.notEqual(rerun.details.expectedStateDigest, rerun.details.observedStateDigest);
});

test("concurrent remote drift returns the observed and expected revisions", async () => {
  const h = harness();
  const result = await runWith(h, {
    faultFor: ({ batchIndex, attempt }) =>
      batchIndex === 0 && attempt === 0
        ? { kind: "concurrent_drift", targetId: "var_0001", changes: { value: "#486ff7" } }
        : null,
  });
  assert.equal(result.status, "conflict");
  assert.equal(result.code, "remote_revision_changed");
  assert.equal(result.details.expectedRevision, 7);
  assert.equal(result.details.observedRevision, 8);
});

test("an active lease returns a precise owner and expiry", () => {
  const leaseStore = new InMemoryLeaseStore();
  leaseStore.acquire({ owner: "writer-a", nowMs: 100, ttlMs: 50 });
  assert.throws(
    () => leaseStore.acquire({ owner: "writer-b", nowMs: 120, ttlMs: 50 }),
    (error) =>
      error.code === "lease_held" &&
      error.details.holder === "writer-a" &&
      error.details.expiresAtMs === 150,
  );
  const takeover = leaseStore.acquire({ owner: "writer-b", nowMs: 150, ttlMs: 50 });
  assert.equal(takeover.owner, "writer-b");
  assert.equal(takeover.generation, 2);
});

test("lease authority admission rejects executable and extended records without invoking getters", async () => {
  let getterReads = 0;
  const accessorAuthority = {
    generation: 1,
    expiresAtMs: fixture.clockStartMs + 30_000,
  };
  Object.defineProperty(accessorAuthority, "owner", {
    enumerable: true,
    get() {
      getterReads += 1;
      throw new Error("lease owner getter executed");
    },
  });
  const symbolAuthority = {
    owner: fixture.owner,
    generation: 1,
    expiresAtMs: fixture.clockStartMs + 30_000,
    [Symbol("outside-contract")]: true,
  };

  for (const authority of [accessorAuthority, symbolAuthority]) {
    const base = harness();
    const result = await runWith({
      ...base,
      leaseStore: {
        acquire: () => authority,
      },
    });
    assert.equal(result.status, "friction");
    assert.equal(result.code, "lease_authority_invalid");
    assert.equal(base.checkpointStore.load(fixture.runId), null);
  }
  assert.equal(getterReads, 0);
});

test("lease generations fence concurrent runs that reuse an owner label", () => {
  const leaseStore = new InMemoryLeaseStore();
  const first = leaseStore.acquire({ owner: "writer-a", nowMs: 100, ttlMs: 50 });
  assert.throws(
    () => leaseStore.acquire({ owner: "writer-a", nowMs: 120, ttlMs: 50 }),
    (error) => error.code === "lease_held",
  );
  assert.equal(leaseStore.release({ owner: "writer-a", generation: first.generation }), true);
  const second = leaseStore.acquire({ owner: "writer-a", nowMs: 130, ttlMs: 50 });
  assert.equal(second.generation, 2);
});

test("checkpoint fencing preserves successor authority when a writer expires after remote apply", async () => {
  const checkpointStore = new InMemoryCheckpointStore();
  const underlyingLeaseStore = new InMemoryLeaseStore();
  const remote = new FakeVariableRemote(fixture.remote);
  let nowMs = fixture.clockStartMs;
  let renewCalls = 0;
  const leaseStore = {
    acquire: underlyingLeaseStore.acquire.bind(underlyingLeaseStore),
    release(request) {
      const released = underlyingLeaseStore.release(request);
      if (!released) throw new Error("expired generation cannot release the successor lease");
      return released;
    },
    renew(request) {
      renewCalls += 1;
      if (renewCalls === 4) {
        nowMs = request.nowMs + request.ttlMs;
        const successor = underlyingLeaseStore.acquire({
          owner: "successor-writer",
          nowMs,
          ttlMs: request.ttlMs,
        });
        checkpointStore.claimFence(fixture.runId, successor.generation);
      }
      return underlyingLeaseStore.renew(request);
    },
  };

  const result = await runWith(
    {
      remote,
      checkpointStore,
      leaseStore,
      clock: { now: () => nowMs },
      sleep: async (durationMs) => {
        nowMs += durationMs;
      },
    },
    { operations: [structuredClone(fixture.operations[1])], maxBatchBytes: 4096 },
  );

  assert.equal(result.status, "friction");
  assert.equal(result.code, "lease_lost");
  assert.equal(result.batchIndex, 0);
  assert.equal(
    result.details.checkpointPersistence,
    "store_returned_record_requires_authority_reconciliation",
  );
  assert.equal(result.restartAt, "batch:0");
  assert.equal(remote.snapshot().revision, fixture.remote.revision);
  const retainedCheckpoint = checkpointStore.load(fixture.runId);
  assert.equal(retainedCheckpoint.nextBatchIndex, 0);
  assert.equal(retainedCheckpoint.pendingTransition.batchIndex, 0);
  assert.equal(checkpointStore.inspectFence(fixture.runId), 2);
  assert.throws(
    () => checkpointStore.save(
      fixture.runId,
      checkpointStore.load(fixture.runId),
      { fencingToken: 1 },
    ),
    error => error instanceof LeaseError && error.code === "checkpoint_fence_rejected",
  );
});

test("the example receipt matches its committed deterministic result", async () => {
  const h = harness();
  const actual = canonicalJson(await runWith(h));
  const expected = await readFile(new URL("../expected/accepted-receipt.json", import.meta.url), "utf8");
  assert.equal(actual, expected);
});

test("admitted-scale checkpointing retains a bounded observation window and full transcript digest", async () => {
  const operationCount = MAX_CHECKPOINT_OBSERVATION_WINDOW + 12;
  const operations = Array.from({ length: operationCount }, (_, index) => ({
    id: `deprecate-${String(index).padStart(4, "0")}`,
    type: "deprecate_variable",
    targetId: "var_0001",
    dependsOn: [],
    payload: {},
  }));
  const maxBatchBytes = encodedBatchBytes([operations[0]]);
  const base = harness();
  const retainedObservationCounts = [];
  const checkpointStore = {
    claimFence: base.checkpointStore.claimFence.bind(base.checkpointStore),
    load: base.checkpointStore.load.bind(base.checkpointStore),
    save(runId, checkpoint, options) {
      retainedObservationCounts.push(checkpoint.observations.length);
      return base.checkpointStore.save(runId, checkpoint, options);
    },
  };

  const receipt = await runWith({ ...base, checkpointStore }, {
    runId: "bounded-transcript-scale",
    operations,
    maxBatchBytes,
  });

  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.batchCount, operationCount);
  assert.equal(receipt.observationTranscript.count, operationCount);
  assert.equal(
    receipt.observationTranscript.retainedCount,
    MAX_CHECKPOINT_OBSERVATION_WINDOW,
  );
  assert.equal(receipt.observationTranscript.truncated, true);
  assert.match(receipt.observationTranscript.digest, /^[a-f0-9]{64}$/u);
  assert.equal(receipt.settlementTranscript.count, operationCount);
  assert.equal(
    receipt.settlementTranscript.releasedCount,
    operationCount - MAX_CHECKPOINT_OBSERVATION_WINDOW,
  );
  assert.equal(receipt.observations.length, MAX_CHECKPOINT_OBSERVATION_WINDOW);
  assert.equal(
    receipt.observations[0].batchIndex,
    operationCount - MAX_CHECKPOINT_OBSERVATION_WINDOW,
  );
  assert.ok(retainedObservationCounts.every(
    (count) => count <= MAX_CHECKPOINT_OBSERVATION_WINDOW,
  ));
  const checkpoint = base.checkpointStore.load("bounded-transcript-scale");
  assert.equal(checkpoint.observationCount, operationCount);
  assert.equal(checkpoint.observationDigest, receipt.observationTranscript.digest);
  const plan = planOperations(operations, { maxBatchBytes });
  const expectedSettlementDigest = settlementTranscriptDigest(
    {
      runId: "bounded-transcript-scale",
      planDigest: plan.planDigest,
      initialRemoteRevision: fixture.remote.revision,
    },
    plan,
    operationCount,
  );
  const expectedSettlementBaseDigest = settlementTranscriptDigest(
    {
      runId: "bounded-transcript-scale",
      planDigest: plan.planDigest,
      initialRemoteRevision: fixture.remote.revision,
    },
    plan,
    operationCount - MAX_CHECKPOINT_OBSERVATION_WINDOW,
  );
  assert.equal(checkpoint.settlementCount, operationCount);
  assert.equal(
    checkpoint.settlementBaseCount,
    operationCount - MAX_CHECKPOINT_OBSERVATION_WINDOW,
  );
  assert.equal(checkpoint.settlementBaseDigest, expectedSettlementBaseDigest);
  assert.equal(checkpoint.settlementDigest, expectedSettlementDigest);
  assert.equal(receipt.settlementTranscript.digest, expectedSettlementDigest);
});

test("create-heavy checkpointing merges the historical identity ledger in ordinal order", async () => {
  const operationCount = MAX_CHECKPOINT_OBSERVATION_WINDOW + 16;
  const operations = Array.from({ length: operationCount }, (_, index) => ({
    id: `create-ledger-${String(index).padStart(4, "0")}`,
    type: "create_variable",
    tempId: `tmp:ledger:${index}`,
    dependsOn: [],
    payload: {
      name: `space.ledger.${index}`,
      resolvedType: "FLOAT",
      value: index,
    },
  }));
  const maxBatchBytes = Math.max(
    ...operations.map((operation) => encodedBatchBytes([operation])),
  );
  const plan = planOperations(operations, { maxBatchBytes });
  assert.equal(plan.batches.length, operationCount);

  const remote = new FakeVariableRemote({
    issuedIdPrefix: "aa_",
    revision: 3,
    variables: [{
      id: "zz_existing",
      name: "space.existing",
      resolvedType: "FLOAT",
      value: 0,
      referenceTo: null,
      deprecated: false,
      version: 1,
    }],
  });
  const durableStore = new InMemoryCheckpointStore();
  const persistedLedgers = [];
  const checkpointStore = {
    claimFence: durableStore.claimFence.bind(durableStore),
    load: durableStore.load.bind(durableStore),
    save(runId, checkpoint, options) {
      persistedLedgers.push([...checkpoint.knownRemoteVariableIds]);
      return durableStore.save(runId, checkpoint, options);
    },
  };
  const base = harness({ remote, checkpointStore });
  const runId = "create-heavy-ledger-scale";

  const receipt = await runWith(base, {
    runId,
    operations,
    maxBatchBytes,
  });

  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.batchCount, operationCount);
  assert.equal(receipt.settlementTranscript.count, operationCount);
  assert.equal(
    receipt.settlementTranscript.releasedCount,
    operationCount - MAX_CHECKPOINT_OBSERVATION_WINDOW,
  );
  assert.equal(Object.keys(receipt.tempIdToRealId).length, operationCount);
  const checkpoint = durableStore.load(runId);
  const expectedCreatedIds = Array.from(
    { length: operationCount },
    (_, index) => `aa_${String(index + 1).padStart(4, "0")}`,
  );
  assert.deepEqual(
    checkpoint.knownRemoteVariableIds,
    [...expectedCreatedIds, "zz_existing"],
  );
  assert.ok(persistedLedgers.every((ledger) => (
    ledger.length <= operationCount + 1
    && new Set(ledger).size === ledger.length
    && ledger.every((identity, index) => index === 0 || ledger[index - 1] < identity)
  )));
});

test("scale planning records linear graph counts", () => {
  const operations = Array.from({ length: 1_000 }, (_, index) => ({
    id: `create-${String(index).padStart(4, "0")}`,
    type: "create_variable",
    tempId: `tmp:${index}`,
    dependsOn: index === 0 ? [] : [`create-${String(index - 1).padStart(4, "0")}`],
    payload: { name: `space.scale.${index}`, resolvedType: "FLOAT", value: index },
  }));
  const plan = planOperations(operations, { maxBatchBytes: 8_192 });
  assert.equal(plan.operationCount, 1_000);
  assert.equal(plan.edgeCount, 999);
  assert.ok(plan.batches.length > 1);
});

test("high-fan-out planning indexes edges instead of repeatedly scanning every operation", () => {
  const operationCount = 2_000;
  const root = {
    id: "root",
    type: "create_variable",
    tempId: "tmp:root",
    dependsOn: [],
    payload: { name: "space.scale.root", resolvedType: "FLOAT", value: 0 },
  };
  const leaves = Array.from({ length: operationCount - 1 }, (_, index) => ({
    id: `leaf-${String(index).padStart(4, "0")}`,
    type: "create_variable",
    tempId: `tmp:leaf:${index}`,
    dependsOn: ["root"],
    payload: { name: `space.scale.leaf.${index}`, resolvedType: "FLOAT", value: index + 1 },
  }));
  // Placing the root last makes the repeated full-scan contrast explicit.
  const operations = [...leaves, root];
  const plan = planOperations(operations, { maxBatchBytes: 8_192 });
  let repeatedScanComparisons = 0;
  for (const operation of operations) {
    for (const dependency of operation.dependsOn) {
      for (const candidate of operations) {
        repeatedScanComparisons += 1;
        if (candidate.id === dependency) {
          break;
        }
      }
    }
  }
  const indexedGraphWork = operationCount + plan.edgeCount + plan.edgeCount;

  assert.equal(plan.operationCount, operationCount);
  assert.equal(plan.edgeCount, operationCount - 1);
  assert.equal(plan.batches[0].operations[0].id, "root");
  assert.ok(repeatedScanComparisons > indexedGraphWork * 500);
});

test("partial prior application returns a reconciliation owner", async () => {
  const h = harness();
  const plan = planOperations(fixture.operations, { maxBatchBytes: fixture.maxBatchBytes });
  h.remote.applyBatch([plan.batches[0].operations[0]], { expectedRevision: 7 });
  const result = await runWith(h);
  assert.equal(result.status, "conflict");
  assert.equal(result.code, "partial_prior_application");
  assert.equal(result.restartAt, "reconcile:batch:0");
});

test("a changed plan forms a successor run with its own checkpoint lineage", async () => {
  const h = harness();
  const interrupted = await runWith(h, {
    faultFor: ({ batchIndex, attempt }) =>
      batchIndex === 0 && attempt === 0 ? { kind: "interrupt_after_apply" } : null,
  });
  assert.equal(interrupted.status, "interrupted");

  const changedOperations = structuredClone(fixture.operations);
  changedOperations[0].payload.value = "#446ef7";
  const result = await runWith(h, { operations: changedOperations });
  assert.equal(result.status, "conflict");
  assert.equal(result.code, "plan_changed");
  assert.equal(result.restartAt, "form_successor_run");
});

test("retry budget exhaustion returns the exact batch checkpoint", async () => {
  const h = harness();
  const result = await runWith(h, {
    maxRetries: 1,
    faultFor: () => ({ kind: "retry_after", retryAfterMs: 25 }),
  });
  assert.equal(result.status, "friction");
  assert.equal(result.code, "retry_budget_exhausted");
  assert.equal(result.restartAt, "batch:0");
});

test("admission rejects reserved payload keys and over-limit operations", () => {
  const reserved = structuredClone(fixture.operations[0]);
  reserved.payload = JSON.parse('{"name":"x","resolvedType":"FLOAT","value":{"__proto__":1}}');
  assert.throws(
    () => planOperations([reserved]),
    (error) => error instanceof PlanError && error.code === "reserved_key",
  );

  const oversized = structuredClone(fixture.operations[0]);
  oversized.payload.value = "x".repeat(2_000);
  assert.throws(
    () => planOperations([oversized], { maxBatchBytes: 256 }),
    (error) => error instanceof PlanError && error.code === "operation_exceeds_batch_limit",
  );
});

test("batch byte boundaries accept equality and reject the first exceeding byte", () => {
  const operation = structuredClone(fixture.operations[0]);
  const exactBatchBytes = encodedBatchBytes([operation]);
  const accepted = planOperations([operation], { maxBatchBytes: exactBatchBytes });
  assert.equal(accepted.batches[0].encodedBytes, exactBatchBytes);
  assert.throws(
    () => planOperations([operation], { maxBatchBytes: exactBatchBytes - 1 }),
    (error) => error instanceof PlanError && error.code === "operation_exceeds_batch_limit",
  );
});

test("resolved batches recheck bytes after the service issues a longer identifier", async () => {
  const issuedIdPrefix = `service-issued:${"x".repeat(480)}:`;
  const h = harness({
    remote: new FakeVariableRemote({ ...fixture.remote, issuedIdPrefix }),
  });
  const result = await runWith(h);

  assert.equal(result.status, "friction");
  assert.equal(result.code, "resolved_batch_exceeds_limit");
  assert.equal(result.batchIndex, 1);
  assert.ok(result.details.plannedBatchBytes <= result.details.maxBatchBytes);
  assert.ok(result.details.resolvedBatchBytes > result.details.maxBatchBytes);
  assert.equal(result.restartAt, "replan:batch:1");
  assert.equal(h.remote.snapshot().revision, 8);
  assert.equal(h.checkpointStore.load(fixture.runId).nextBatchIndex, 1);
});

test("receipt inspection identifies credential-shaped fields", () => {
  assert.throws(
    () => assertSanitizedReceipt({ apiToken: "synthetic-value" }),
    /credential-shaped/u,
  );
});

test("coordinator returns the active lease owner as recoverable friction", async () => {
  const h = harness();
  h.leaseStore.acquire({ owner: "writer-b", nowMs: fixture.clockStartMs, ttlMs: 1_000 });
  const remoteBefore = h.remote.snapshot();
  const result = await runWith(h);
  assert.equal(result.status, "friction");
  assert.equal(result.code, "lease_held");
  assert.equal(result.details.holder, "writer-b");
  assert.equal(result.restartAt, "acquire_writer_lease");
  assert.equal(h.checkpointStore.load(fixture.runId), null);
  assert.deepEqual(h.remote.snapshot(), remoteBefore);
});

test("temporary identities and type changes use explicit successor operations", () => {
  const duplicate = [structuredClone(fixture.operations[0]), structuredClone(fixture.operations[0])];
  duplicate[1].id = "create-again";
  assert.throws(
    () => planOperations(duplicate),
    (error) => error instanceof PlanError && error.code === "duplicate_temp_id",
  );

  const typeChange = structuredClone(fixture.operations[1]);
  typeChange.payload.resolvedType = "FLOAT";
  assert.throws(
    () => planOperations([typeChange]),
    (error) => error instanceof PlanError && error.code === "payload_field_outside_contract",
  );
});

test("temporary identity maps preserve magic and inherited object names across batches", async () => {
  for (const tempId of ["__proto__", "constructor", "toString"]) {
    const operations = [
      {
        id: `create-source-${tempId}`,
        type: "create_variable",
        tempId,
        dependsOn: [],
        payload: { name: `source.${tempId}`, resolvedType: "COLOR", value: "#315cf5" },
      },
      {
        id: `create-receiver-${tempId}`,
        type: "create_variable",
        tempId: `receiver:${tempId}`,
        dependsOn: [`create-source-${tempId}`],
        payload: {
          name: `receiver.${tempId}`,
          resolvedType: "COLOR",
          value: "#315cf5",
          referenceTo: tempId,
        },
      },
    ];
    const remote = new FakeVariableRemote();
    const h = harness({ remote });
    const receipt = await runWith(h, {
      runId: `magic-map-${tempId.toLowerCase()}`,
      operations,
      maxBatchBytes: 256,
    });

    assert.equal(receipt.status, "accepted", tempId);
    assert.ok(Object.hasOwn(receipt.tempIdToRealId, tempId), tempId);
    const snapshot = remote.snapshot();
    const sourceId = receipt.tempIdToRealId[tempId];
    const receiverId = receipt.tempIdToRealId[`receiver:${tempId}`];
    assert.equal(snapshot.variables.find(({ id }) => id === receiverId).referenceTo, sourceId, tempId);
  }
});

test("delete waits for every receiving reference to move", () => {
  const remote = new FakeVariableRemote(fixture.remote);
  assert.throws(
    () =>
      remote.applyBatch(
        [
          {
            id: "delete-legacy",
            type: "delete_variable",
            targetId: "var_0001",
            expectedVersion: 1,
            dependsOn: [],
          },
        ],
        { expectedRevision: 7 },
      ),
    (error) => error.code === "target_still_referenced" && error.details.referencingIds[0] === "var_0002",
  );
});
