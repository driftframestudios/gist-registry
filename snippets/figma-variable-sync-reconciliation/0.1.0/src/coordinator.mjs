import { assertSanitizedReceipt, digest } from "./canonical.mjs";
import {
  ExecutionInterruptedError,
  LeaseError,
  OutcomeUnknownError,
  PlanError,
  RemoteConflictError,
  RetryAfterError,
} from "./errors.mjs";
import { encodedBatchBytes, planOperations } from "./planner.mjs";

const coordinatePattern = /^[a-z0-9][a-z0-9._-]*$/iu;
const digestPattern = /^[a-f0-9]{64}$/u;
export const MAX_CHECKPOINT_OBSERVATIONS = 50_000;
const checkpointKeys = new Set([
  "schemaVersion",
  "runId",
  "planDigest",
  "nextBatchIndex",
  "expectedRemoteRevision",
  "expectedRemoteStateDigest",
  "initialRemoteRevision",
  "maxResolvedBatchBytes",
  "tempIdToRealId",
  "observations",
]);
const settledClassifications = new Set([
  "applied",
  "idempotent_replay",
  "reconciled_after_unknown_outcome",
]);
const reconciliationClassifications = new Set([
  "already_applied",
  "safe_to_retry",
  "human_decision_required",
]);
const observationKeysByKind = Object.freeze({
  retry: new Set(["batchIndex", "attempt", "classification", "retryAfterMs"]),
  reconciliation: new Set([
    "batchIndex",
    "attempt",
    "classification",
    "observedRemoteRevision",
  ]),
  settled: new Set([
    "batchIndex",
    "attempt",
    "classification",
    "remoteRevision",
    "operationCount",
  ]),
});

function checkpointAdmissionError(reason, details = {}) {
  return new PlanError(
    "checkpoint_invalid",
    "Checkpoint admission requires a complete, internally consistent progress record.",
    { reason, ...details },
  );
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireExactKeys(record, admitted, owner) {
  const observed = Object.keys(record).sort();
  const expected = [...admitted].sort();
  if (
    observed.length !== expected.length ||
    observed.some((key, index) => key !== expected[index])
  ) {
    throw checkpointAdmissionError("field_set", { owner, expected, observed });
  }
}

function requireCheckpointInteger(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw checkpointAdmissionError("integer_field", { field, min, max });
  }
}

function observationKind(observation) {
  if (observation.classification === "bounded_retry") return "retry";
  if (reconciliationClassifications.has(observation.classification)) return "reconciliation";
  if (settledClassifications.has(observation.classification)) return "settled";
  throw checkpointAdmissionError("observation_classification", {
    classification: observation.classification,
  });
}

function validateCheckpoint(checkpoint, { runId, plan, maxBatchBytes }) {
  if (!isRecord(checkpoint)) {
    throw checkpointAdmissionError("record_shape");
  }
  requireExactKeys(checkpoint, checkpointKeys, "checkpoint");
  if (checkpoint.schemaVersion !== "0.1.0") {
    throw checkpointAdmissionError("schema_version", {
      observed: checkpoint.schemaVersion,
      expected: "0.1.0",
    });
  }
  if (checkpoint.runId !== runId) {
    throw checkpointAdmissionError("run_identity", { observed: checkpoint.runId, expected: runId });
  }
  if (!digestPattern.test(checkpoint.planDigest)) {
    throw checkpointAdmissionError("plan_digest_shape");
  }
  requireCheckpointInteger(checkpoint.nextBatchIndex, "nextBatchIndex", {
    max: plan.batches.length,
  });
  requireCheckpointInteger(checkpoint.initialRemoteRevision, "initialRemoteRevision");
  requireCheckpointInteger(checkpoint.expectedRemoteRevision, "expectedRemoteRevision");
  const expectedRevision = checkpoint.initialRemoteRevision + checkpoint.nextBatchIndex;
  if (checkpoint.expectedRemoteRevision !== expectedRevision) {
    throw checkpointAdmissionError("revision_progress", {
      expected: expectedRevision,
      observed: checkpoint.expectedRemoteRevision,
    });
  }
  if (!digestPattern.test(checkpoint.expectedRemoteStateDigest)) {
    throw checkpointAdmissionError("state_digest_shape");
  }
  requireCheckpointInteger(checkpoint.maxResolvedBatchBytes, "maxResolvedBatchBytes", {
    max: maxBatchBytes,
  });
  if (!isRecord(checkpoint.tempIdToRealId)) {
    throw checkpointAdmissionError("temporary_id_map_shape");
  }

  const completedTempIds = new Set(
    plan.batches
      .slice(0, checkpoint.nextBatchIndex)
      .flatMap((batch) => batch.operations)
      .filter((operation) => operation.type === "create_variable")
      .map((operation) => operation.tempId),
  );
  const knownTempIds = new Set(
    plan.batches
      .flatMap((batch) => batch.operations)
      .filter((operation) => operation.type === "create_variable")
      .map((operation) => operation.tempId),
  );
  for (const [tempId, remoteId] of Object.entries(checkpoint.tempIdToRealId)) {
    if (
      !knownTempIds.has(tempId) ||
      !completedTempIds.has(tempId) ||
      typeof remoteId !== "string" ||
      remoteId.length < 1 ||
      remoteId.length > 512
    ) {
      throw checkpointAdmissionError("temporary_id_progress", { tempId });
    }
  }
  for (const tempId of completedTempIds) {
    if (!Object.hasOwn(checkpoint.tempIdToRealId, tempId)) {
      throw checkpointAdmissionError("temporary_id_missing", { tempId });
    }
  }

  if (
    !Array.isArray(checkpoint.observations) ||
    checkpoint.observations.length > MAX_CHECKPOINT_OBSERVATIONS
  ) {
    throw checkpointAdmissionError("observation_envelope", {
      limit: MAX_CHECKPOINT_OBSERVATIONS,
    });
  }
  const settledByBatch = new Map();
  let previousBatchIndex = -1;
  for (const [index, observation] of checkpoint.observations.entries()) {
    if (!isRecord(observation)) {
      throw checkpointAdmissionError("observation_shape", { index });
    }
    const kind = observationKind(observation);
    requireExactKeys(observation, observationKeysByKind[kind], `observations[${index}]`);
    requireCheckpointInteger(observation.batchIndex, `observations[${index}].batchIndex`, {
      max: plan.batches.length - 1,
    });
    requireCheckpointInteger(observation.attempt, `observations[${index}].attempt`, { max: 100 });
    if (observation.batchIndex < previousBatchIndex || observation.batchIndex > checkpoint.nextBatchIndex) {
      throw checkpointAdmissionError("observation_order", { index });
    }
    previousBatchIndex = observation.batchIndex;
    if (kind === "retry") {
      requireCheckpointInteger(observation.retryAfterMs, `observations[${index}].retryAfterMs`, {
        max: 300_000,
      });
    } else if (kind === "reconciliation") {
      requireCheckpointInteger(
        observation.observedRemoteRevision,
        `observations[${index}].observedRemoteRevision`,
      );
    } else {
      if (settledByBatch.has(observation.batchIndex)) {
        throw checkpointAdmissionError("repeated_settlement", {
          batchIndex: observation.batchIndex,
        });
      }
      if (observation.batchIndex >= checkpoint.nextBatchIndex) {
        throw checkpointAdmissionError("settlement_ahead_of_checkpoint", {
          batchIndex: observation.batchIndex,
        });
      }
      const batch = plan.batches[observation.batchIndex];
      requireCheckpointInteger(observation.remoteRevision, `observations[${index}].remoteRevision`);
      requireCheckpointInteger(observation.operationCount, `observations[${index}].operationCount`, {
        min: 1,
        max: batch.operations.length,
      });
      const expectedBatchRevision = checkpoint.initialRemoteRevision + observation.batchIndex + 1;
      if (
        observation.remoteRevision !== expectedBatchRevision ||
        observation.operationCount !== batch.operations.length
      ) {
        throw checkpointAdmissionError("settlement_progress", {
          batchIndex: observation.batchIndex,
          expectedRemoteRevision: expectedBatchRevision,
          observedRemoteRevision: observation.remoteRevision,
          expectedOperationCount: batch.operations.length,
          observedOperationCount: observation.operationCount,
        });
      }
      settledByBatch.set(observation.batchIndex, observation);
    }
  }
  for (let batchIndex = 0; batchIndex < checkpoint.nextBatchIndex; batchIndex += 1) {
    if (!settledByBatch.has(batchIndex)) {
      throw checkpointAdmissionError("settlement_missing", { batchIndex });
    }
  }
  assertCredentialSafe(checkpoint, "checkpoint");
  return checkpoint;
}

function validateCoordinate(value, field) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 128 ||
    !coordinatePattern.test(value)
  ) {
    throw new PlanError(
      "invalid_run_coordinate",
      `${field} needs a bounded portable coordinate.`,
      { field },
    );
  }
}

function validateIntegerOption(value, field, { min, max }) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new PlanError(
      "invalid_execution_limit",
      `${field} needs a safe integer from ${min} through ${max}.`,
      { field, min, max },
    );
  }
}

function assertCredentialSafe(value, field) {
  try {
    assertSanitizedReceipt(value);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new PlanError(
        "credential_shaped_input",
        "The synchronization request contains credential-shaped material.",
        { field },
      );
    }
    throw error;
  }
}

function preflightSynchronization({
  runId,
  owner,
  operations,
  maxBatchBytes,
  maxRetries,
  maxRetryAfterMs,
  leaseTtlMs,
}) {
  validateCoordinate(runId, "runId");
  validateCoordinate(owner, "owner");
  assertCredentialSafe({ runId, owner }, "run_coordinate");
  validateIntegerOption(maxRetries, "maxRetries", { min: 0, max: 100 });
  validateIntegerOption(maxRetryAfterMs, "maxRetryAfterMs", { min: 0, max: 300_000 });
  validateIntegerOption(leaseTtlMs, "leaseTtlMs", { min: 1, max: 86_400_000 });
  const plan = planOperations(operations, { maxBatchBytes });
  // Structural admission bounds recursive inspection before the secret-shaped scan.
  assertCredentialSafe({ operations }, "operations");
  return plan;
}

function statusResult(status, fields) {
  const result = { status, ...fields };
  assertSanitizedReceipt(result);
  return result;
}

function hasObservationCapacity(checkpoint, required = 1) {
  return checkpoint.observations.length + required <= MAX_CHECKPOINT_OBSERVATIONS;
}

function observationLimitResult({ runId, batchIndex, restartAt }) {
  return statusResult("friction", {
    code: "observation_limit_exceeded",
    runId,
    batchIndex,
    details: { limit: MAX_CHECKPOINT_OBSERVATIONS },
    restartAt,
  });
}

function resolveReconciliation(observation) {
  const applied = observation.results.filter((item) => item.status === "applied");
  const absent = observation.results.filter((item) => item.status === "absent");
  if (applied.length === observation.results.length) {
    return { classification: "already_applied", results: applied.map((item) => item.result) };
  }
  if (absent.length === observation.results.length) {
    return { classification: "safe_to_retry", results: [] };
  }
  return {
    classification: "human_decision_required",
    results: applied.map((item) => item.result),
    absentOperationIds: absent.map((item) => item.operationId),
  };
}

function resolveBatchOperations(operations, tempIdToRealId) {
  return operations.map((operation) => {
    const resolved = structuredClone(operation);
    if (resolved.targetId && Object.hasOwn(tempIdToRealId, resolved.targetId)) {
      resolved.targetId = tempIdToRealId[resolved.targetId];
    }
    if (
      resolved.payload?.referenceTo
      && Object.hasOwn(tempIdToRealId, resolved.payload.referenceTo)
    ) {
      resolved.payload.referenceTo = tempIdToRealId[resolved.payload.referenceTo];
    }
    return resolved;
  });
}

function recordTemporaryIdentity(tempIdToRealId, tempId, targetId) {
  // defineProperty treats names such as "__proto__" as ordinary own data keys
  // and preserves an enumerable shape for JSON checkpoints and receipts.
  Object.defineProperty(tempIdToRealId, tempId, {
    configurable: true,
    enumerable: true,
    value: targetId,
    writable: true,
  });
}

export async function synchronizeVariables({
  runId,
  owner,
  operations,
  remote,
  leaseStore,
  checkpointStore,
  maxBatchBytes = 4096,
  maxRetries = 2,
  maxRetryAfterMs = 5_000,
  leaseTtlMs = 30_000,
  clock = { now: () => Date.now() },
  sleep = async () => {},
  faultFor = () => null,
}) {
  const plan = preflightSynchronization({
    runId,
    owner,
    operations,
    maxBatchBytes,
    maxRetries,
    maxRetryAfterMs,
    leaseTtlMs,
  });
  const startedAtMs = await clock.now();
  let lease;
  try {
    lease = await leaseStore.acquire({
      owner,
      nowMs: await clock.now(),
      ttlMs: leaseTtlMs,
    });
  } catch (error) {
    if (error instanceof LeaseError) {
      return statusResult("friction", {
        code: error.code,
        runId,
        details: error.details,
        restartAt: "acquire_writer_lease",
      });
    }
    throw error;
  }

  let executionError;
  let executionFailed = false;
  try {
    const existing = await checkpointStore.load(runId);
    if (existing) {
      if (!isRecord(existing) || !digestPattern.test(existing.planDigest ?? "")) {
        return statusResult("friction", {
          code: "checkpoint_invalid",
          runId,
          details: { reason: "plan_digest_shape" },
          restartAt: "inspect_checkpoint",
        });
      }
      if (existing.planDigest !== plan.planDigest) {
        return statusResult("conflict", {
          code: "plan_changed",
          runId,
          expectedPlanDigest: existing.planDigest,
          observedPlanDigest: plan.planDigest,
          restartAt: "form_successor_run",
        });
      }
      try {
        validateCheckpoint(existing, { runId, plan, maxBatchBytes });
      } catch (error) {
        if (error instanceof PlanError && error.code === "checkpoint_invalid") {
          return statusResult("friction", {
            code: error.code,
            runId,
            details: error.details,
            restartAt: "inspect_checkpoint",
          });
        }
        throw error;
      }
    }
    const observedStart = await remote.snapshot();
    let checkpoint =
      existing ??
      await checkpointStore.save(runId, {
        schemaVersion: "0.1.0",
        runId,
        planDigest: plan.planDigest,
        nextBatchIndex: 0,
        expectedRemoteRevision: observedStart.revision,
        expectedRemoteStateDigest: digest(observedStart),
        initialRemoteRevision: observedStart.revision,
        maxResolvedBatchBytes: 0,
        tempIdToRealId: {},
        observations: [],
      });
    const resumedFromBatch = checkpoint.nextBatchIndex;
    for (let batchIndex = checkpoint.nextBatchIndex; batchIndex < plan.batches.length; batchIndex += 1) {
      const batch = plan.batches[batchIndex];
      const resolvedOperations = resolveBatchOperations(
        batch.operations,
        checkpoint.tempIdToRealId,
      );
      const resolvedBatchBytes = encodedBatchBytes(resolvedOperations);
      if (resolvedBatchBytes > maxBatchBytes) {
        return statusResult("friction", {
          code: "resolved_batch_exceeds_limit",
          runId,
          batchIndex,
          details: {
            maxBatchBytes,
            plannedBatchBytes: batch.encodedBytes,
            resolvedBatchBytes,
          },
          restartAt: `replan:batch:${batchIndex}`,
        });
      }
      let attempt = 0;
      let settled = null;

      while (!settled) {
        if (!hasObservationCapacity(checkpoint)) {
          return observationLimitResult({
            runId,
            batchIndex,
            restartAt: `batch:${batchIndex}`,
          });
        }
        try {
          await leaseStore.renew({
            owner,
            generation: lease.generation,
            nowMs: await clock.now(),
            ttlMs: leaseTtlMs,
          });
        } catch (error) {
          if (error instanceof LeaseError) {
            return statusResult("friction", {
              code: error.code,
              runId,
              batchIndex,
              details: error.details,
              restartAt: "acquire_writer_lease",
            });
          }
          throw error;
        }
        const fault = await faultFor({ batchIndex, attempt, batch });
        try {
          settled = await remote.applyBatch(resolvedOperations, {
            expectedRevision: checkpoint.expectedRemoteRevision,
            fault,
          });
        } catch (error) {
          if (error instanceof RetryAfterError) {
            if (attempt >= maxRetries || error.retryAfterMs > maxRetryAfterMs) {
              return statusResult("friction", {
                code: "retry_budget_exhausted",
                runId,
                batchIndex,
                attempt,
                retryAfterMs: error.retryAfterMs,
                restartAt: `batch:${batchIndex}`,
              });
            }
            checkpoint.observations.push({
              batchIndex,
              attempt,
              classification: "bounded_retry",
              retryAfterMs: error.retryAfterMs,
            });
            await checkpointStore.save(runId, checkpoint);
            await sleep(error.retryAfterMs);
            attempt += 1;
            continue;
          }

          if (error instanceof OutcomeUnknownError) {
            const observation = await remote.readIntentResults(batch.operationIds);
            const reconciliation = resolveReconciliation(observation);
            const requiredObservations = reconciliation.classification === "already_applied" ? 2 : 1;
            if (!hasObservationCapacity(checkpoint, requiredObservations)) {
              return observationLimitResult({
                runId,
                batchIndex,
                restartAt: `reconcile:batch:${batchIndex}`,
              });
            }
            checkpoint.observations.push({
              batchIndex,
              attempt,
              classification: reconciliation.classification,
              observedRemoteRevision: observation.remoteRevision,
            });
            await checkpointStore.save(runId, checkpoint);
            if (reconciliation.classification === "already_applied") {
              settled = {
                disposition: "reconciled_after_unknown_outcome",
                remoteRevision: observation.remoteRevision,
                results: reconciliation.results,
              };
              continue;
            }
            if (
              reconciliation.classification === "safe_to_retry" &&
              observation.remoteRevision === checkpoint.expectedRemoteRevision &&
              attempt < maxRetries
            ) {
              attempt += 1;
              continue;
            }
            if (
              reconciliation.classification === "safe_to_retry" &&
              observation.remoteRevision !== checkpoint.expectedRemoteRevision
            ) {
              return statusResult("conflict", {
                code: "remote_revision_changed",
                runId,
                batchIndex,
                details: {
                  expectedRevision: checkpoint.expectedRemoteRevision,
                  observedRevision: observation.remoteRevision,
                },
                restartAt: `reconcile:batch:${batchIndex}`,
              });
            }
            return statusResult("friction", {
              code: reconciliation.classification,
              runId,
              batchIndex,
              observedRemoteRevision: observation.remoteRevision,
              absentOperationIds: reconciliation.absentOperationIds ?? batch.operationIds,
              restartAt: `reconcile:batch:${batchIndex}`,
            });
          }

          if (error instanceof ExecutionInterruptedError) {
            return statusResult("interrupted", {
              code: error.code,
              runId,
              batchIndex,
              durableCheckpoint: checkpoint,
              restartAt: `batch:${batchIndex}`,
            });
          }

          if (error instanceof RemoteConflictError) {
            return statusResult("conflict", {
              code: error.code,
              runId,
              batchIndex,
              details: error.details,
              restartAt: `reconcile:batch:${batchIndex}`,
            });
          }
          throw error;
        }
      }

      const expectedSettledRevision = checkpoint.expectedRemoteRevision + 1;
      if (settled.remoteRevision !== expectedSettledRevision) {
        return statusResult("conflict", {
          code: "remote_revision_changed_after_settlement",
          runId,
          batchIndex,
          details: {
            expectedRevision: expectedSettledRevision,
            observedRevision: settled.remoteRevision,
          },
          restartAt: `reconcile:batch:${batchIndex}`,
        });
      }

      const settledSnapshot = await remote.snapshot();
      if (settledSnapshot.revision !== settled.remoteRevision) {
        return statusResult("conflict", {
          code: "remote_drift_after_settlement",
          runId,
          batchIndex,
          details: {
            expectedRevision: settled.remoteRevision,
            observedRevision: settledSnapshot.revision,
          },
          restartAt: `reconcile:batch:${batchIndex}`,
        });
      }

      for (const result of settled.results) {
        if (result.tempId) {
          recordTemporaryIdentity(checkpoint.tempIdToRealId, result.tempId, result.targetId);
        }
      }
      checkpoint.nextBatchIndex = batchIndex + 1;
      checkpoint.expectedRemoteRevision = settled.remoteRevision;
      checkpoint.expectedRemoteStateDigest = digest(settledSnapshot);
      checkpoint.maxResolvedBatchBytes = Math.max(
        checkpoint.maxResolvedBatchBytes ?? 0,
        resolvedBatchBytes,
      );
      if (!hasObservationCapacity(checkpoint)) {
        return observationLimitResult({
          runId,
          batchIndex,
          restartAt: `reconcile:batch:${batchIndex}`,
        });
      }
      checkpoint.observations.push({
        batchIndex,
        attempt,
        classification: settled.disposition,
        remoteRevision: settled.remoteRevision,
        operationCount: settled.results.length,
      });
      checkpoint = await checkpointStore.save(runId, checkpoint);
    }

    const finalSnapshot = await remote.snapshot();
    const finalStateDigest = digest(finalSnapshot);
    if (
      finalSnapshot.revision !== checkpoint.expectedRemoteRevision ||
      finalStateDigest !== checkpoint.expectedRemoteStateDigest
    ) {
      return statusResult("conflict", {
        code: "final_remote_drift",
        runId,
        details: {
          expectedRevision: checkpoint.expectedRemoteRevision,
          observedRevision: finalSnapshot.revision,
          expectedStateDigest: checkpoint.expectedRemoteStateDigest,
          observedStateDigest: finalStateDigest,
        },
        restartAt: "reconcile:final",
      });
    }
    const receipt = {
      schemaVersion: "0.1.0",
      status: "accepted",
      runId,
      planDigest: plan.planDigest,
      operationCount: plan.operationCount,
      edgeCount: plan.edgeCount,
      batchCount: plan.batches.length,
      maxBatchBytes,
      maxResolvedBatchBytes: checkpoint.maxResolvedBatchBytes,
      resumedFromBatch,
      initialRemoteRevision: checkpoint.initialRemoteRevision,
      finalRemoteRevision: finalSnapshot.revision,
      finalVariableCount: finalSnapshot.variables.length,
      finalStateDigest,
      tempIdToRealId: checkpoint.tempIdToRealId,
      observations: checkpoint.observations,
      elapsedMs: (await clock.now()) - startedAtMs,
    };
    assertSanitizedReceipt(receipt);
    return receipt;
  } catch (error) {
    executionFailed = true;
    executionError = error;
    throw error;
  } finally {
    let releaseError;
    try {
      const released = await leaseStore.release({ owner, generation: lease.generation });
      if (released !== true) {
        releaseError = new LeaseError(
          "lease_release_unconfirmed",
          "The writer lease release needs inspection before another synchronization begins.",
          { owner, generation: lease.generation, restartAt: "inspect_writer_lease" },
        );
      }
    } catch (error) {
      releaseError = new LeaseError(
        "lease_release_failed",
        "The current synchronization path completed and the writer lease release needs inspection.",
        { owner, generation: lease.generation, restartAt: "inspect_writer_lease" },
      );
    }

    if (releaseError && !executionFailed) {
      throw releaseError;
    }
    if (releaseError && executionError?.cause === undefined) {
      try {
        Object.defineProperty(executionError, "cause", {
          configurable: true,
          value: releaseError,
        });
      } catch {
        // The primary failure remains authoritative when an immutable error
        // object cannot carry the secondary lease-release observation.
      }
    }
  }
}
