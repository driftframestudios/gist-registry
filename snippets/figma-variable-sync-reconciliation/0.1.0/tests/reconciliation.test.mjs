import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assertSanitizedReceipt, canonicalJson, digest } from "../src/canonical.mjs";
import { MAX_CHECKPOINT_OBSERVATIONS, synchronizeVariables } from "../src/coordinator.mjs";
import { FakeVariableRemote } from "../src/fake-remote.mjs";
import { LeaseError, PlanError } from "../src/errors.mjs";
import {
  encodedBatchBytes,
  orderOperations,
  PLANNER_RESOURCE_LIMITS,
  planOperations,
} from "../src/planner.mjs";
import { InMemoryCheckpointStore, InMemoryLeaseStore } from "../src/stores.mjs";

const fixture = JSON.parse(
  await readFile(new URL("../fixtures/accepted-sync.json", import.meta.url), "utf8"),
);
const cycleFixture = JSON.parse(
  await readFile(new URL("../fixtures/dependency-cycle.json", import.meta.url), "utf8"),
);

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

test("preflight rejects unsafe coordinates and operation envelopes before calling collaborators", async () => {
  const calls = [];
  const collaborators = {
    remote: {
      snapshot() {
        calls.push("remote.snapshot");
      },
    },
    checkpointStore: {
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
    checkpointStore: asyncMethodAdapter(base.checkpointStore, ["load", "save"], calls),
    leaseStore: asyncLeaseStore,
    clock: asyncMethodAdapter(base.clock, ["now"], calls),
    sleep: async (durationMs) => base.sleep(durationMs),
  }, {
    faultFor: async () => null,
  });

  assert.equal(result.status, "accepted");
  assert.equal(releaseSettled, true);
  assert.equal(calls.at(-1), "release");
  for (const methodName of ["acquire", "renew", "load", "save", "snapshot", "applyBatch", "now"]) {
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
    checkpointStore: asyncMethodAdapter(base.checkpointStore, ["load", "save"]),
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
  const checkpointStore = {
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
      && error.cause instanceof LeaseError
      && error.cause.code === "lease_release_failed",
  );
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
  assert.equal(resumed.code, "remote_revision_changed_after_settlement");
  assert.deepEqual(resumed.details, { expectedRevision: 8, observedRevision: 9 });
  assert.equal(resumed.restartAt, "reconcile:batch:0");
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
  h.checkpointStore.save(fixture.runId, checkpoint);
  const remoteBefore = h.remote.snapshot();

  const result = await runWith(h);
  assert.equal(result.status, "friction");
  assert.equal(result.code, "checkpoint_invalid");
  assert.equal(result.details.reason, "settlement_missing");
  assert.equal(result.restartAt, "inspect_checkpoint");
  assert.deepEqual(h.remote.snapshot(), remoteBefore);
});

test("checkpoint admission rejects progress coordinates outside the planned batches", async () => {
  const h = harness();
  const accepted = await runWith(h);
  assert.equal(accepted.status, "accepted");
  const checkpoint = h.checkpointStore.load(fixture.runId);
  checkpoint.nextBatchIndex += 1;
  h.checkpointStore.save(fixture.runId, checkpoint);
  const remoteBefore = h.remote.snapshot();

  const result = await runWith(h);
  assert.equal(result.status, "friction");
  assert.equal(result.code, "checkpoint_invalid");
  assert.equal(result.details.reason, "integer_field");
  assert.equal(result.details.field, "nextBatchIndex");
  assert.equal(result.restartAt, "inspect_checkpoint");
  assert.deepEqual(h.remote.snapshot(), remoteBefore);
});

test("a full observation envelope returns friction before another remote mutation", async () => {
  const h = harness();
  const plan = planOperations(fixture.operations, { maxBatchBytes: fixture.maxBatchBytes });
  const remoteBefore = h.remote.snapshot();
  h.checkpointStore.save(fixture.runId, {
    schemaVersion: "0.1.0",
    runId: fixture.runId,
    planDigest: plan.planDigest,
    nextBatchIndex: 0,
    expectedRemoteRevision: remoteBefore.revision,
    expectedRemoteStateDigest: digest(remoteBefore),
    initialRemoteRevision: remoteBefore.revision,
    maxResolvedBatchBytes: 0,
    tempIdToRealId: {},
    observations: Array.from({ length: MAX_CHECKPOINT_OBSERVATIONS }, () => ({
      batchIndex: 0,
      attempt: 0,
      classification: "bounded_retry",
      retryAfterMs: 0,
    })),
  });

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

test("the example receipt matches its committed deterministic result", async () => {
  const h = harness();
  const actual = canonicalJson(await runWith(h));
  const expected = await readFile(new URL("../expected/accepted-receipt.json", import.meta.url), "utf8");
  assert.equal(actual, expected);
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
