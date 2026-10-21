import { setTimeout as delay } from "node:timers/promises";
import { assertSanitizedReceipt, compareOrdinal, digest } from "./canonical.mjs";
import {
  ExecutionInterruptedError,
  LeaseError,
  OutcomeUnknownError,
  PlanError,
  RemoteConflictError,
  RetryAfterError,
} from "./errors.mjs";
import {
  encodedBatchBytes,
  planOperations,
  PLANNER_RESOURCE_LIMITS,
} from "./planner.mjs";
import {
  admitRemoteIntentObservation,
  admitRemoteSettlement,
  admitRemoteSnapshot,
  REMOTE_CONTRACT_LIMITS,
} from "./remote-contract.mjs";

const coordinatePattern = /^[a-z0-9][a-z0-9._-]*$/iu;
const digestPattern = /^[a-f0-9]{64}$/u;
export const MAX_CHECKPOINT_OBSERVATIONS = 50_000;
export const MAX_CHECKPOINT_OBSERVATION_WINDOW = 128;
export const MAX_CHECKPOINT_REMOTE_VARIABLE_IDS =
  REMOTE_CONTRACT_LIMITS.variables + PLANNER_RESOURCE_LIMITS.operations;
const observationTranscriptSeed = digest({
  schemaVersion: "0.1.0",
  owner: "checkpoint_observation_transcript",
});
const checkpointKeys = new Set([
  "schemaVersion",
  "runId",
  "planDigest",
  "nextBatchIndex",
  "expectedRemoteRevision",
  "expectedRemoteStateDigest",
  "initialRemoteRevision",
  "maxResolvedBatchBytes",
  "pendingTransition",
  "tempIdToRealId",
  "knownRemoteVariableIds",
  "observationCount",
  "observationBaseDigest",
  "observationDigest",
  "settlementCount",
  "settlementBaseCount",
  "settlementBaseDigest",
  "settlementDigest",
  "observations",
]);
const pendingTransitionKeys = new Set([
  "batchIndex",
  "priorRevision",
  "priorStateDigest",
  "projectedStateDigest",
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
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireDataProperties(record, owner) {
  if (!isRecord(record)) throw checkpointAdmissionError("record_shape", { owner });
  const descriptors = Object.getOwnPropertyDescriptors(record);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => {
    const descriptor = descriptors[key];
    return typeof key !== "string" || !descriptor.enumerable || !("value" in descriptor);
  })) {
    throw checkpointAdmissionError("data_property_shape", { owner });
  }
  return descriptors;
}

function requireExactKeys(record, admitted, owner) {
  const descriptors = requireDataProperties(record, owner);
  const observed = Reflect.ownKeys(descriptors).sort();
  const expected = [...admitted].sort();
  if (
    observed.length !== expected.length ||
    observed.some((key, index) => key !== expected[index])
  ) {
    throw checkpointAdmissionError("field_set", {
      owner,
      expectedFieldCount: expected.length,
      observedFieldCount: observed.length,
    });
  }
  return descriptors;
}

function requireDataArray(value, owner, maximum) {
  if (
    !Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximum
  ) {
    throw checkpointAdmissionError("array_shape", { owner, limit: maximum });
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors).filter(key => key !== "length");
  if (
    keys.length !== value.length
    || keys.some((key, index) => {
      const descriptor = descriptors[key];
      return typeof key !== "string"
        || key !== String(index)
        || !descriptor.enumerable
        || !("value" in descriptor);
    })
  ) {
    throw checkpointAdmissionError("array_shape", { owner, limit: maximum });
  }
  return keys.map(key => descriptors[key].value);
}

function requireCheckpointInteger(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw checkpointAdmissionError("integer_field", { field, min, max });
  }
}

function observationKind(classification) {
  if (classification === "bounded_retry") return "retry";
  if (reconciliationClassifications.has(classification)) return "reconciliation";
  if (settledClassifications.has(classification)) return "settled";
  throw checkpointAdmissionError("observation_classification");
}

function admitCheckpointShape(checkpoint) {
  const descriptors = requireExactKeys(checkpoint, checkpointKeys, "checkpoint");
  const temporaryDescriptors = requireDataProperties(
    descriptors.tempIdToRealId.value,
    "checkpoint.tempIdToRealId",
  );
  const tempIdToRealId = Object.create(null);
  for (const key of Reflect.ownKeys(temporaryDescriptors)) {
    Object.defineProperty(tempIdToRealId, key, {
      configurable: true,
      enumerable: true,
      value: temporaryDescriptors[key].value,
      writable: true,
    });
  }

  const observationValues = requireDataArray(
    descriptors.observations.value,
    "checkpoint.observations",
    MAX_CHECKPOINT_OBSERVATION_WINDOW,
  );
  const observations = observationValues.map((observation, index) => {
    const observationDescriptors = requireDataProperties(
      observation,
      `checkpoint.observations[${index}]`,
    );
    const classification = observationDescriptors.classification?.value;
    const kind = observationKind(classification);
    const exactDescriptors = requireExactKeys(
      observation,
      observationKeysByKind[kind],
      `checkpoint.observations[${index}]`,
    );
    return Object.fromEntries(
      Reflect.ownKeys(exactDescriptors).map(key => [key, exactDescriptors[key].value]),
    );
  });
  const knownRemoteVariableIds = requireDataArray(
    descriptors.knownRemoteVariableIds.value,
    "checkpoint.knownRemoteVariableIds",
    MAX_CHECKPOINT_REMOTE_VARIABLE_IDS,
  );
  let pendingTransition = null;
  if (descriptors.pendingTransition.value !== null) {
    const pendingDescriptors = requireExactKeys(
      descriptors.pendingTransition.value,
      pendingTransitionKeys,
      "checkpoint.pendingTransition",
    );
    pendingTransition = Object.fromEntries(
      Reflect.ownKeys(pendingDescriptors).map(key => [key, pendingDescriptors[key].value]),
    );
  }

  return {
    schemaVersion: descriptors.schemaVersion.value,
    runId: descriptors.runId.value,
    planDigest: descriptors.planDigest.value,
    nextBatchIndex: descriptors.nextBatchIndex.value,
    expectedRemoteRevision: descriptors.expectedRemoteRevision.value,
    expectedRemoteStateDigest: descriptors.expectedRemoteStateDigest.value,
    initialRemoteRevision: descriptors.initialRemoteRevision.value,
    maxResolvedBatchBytes: descriptors.maxResolvedBatchBytes.value,
    pendingTransition,
    tempIdToRealId,
    knownRemoteVariableIds,
    observationCount: descriptors.observationCount.value,
    observationBaseDigest: descriptors.observationBaseDigest.value,
    observationDigest: descriptors.observationDigest.value,
    settlementCount: descriptors.settlementCount.value,
    settlementBaseCount: descriptors.settlementBaseCount.value,
    settlementBaseDigest: descriptors.settlementBaseDigest.value,
    settlementDigest: descriptors.settlementDigest.value,
    observations,
  };
}

function formCheckpointPlanIndex(plan) {
  const createBatchByTempId = new Map();
  const completedCreateCountByBatch = [0];
  const completedOperationCountByBatch = [0];
  const operationCountByBatch = [];
  let createCount = 0;
  let operationCount = 0;
  for (const batch of plan.batches) {
    operationCountByBatch.push(batch.operations.length);
    operationCount += batch.operations.length;
    for (const operation of batch.operations) {
      if (operation.type !== "create_variable") continue;
      createBatchByTempId.set(operation.tempId, batch.index);
      createCount += 1;
    }
    completedCreateCountByBatch.push(createCount);
    completedOperationCountByBatch.push(operationCount);
  }
  return Object.freeze({
    batchCount: plan.batches.length,
    completedCreateCountByBatch: Object.freeze(completedCreateCountByBatch),
    completedOperationCountByBatch: Object.freeze(completedOperationCountByBatch),
    createBatchByTempId,
    operationCountByBatch: Object.freeze(operationCountByBatch),
  });
}

function extendObservationTranscript(previousDigest, index, observation) {
  return digest({ previousDigest, index, observation });
}

function settlementTranscriptDigest(
  { runId, planDigest, initialRemoteRevision },
  planIndex,
  completedBatchCount,
) {
  return digest({
    schemaVersion: "0.1.0",
    owner: "checkpoint_settlement_coordinate",
    runId,
    planDigest,
    initialRemoteRevision,
    completedBatchCount,
    completedOperationCount: planIndex.completedOperationCountByBatch[completedBatchCount],
    expectedRemoteRevision: initialRemoteRevision + completedBatchCount,
  });
}

function appendCheckpointObservation(checkpoint, observation, planIndex) {
  const index = checkpoint.observationCount;
  if (checkpoint.observations.length === MAX_CHECKPOINT_OBSERVATION_WINDOW) {
    const firstRetainedIndex = index - checkpoint.observations.length;
    const [releasedObservation] = checkpoint.observations.splice(0, 1);
    checkpoint.observationBaseDigest = extendObservationTranscript(
      checkpoint.observationBaseDigest,
      firstRetainedIndex,
      releasedObservation,
    );
    if (observationKind(releasedObservation.classification) === "settled") {
      checkpoint.settlementBaseCount += 1;
      checkpoint.settlementBaseDigest = settlementTranscriptDigest(
        checkpoint,
        planIndex,
        checkpoint.settlementBaseCount,
      );
    }
  }
  checkpoint.observationDigest = extendObservationTranscript(
    checkpoint.observationDigest,
    index,
    observation,
  );
  checkpoint.observationCount += 1;
  checkpoint.observations.push(observation);
  if (observationKind(observation.classification) === "settled") {
    checkpoint.settlementCount += 1;
    checkpoint.settlementDigest = settlementTranscriptDigest(
      checkpoint,
      planIndex,
      checkpoint.settlementCount,
    );
  }
}

function validateCheckpoint(checkpoint, { runId, planIndex, maxBatchBytes }) {
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
    max: planIndex.batchCount,
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
  if (checkpoint.pendingTransition !== null) {
    requireCheckpointInteger(checkpoint.pendingTransition.batchIndex, "pendingTransition.batchIndex", {
      max: planIndex.batchCount - 1,
    });
    requireCheckpointInteger(checkpoint.pendingTransition.priorRevision, "pendingTransition.priorRevision");
    if (
      checkpoint.pendingTransition.batchIndex !== checkpoint.nextBatchIndex
      || checkpoint.pendingTransition.priorRevision !== checkpoint.expectedRemoteRevision
      || checkpoint.pendingTransition.priorStateDigest !== checkpoint.expectedRemoteStateDigest
      || !digestPattern.test(checkpoint.pendingTransition.projectedStateDigest)
    ) {
      throw checkpointAdmissionError("pending_transition_coordinate");
    }
  }
  const knownRemoteVariableIds = new Set();
  let previousRemoteVariableId = null;
  for (const [index, remoteId] of checkpoint.knownRemoteVariableIds.entries()) {
    if (
      typeof remoteId !== "string"
      || remoteId.length < 1
      || remoteId.length > 512
      || knownRemoteVariableIds.has(remoteId)
      || (previousRemoteVariableId !== null && previousRemoteVariableId > remoteId)
    ) {
      throw checkpointAdmissionError("remote_variable_identity", { index });
    }
    knownRemoteVariableIds.add(remoteId);
    previousRemoteVariableId = remoteId;
  }
  const mappedRemoteIds = new Set();
  const temporaryMappings = Object.entries(checkpoint.tempIdToRealId);
  for (const [tempId, remoteId] of temporaryMappings) {
    const createBatchIndex = planIndex.createBatchByTempId.get(tempId);
    if (
      createBatchIndex === undefined ||
      createBatchIndex >= checkpoint.nextBatchIndex ||
      typeof remoteId !== "string" ||
      remoteId.length < 1 ||
      remoteId.length > 512 ||
      !knownRemoteVariableIds.has(remoteId) ||
      mappedRemoteIds.has(remoteId)
    ) {
      throw checkpointAdmissionError("temporary_id_progress", { tempId });
    }
    mappedRemoteIds.add(remoteId);
  }
  const expectedMappingCount = planIndex.completedCreateCountByBatch[checkpoint.nextBatchIndex];
  if (temporaryMappings.length !== expectedMappingCount) {
    throw checkpointAdmissionError("temporary_id_missing", {
      expectedCount: expectedMappingCount,
      observedCount: temporaryMappings.length,
    });
  }

  requireCheckpointInteger(checkpoint.observationCount, "observationCount", {
    max: MAX_CHECKPOINT_OBSERVATIONS,
  });
  if (
    !digestPattern.test(checkpoint.observationBaseDigest)
    || !digestPattern.test(checkpoint.observationDigest)
  ) {
    throw checkpointAdmissionError("observation_digest_shape");
  }
  requireCheckpointInteger(checkpoint.settlementCount, "settlementCount", {
    max: planIndex.batchCount,
  });
  requireCheckpointInteger(checkpoint.settlementBaseCount, "settlementBaseCount", {
    max: checkpoint.settlementCount,
  });
  if (
    checkpoint.settlementCount !== checkpoint.nextBatchIndex
    || !digestPattern.test(checkpoint.settlementBaseDigest)
    || !digestPattern.test(checkpoint.settlementDigest)
  ) {
    throw checkpointAdmissionError("settlement_summary", {
      expectedCount: checkpoint.nextBatchIndex,
      observedCount: checkpoint.settlementCount,
    });
  }
  const expectedSettlementBaseDigest = settlementTranscriptDigest(
    checkpoint,
    planIndex,
    checkpoint.settlementBaseCount,
  );
  if (checkpoint.settlementBaseDigest !== expectedSettlementBaseDigest) {
    throw checkpointAdmissionError("settlement_transcript_base");
  }
  const expectedSettlementDigest = settlementTranscriptDigest(
    checkpoint,
    planIndex,
    checkpoint.settlementCount,
  );
  if (checkpoint.settlementDigest !== expectedSettlementDigest) {
    throw checkpointAdmissionError("settlement_transcript_digest");
  }
  const expectedObservationWindow = Math.min(
    checkpoint.observationCount,
    MAX_CHECKPOINT_OBSERVATION_WINDOW,
  );
  if (checkpoint.observations.length !== expectedObservationWindow) {
    throw checkpointAdmissionError("settlement_missing", {
      expectedObservationWindow,
      observedObservationWindow: checkpoint.observations.length,
    });
  }
  if (
    checkpoint.observationCount <= MAX_CHECKPOINT_OBSERVATION_WINDOW
    && checkpoint.observationBaseDigest !== observationTranscriptSeed
  ) {
    throw checkpointAdmissionError("observation_transcript_base");
  }
  let previousBatchIndex = -1;
  let observedTranscriptDigest = checkpoint.observationBaseDigest;
  let observedSettlementCount = checkpoint.settlementBaseCount;
  const firstObservationIndex = checkpoint.observationCount - checkpoint.observations.length;
  for (const [index, observation] of checkpoint.observations.entries()) {
    const kind = observationKind(observation.classification);
    requireCheckpointInteger(observation.batchIndex, `observations[${index}].batchIndex`, {
      max: planIndex.batchCount - 1,
    });
    requireCheckpointInteger(observation.attempt, `observations[${index}].attempt`, { max: 100 });
    if (
      observation.batchIndex < checkpoint.settlementBaseCount
      || observation.batchIndex < previousBatchIndex
      || observation.batchIndex > checkpoint.nextBatchIndex
    ) {
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
      if (observation.batchIndex >= checkpoint.nextBatchIndex) {
        throw checkpointAdmissionError("settlement_ahead_of_checkpoint", {
          batchIndex: observation.batchIndex,
        });
      }
      requireCheckpointInteger(observation.remoteRevision, `observations[${index}].remoteRevision`);
      requireCheckpointInteger(observation.operationCount, `observations[${index}].operationCount`, {
        min: 1,
        max: planIndex.operationCountByBatch[observation.batchIndex],
      });
      const expectedBatchRevision = checkpoint.initialRemoteRevision + observation.batchIndex + 1;
      if (
        observation.batchIndex !== observedSettlementCount
        || observation.remoteRevision !== expectedBatchRevision
        || observation.operationCount !== planIndex.operationCountByBatch[observation.batchIndex]
      ) {
        throw checkpointAdmissionError("settlement_progress", {
          batchIndex: observation.batchIndex,
          expectedRemoteRevision: expectedBatchRevision,
          observedRemoteRevision: observation.remoteRevision,
          expectedOperationCount: planIndex.operationCountByBatch[observation.batchIndex],
          observedOperationCount: observation.operationCount,
        });
      }
      observedSettlementCount += 1;
    }
    observedTranscriptDigest = extendObservationTranscript(
      observedTranscriptDigest,
      firstObservationIndex + index,
      observation,
    );
  }
  if (observedTranscriptDigest !== checkpoint.observationDigest) {
    throw checkpointAdmissionError("observation_transcript_digest");
  }
  if (observedSettlementCount !== checkpoint.settlementCount) {
    throw checkpointAdmissionError("settlement_missing", {
      expectedCount: checkpoint.settlementCount,
      observedCount: observedSettlementCount,
    });
  }
  assertCredentialSafe(checkpoint, "checkpoint");
  return checkpoint;
}

async function persistCheckpoint({
  checkpointStore,
  runId,
  checkpoint,
  planIndex,
  maxBatchBytes,
  restartAt,
  batchIndex = null,
  fencingToken,
  renewLease,
  leaseFailureRestartAt,
}) {
  let saved;
  let saveSettled = false;
  try {
    // Renewal proves live ownership around the awaited store write. The store's
    // atomic fencing token closes the expiry/takeover race between these checks.
    await renewLease();
    saved = await checkpointStore.save(runId, checkpoint, { fencingToken });
    saveSettled = true;
    await renewLease();
  } catch (error) {
    if (error instanceof LeaseError) {
      return {
        accepted: false,
        leaseAuthorityLost: true,
        result: statusResult("friction", {
          code: error.code,
          runId,
          ...(batchIndex === null ? {} : { batchIndex }),
          details: {
            ...error.details,
            checkpointPersistence: saveSettled
              ? "store_returned_record_requires_authority_reconciliation"
              : "earlier_checkpoint_retained",
          },
          restartAt: leaseFailureRestartAt,
        }),
      };
    }
    throw error;
  }
  try {
    const admitted = admitCheckpointShape(saved);
    validateCheckpoint(admitted, { runId, planIndex, maxBatchBytes });
    if (digest(admitted) !== digest(checkpoint)) {
      throw checkpointAdmissionError("persistence_mismatch");
    }
    return { accepted: true, value: admitted };
  } catch (error) {
    if (error instanceof PlanError && error.code === "checkpoint_invalid") {
      return {
        accepted: false,
        result: statusResult("friction", {
          code: "checkpoint_persistence_invalid",
          runId,
          details: error.details,
          restartAt,
        }),
      };
    }
    throw error;
  }
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

function admitLeaseAuthority(value, { owner, expectedGeneration = null, nowMs }) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new LeaseError("lease_authority_invalid", "The lease store returned an invalid authority record.");
  }
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  const keys = ownKeys.every((key) => typeof key === "string")
    ? [...ownKeys].sort()
    : [];
  const expectedKeys = ["expiresAtMs", "generation", "owner"];
  const exactDataShape = (prototype === Object.prototype || prototype === null)
    && keys.length === ownKeys.length
    && keys.length === expectedKeys.length
    && keys.every((key, index) => {
      const descriptor = descriptors[key];
      return key === expectedKeys[index]
        && typeof key === "string"
        && descriptor.enumerable
        && "value" in descriptor;
    });
  if (!exactDataShape) {
    throw new LeaseError("lease_authority_invalid", "The lease store returned an invalid authority record.");
  }
  const admitted = Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
  if (
    admitted.owner !== owner
    || !Number.isSafeInteger(admitted.generation)
    || admitted.generation < 1
    || (expectedGeneration !== null && admitted.generation !== expectedGeneration)
    || !Number.isSafeInteger(admitted.expiresAtMs)
    || admitted.expiresAtMs <= nowMs
  ) {
    throw new LeaseError(
      "lease_authority_invalid",
      "The lease store returned authority that does not match the current writer coordinate.",
      { owner, expectedGeneration },
    );
  }
  return admitted;
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

function boundedLeaseReleaseFailure(releaseError, owner, generation) {
  return Object.freeze({
    source: "writer_lease_release",
    code: releaseError.code,
    owner,
    generation,
    restartAt: "inspect_writer_lease",
  });
}

function retainSecondaryReleaseFailure(primaryError, secondaryFailure) {
  if (
    primaryError === null
    || (typeof primaryError !== "object" && typeof primaryError !== "function")
  ) return;
  try {
    // Descriptor inspection preserves an existing cause accessor without
    // invoking caller-controlled code during failure cleanup.
    const existing = Object.getOwnPropertyDescriptor(primaryError, "secondaryFailure");
    if (existing !== undefined && !existing.configurable) return;
    Object.defineProperty(primaryError, "secondaryFailure", {
      configurable: true,
      enumerable: false,
      value: secondaryFailure,
      writable: false,
    });
  } catch {
    // The primary failure remains authoritative when its object rejects a
    // bounded secondary observation.
  }
}

function remoteProtocolInvalidResult({
  runId,
  batchIndex,
  source,
  admission,
  restartAt = `reconcile:batch:${batchIndex}`,
}) {
  const { accepted: _accepted, reason, ...details } = admission;
  return statusResult("friction", {
    code: "remote_protocol_invalid",
    runId,
    batchIndex,
    details: { source, reason, ...details },
    restartAt,
  });
}

function checkpointRemoteDriftResult({
  runId,
  batchIndex,
  checkpoint,
  observedSnapshot,
  observedStateDigest,
}) {
  return statusResult("conflict", {
    code: "checkpoint_remote_drift",
    runId,
    batchIndex,
    details: {
      expectedRevision: checkpoint.expectedRemoteRevision,
      observedRevision: observedSnapshot.revision,
      expectedStateDigest: checkpoint.expectedRemoteStateDigest,
      observedStateDigest,
    },
    restartAt: "reconcile:resume",
  });
}

function hasObservationCapacity(checkpoint, required = 1) {
  return checkpoint.observationCount + required <= MAX_CHECKPOINT_OBSERVATIONS;
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

function resolveBatchCoordinate(identifier, batchTempIdToRealId) {
  return batchTempIdToRealId.get(identifier) ?? identifier;
}

function semanticIdentity(kind, coordinate) {
  return { kind, coordinate };
}

function semanticIdentityKey(identity) {
  return `${identity.kind === "created" ? "0" : "1"}:${identity.coordinate}`;
}

function projectSemanticBatchTransition({ priorSnapshot, operations, remoteRevision }) {
  const createdTempIds = new Set(
    operations
      .filter((operation) => operation.type === "create_variable")
      .map((operation) => operation.tempId),
  );
  const identityForCoordinate = (coordinate) => createdTempIds.has(coordinate)
    ? semanticIdentity("created", coordinate)
    : semanticIdentity("remote", coordinate);
  const variables = new Map(
    priorSnapshot.variables.map((variable) => {
      const identity = semanticIdentity("remote", variable.id);
      return [semanticIdentityKey(identity), {
        identity,
        name: variable.name,
        resolvedType: variable.resolvedType,
        value: structuredClone(variable.value),
        referenceTo: variable.referenceTo === null
          ? null
          : semanticIdentity("remote", variable.referenceTo),
        deprecated: variable.deprecated,
        version: variable.version,
      }];
    }),
  );

  for (const operation of operations) {
    if (operation.type === "create_variable") {
      const identity = semanticIdentity("created", operation.tempId);
      const key = semanticIdentityKey(identity);
      if (variables.has(key)) {
        return { accepted: false, reason: "batch_transition_create_collision" };
      }
      const referenceTo = operation.payload.referenceTo
        ? identityForCoordinate(operation.payload.referenceTo)
        : null;
      if (referenceTo !== null && !variables.has(semanticIdentityKey(referenceTo))) {
        return { accepted: false, reason: "batch_transition_reference_missing" };
      }
      variables.set(key, {
        identity,
        name: operation.payload.name,
        resolvedType: operation.payload.resolvedType,
        value: structuredClone(operation.payload.value),
        referenceTo,
        deprecated: false,
        version: 1,
      });
      continue;
    }

    const identity = identityForCoordinate(operation.targetId);
    const key = semanticIdentityKey(identity);
    const current = variables.get(key);
    if (current === undefined) {
      return { accepted: false, reason: "batch_transition_target_missing" };
    }
    if (
      Object.hasOwn(operation, "expectedVersion")
      && operation.expectedVersion !== current.version
    ) {
      return { accepted: false, reason: "batch_transition_version_mismatch" };
    }
    if (operation.type === "delete_variable") {
      variables.delete(key);
      continue;
    }
    const next = structuredClone(current);
    if (operation.type === "update_variable") {
      if (Object.hasOwn(operation.payload, "name")) next.name = operation.payload.name;
      if (Object.hasOwn(operation.payload, "resolvedType")) {
        next.resolvedType = operation.payload.resolvedType;
      }
      if (Object.hasOwn(operation.payload, "value")) {
        next.value = structuredClone(operation.payload.value);
      }
    } else if (operation.type === "rewire_reference") {
      const referenceTo = identityForCoordinate(operation.payload.referenceTo);
      if (!variables.has(semanticIdentityKey(referenceTo))) {
        return { accepted: false, reason: "batch_transition_reference_missing" };
      }
      next.referenceTo = referenceTo;
    } else if (operation.type === "deprecate_variable") {
      next.deprecated = true;
    }
    next.version = current.version + 1;
    variables.set(key, next);
  }

  if ([...variables.values()].some(
    (variable) => variable.referenceTo !== null
      && !variables.has(semanticIdentityKey(variable.referenceTo)),
  )) {
    return { accepted: false, reason: "batch_transition_dangling_reference" };
  }

  return {
    accepted: true,
    value: {
      revision: remoteRevision,
      variables: [...variables.entries()]
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([, variable]) => variable),
    },
  };
}

function semanticSnapshotDigest(snapshot, results) {
  const createdTempIdByTargetId = new Map(
    results
      .filter((result) => Object.hasOwn(result, "tempId"))
      .map((result) => [result.targetId, result.tempId]),
  );
  const identityForRemoteId = (remoteId) => createdTempIdByTargetId.has(remoteId)
    ? semanticIdentity("created", createdTempIdByTargetId.get(remoteId))
    : semanticIdentity("remote", remoteId);
  const variables = snapshot.variables
    .map((variable) => ({
      identity: identityForRemoteId(variable.id),
      name: variable.name,
      resolvedType: variable.resolvedType,
      value: structuredClone(variable.value),
      referenceTo: variable.referenceTo === null
        ? null
        : identityForRemoteId(variable.referenceTo),
      deprecated: variable.deprecated,
      version: variable.version,
    }))
    .sort((left, right) => {
      const leftKey = semanticIdentityKey(left.identity);
      const rightKey = semanticIdentityKey(right.identity);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
  return digest({ revision: snapshot.revision, variables });
}

function expectedCreatedVariablesAfterBatch(operations, results) {
  const batchTempIdToRealId = new Map(
    results
      .filter((result) => Object.hasOwn(result, "tempId"))
      .map((result) => [result.tempId, result.targetId]),
  );
  const createdTargetIds = new Set(batchTempIdToRealId.values());
  const expectedByTargetId = new Map();

  for (const operation of operations) {
    if (operation.type === "create_variable") {
      const targetId = batchTempIdToRealId.get(operation.tempId);
      expectedByTargetId.set(targetId, {
        id: targetId,
        name: operation.payload.name,
        resolvedType: operation.payload.resolvedType,
        value: structuredClone(operation.payload.value),
        referenceTo: operation.payload.referenceTo
          ? resolveBatchCoordinate(operation.payload.referenceTo, batchTempIdToRealId)
          : null,
        deprecated: false,
        version: 1,
      });
      continue;
    }

    const targetId = resolveBatchCoordinate(operation.targetId, batchTempIdToRealId);
    if (!createdTargetIds.has(targetId) || !expectedByTargetId.has(targetId)) continue;
    const current = expectedByTargetId.get(targetId);
    if (operation.type === "delete_variable") {
      expectedByTargetId.delete(targetId);
      continue;
    }
    const next = structuredClone(current);
    if (operation.type === "update_variable") {
      if (Object.hasOwn(operation.payload, "name")) next.name = operation.payload.name;
      if (Object.hasOwn(operation.payload, "resolvedType")) {
        next.resolvedType = operation.payload.resolvedType;
      }
      if (Object.hasOwn(operation.payload, "value")) {
        next.value = structuredClone(operation.payload.value);
      }
    } else if (operation.type === "rewire_reference") {
      next.referenceTo = resolveBatchCoordinate(
        operation.payload.referenceTo,
        batchTempIdToRealId,
      );
    } else if (operation.type === "deprecate_variable") {
      next.deprecated = true;
    }
    next.version = current.version + 1;
    expectedByTargetId.set(targetId, next);
  }

  return { batchTempIdToRealId, expectedByTargetId };
}

function verifyCreatedIdentityTransfer({ checkpoint, operations, results, snapshot }) {
  const priorRemoteIds = new Set(checkpoint.knownRemoteVariableIds);
  const priorMappedIds = new Set(Object.values(checkpoint.tempIdToRealId));
  const snapshotById = new Map(snapshot.variables.map((variable) => [variable.id, variable]));
  const { batchTempIdToRealId, expectedByTargetId } = expectedCreatedVariablesAfterBatch(
    operations,
    results,
  );

  for (const [tempId, targetId] of batchTempIdToRealId) {
    if (priorRemoteIds.has(targetId) || priorMappedIds.has(targetId)) {
      return { accepted: false, reason: "created_target_identity_reused", tempId };
    }
    const expected = expectedByTargetId.get(targetId);
    const observed = snapshotById.get(targetId);
    if (expected === undefined) {
      if (observed !== undefined) {
        return { accepted: false, reason: "deleted_created_target_present", tempId };
      }
      continue;
    }
    if (observed === undefined || digest(observed) !== digest(expected)) {
      return { accepted: false, reason: "created_target_state_mismatch", tempId };
    }
  }
  return { accepted: true };
}

function extendRemoteIdentityLedger(checkpoint, results) {
  const createdTargetIds = results
    .filter((result) => Object.hasOwn(result, "tempId"))
    .map((result) => result.targetId)
    .sort(compareOrdinal);
  if (createdTargetIds.length === 0) return;

  // Snapshot admission and identity-transfer verification establish that the
  // existing ledger and this batch's created IDs are each sorted, unique, and
  // disjoint. Merge those admitted runs once instead of sorting the growing
  // historical ledger after every batch.
  const knownTargetIds = checkpoint.knownRemoteVariableIds;
  const merged = [];
  let knownIndex = 0;
  let createdIndex = 0;
  while (knownIndex < knownTargetIds.length && createdIndex < createdTargetIds.length) {
    if (compareOrdinal(knownTargetIds[knownIndex], createdTargetIds[createdIndex]) < 0) {
      merged.push(knownTargetIds[knownIndex]);
      knownIndex += 1;
    } else {
      merged.push(createdTargetIds[createdIndex]);
      createdIndex += 1;
    }
  }
  checkpoint.knownRemoteVariableIds = merged.concat(
    knownTargetIds.slice(knownIndex),
    createdTargetIds.slice(createdIndex),
  );
}

function missingLiveRemoteIdentity(checkpoint, snapshot) {
  const known = new Set(checkpoint.knownRemoteVariableIds);
  return snapshot.variables.find((variable) => !known.has(variable.id))?.id ?? null;
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
  sleep = delay,
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
  const planIndex = formCheckpointPlanIndex(plan);
  const startedAtMs = await clock.now();
  let lease;
  try {
    const acquiredAtMs = await clock.now();
    const acquired = await leaseStore.acquire({
      owner,
      nowMs: acquiredAtMs,
      ttlMs: leaseTtlMs,
    });
    lease = admitLeaseAuthority(acquired, { owner, nowMs: acquiredAtMs });
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

  let executionResult;
  let executionError;
  let executionFailed = false;
  let leaseAuthorityLost = false;
  const executeWithLease = async () => {
    let claimedFencingToken;
    try {
      claimedFencingToken = await checkpointStore.claimFence(runId, lease.generation);
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
    if (claimedFencingToken !== lease.generation) {
      return statusResult("friction", {
        code: "checkpoint_fence_unconfirmed",
        runId,
        details: { owner, generation: lease.generation },
        restartAt: "acquire_writer_lease",
      });
    }
    const renewWriterLease = async () => {
      const renewedAtMs = await clock.now();
      const renewed = await leaseStore.renew({
        owner,
        generation: lease.generation,
        nowMs: renewedAtMs,
        ttlMs: leaseTtlMs,
      });
      return admitLeaseAuthority(renewed, {
        owner,
        expectedGeneration: lease.generation,
        nowMs: renewedAtMs,
      });
    };
    const persistCurrentCheckpoint = async ({
      checkpoint,
      restartAt,
      leaseFailureRestartAt,
      batchIndex = null,
    }) => {
      const persisted = await persistCheckpoint({
        checkpointStore,
        runId,
        checkpoint,
        planIndex,
        maxBatchBytes,
        restartAt,
        batchIndex,
        fencingToken: lease.generation,
        renewLease: renewWriterLease,
        leaseFailureRestartAt,
      });
      if (persisted.leaseAuthorityLost) leaseAuthorityLost = true;
      return persisted;
    };
    const storedCheckpoint = await checkpointStore.load(runId);
    let existing = null;
    if (storedCheckpoint !== null) {
      try {
        existing = admitCheckpointShape(storedCheckpoint);
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
      if (!digestPattern.test(existing.planDigest)) {
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
        validateCheckpoint(existing, { runId, planIndex, maxBatchBytes });
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
    const observedStartAdmission = admitRemoteSnapshot(await remote.snapshot());
    if (!observedStartAdmission.accepted) {
      return remoteProtocolInvalidResult({
        runId,
        batchIndex: existing?.nextBatchIndex ?? 0,
        source: "initial_snapshot",
        admission: observedStartAdmission,
        restartAt: "reconcile:initial",
      });
    }
    const observedStart = observedStartAdmission.value;
    let resumeSettlement = null;
    const observedStateDigest = digest(observedStart);
    const checkpointMatchesObservedStart = existing !== null
      && observedStart.revision === existing.expectedRemoteRevision
      && observedStateDigest === existing.expectedRemoteStateDigest;
    if (checkpointMatchesObservedStart) {
      if (missingLiveRemoteIdentity(existing, observedStart) !== null) {
        return statusResult("friction", {
          code: "checkpoint_invalid",
          runId,
          details: { reason: "remote_identity_ledger_missing" },
          restartAt: "inspect_checkpoint",
        });
      }
    } else if (existing && existing.nextBatchIndex < plan.batches.length) {
      const batchIndex = existing.nextBatchIndex;
      const pendingBatch = plan.batches[batchIndex];
      const resolvedOperations = resolveBatchOperations(
        pendingBatch.operations,
        existing.tempIdToRealId,
      );
      const onePendingBatchAdvanced =
        observedStart.revision === existing.expectedRemoteRevision + 1;
      if (onePendingBatchAdvanced) {
        const response = await remote.readIntentResults(pendingBatch.operationIds);
        const admission = admitRemoteIntentObservation(response, resolvedOperations);
        if (!admission.accepted) {
          return remoteProtocolInvalidResult({
            runId,
            batchIndex,
            source: "resume_intent_observation",
            admission,
          });
        }
        const reconciliation = resolveReconciliation(admission.value);
        if (
          reconciliation.classification === "already_applied"
          && admission.value.remoteRevision === observedStart.revision
        ) {
          const resumedStateDigest = semanticSnapshotDigest(
            observedStart,
            reconciliation.results,
          );
          if (
            existing.pendingTransition !== null
            && resumedStateDigest === existing.pendingTransition.projectedStateDigest
          ) {
            // The durable projected state and exact intent set jointly explain
            // this one-revision advance; the writer settles from the recorded outcome.
            resumeSettlement = {
              batchIndex,
              value: {
                disposition: "idempotent_replay",
                remoteRevision: admission.value.remoteRevision,
                results: reconciliation.results,
              },
            };
          } else if (existing.pendingTransition !== null) {
            return remoteProtocolInvalidResult({
              runId,
              batchIndex,
              source: "resume_state_transition",
              admission: {
                accepted: false,
                reason: "batch_transition_state_mismatch",
              },
            });
          }
        }
      }
      if (!resumeSettlement) {
        return checkpointRemoteDriftResult({
          runId,
          batchIndex,
          checkpoint: existing,
          observedSnapshot: observedStart,
          observedStateDigest,
        });
      }
    }
    let checkpoint = existing;
    if (checkpoint === null) {
      const initialSettlementDigest = settlementTranscriptDigest(
        {
          runId,
          planDigest: plan.planDigest,
          initialRemoteRevision: observedStart.revision,
        },
        planIndex,
        0,
      );
      const initialCheckpoint = {
        schemaVersion: "0.1.0",
        runId,
        planDigest: plan.planDigest,
        nextBatchIndex: 0,
        expectedRemoteRevision: observedStart.revision,
        expectedRemoteStateDigest: digest(observedStart),
        initialRemoteRevision: observedStart.revision,
        maxResolvedBatchBytes: 0,
        pendingTransition: null,
        tempIdToRealId: {},
        knownRemoteVariableIds: observedStart.variables.map(({ id }) => id),
        observationCount: 0,
        observationBaseDigest: observationTranscriptSeed,
        observationDigest: observationTranscriptSeed,
        settlementCount: 0,
        settlementBaseCount: 0,
        settlementBaseDigest: initialSettlementDigest,
        settlementDigest: initialSettlementDigest,
        observations: [],
      };
      const persisted = await persistCurrentCheckpoint({
        checkpoint: initialCheckpoint,
        restartAt: "persist:initial_checkpoint",
        leaseFailureRestartAt: "acquire_writer_lease",
      });
      if (!persisted.accepted) return persisted.result;
      checkpoint = persisted.value;
    }
    const resumedFromBatch = checkpoint.nextBatchIndex;
    let lastObservedSnapshot = observedStart;
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
      const settlementContinuesEarlierRun = resumeSettlement?.batchIndex === batchIndex;
      if (!settlementContinuesEarlierRun) {
        const projectedTransition = projectSemanticBatchTransition({
          priorSnapshot: lastObservedSnapshot,
          operations: resolvedOperations,
          remoteRevision: checkpoint.expectedRemoteRevision + 1,
        });
        if (!projectedTransition.accepted) {
          return remoteProtocolInvalidResult({
            runId,
            batchIndex,
            source: "pending_transition_projection",
            admission: projectedTransition,
          });
        }
        const projectedStateDigest = digest(projectedTransition.value);
        if (checkpoint.pendingTransition === null) {
          checkpoint.pendingTransition = {
            batchIndex,
            priorRevision: checkpoint.expectedRemoteRevision,
            priorStateDigest: checkpoint.expectedRemoteStateDigest,
            projectedStateDigest,
          };
          const persisted = await persistCurrentCheckpoint({
            checkpoint,
            restartAt: `persist:pending_transition:batch:${batchIndex}`,
            leaseFailureRestartAt: `batch:${batchIndex}`,
            batchIndex,
          });
          if (!persisted.accepted) return persisted.result;
          checkpoint = persisted.value;
        } else if (checkpoint.pendingTransition.projectedStateDigest !== projectedStateDigest) {
          return statusResult("friction", {
            code: "checkpoint_invalid",
            runId,
            batchIndex,
            details: { reason: "pending_transition_projection_mismatch" },
            restartAt: "inspect_checkpoint",
          });
        }
      }
      let settled = settlementContinuesEarlierRun
        ? resumeSettlement.value
        : null;
      if (settled) resumeSettlement = null;

      while (!settled) {
        if (!hasObservationCapacity(checkpoint)) {
          return observationLimitResult({
            runId,
            batchIndex,
            restartAt: `batch:${batchIndex}`,
          });
        }
        try {
          await renewWriterLease();
        } catch (error) {
          if (error instanceof LeaseError) {
            leaseAuthorityLost = true;
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
          const response = await remote.applyBatch(resolvedOperations, {
            expectedRevision: checkpoint.expectedRemoteRevision,
            fault,
          });
          const admission = admitRemoteSettlement(response, resolvedOperations);
          if (!admission.accepted) {
            return remoteProtocolInvalidResult({
              runId,
              batchIndex,
              source: "apply_batch",
              admission,
            });
          }
          settled = admission.value;
        } catch (error) {
          if (error instanceof RetryAfterError) {
            if (!Number.isSafeInteger(error.retryAfterMs) || error.retryAfterMs < 0) {
              return remoteProtocolInvalidResult({
                runId,
                batchIndex,
                source: "retry_after",
                admission: { accepted: false, reason: "retry_after_ms" },
              });
            }
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
            appendCheckpointObservation(checkpoint, {
              batchIndex,
              attempt,
              classification: "bounded_retry",
              retryAfterMs: error.retryAfterMs,
            }, planIndex);
            const persisted = await persistCurrentCheckpoint({
              checkpoint,
              restartAt: `persist:retry:batch:${batchIndex}`,
              leaseFailureRestartAt: `batch:${batchIndex}`,
              batchIndex,
            });
            if (!persisted.accepted) return persisted.result;
            checkpoint = persisted.value;
            await sleep(error.retryAfterMs);
            attempt += 1;
            continue;
          }

          if (error instanceof OutcomeUnknownError) {
            const response = await remote.readIntentResults(batch.operationIds);
            const admission = admitRemoteIntentObservation(response, resolvedOperations);
            if (!admission.accepted) {
              return remoteProtocolInvalidResult({
                runId,
                batchIndex,
                source: "intent_observation",
                admission,
              });
            }
            const observation = admission.value;
            const reconciliation = resolveReconciliation(observation);
            const requiredObservations = reconciliation.classification === "already_applied" ? 2 : 1;
            if (!hasObservationCapacity(checkpoint, requiredObservations)) {
              return observationLimitResult({
                runId,
                batchIndex,
                restartAt: `reconcile:batch:${batchIndex}`,
              });
            }
            appendCheckpointObservation(checkpoint, {
              batchIndex,
              attempt,
              classification: reconciliation.classification,
              observedRemoteRevision: observation.remoteRevision,
            }, planIndex);
            const persisted = await persistCurrentCheckpoint({
              checkpoint,
              restartAt: `persist:reconciliation:batch:${batchIndex}`,
              leaseFailureRestartAt: `reconcile:batch:${batchIndex}`,
              batchIndex,
            });
            if (!persisted.accepted) return persisted.result;
            checkpoint = persisted.value;
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

      const settledSnapshotAdmission = admitRemoteSnapshot(await remote.snapshot());
      if (!settledSnapshotAdmission.accepted) {
        return remoteProtocolInvalidResult({
          runId,
          batchIndex,
          source: "settled_snapshot",
          admission: settledSnapshotAdmission,
        });
      }
      const settledSnapshot = settledSnapshotAdmission.value;
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

      const identityTransfer = verifyCreatedIdentityTransfer({
        checkpoint,
        operations: resolvedOperations,
        results: settled.results,
        snapshot: settledSnapshot,
      });
      if (!identityTransfer.accepted) {
        return remoteProtocolInvalidResult({
          runId,
          batchIndex,
          source: "created_identity_transfer",
          admission: identityTransfer,
        });
      }

      const observedTransitionDigest = semanticSnapshotDigest(
        settledSnapshot,
        settled.results,
      );
      if (
        checkpoint.pendingTransition === null
        || observedTransitionDigest !== checkpoint.pendingTransition.projectedStateDigest
      ) {
        return remoteProtocolInvalidResult({
          runId,
          batchIndex,
          source: settlementContinuesEarlierRun
            ? "resume_state_transition"
            : "settled_state_transition",
          admission: {
            accepted: false,
            reason: "batch_transition_state_mismatch",
          },
        });
      }

      for (const result of settled.results) {
        if (result.tempId) {
          recordTemporaryIdentity(checkpoint.tempIdToRealId, result.tempId, result.targetId);
        }
      }
      extendRemoteIdentityLedger(checkpoint, settled.results);
      lastObservedSnapshot = settledSnapshot;
      checkpoint.nextBatchIndex = batchIndex + 1;
      checkpoint.expectedRemoteRevision = settled.remoteRevision;
      checkpoint.expectedRemoteStateDigest = digest(settledSnapshot);
      checkpoint.pendingTransition = null;
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
      appendCheckpointObservation(checkpoint, {
        batchIndex,
        attempt,
        classification: settled.disposition,
        remoteRevision: settled.remoteRevision,
        operationCount: settled.results.length,
      }, planIndex);
      const persisted = await persistCurrentCheckpoint({
        checkpoint,
        restartAt: `persist:settlement:batch:${batchIndex}`,
        leaseFailureRestartAt: `reconcile:batch:${batchIndex}`,
        batchIndex,
      });
      if (!persisted.accepted) return persisted.result;
      checkpoint = persisted.value;
    }

    const finalSnapshotAdmission = admitRemoteSnapshot(await remote.snapshot());
    if (!finalSnapshotAdmission.accepted) {
      return remoteProtocolInvalidResult({
        runId,
        batchIndex: checkpoint.nextBatchIndex,
        source: "final_snapshot",
        admission: finalSnapshotAdmission,
        restartAt: "reconcile:final",
      });
    }
    const finalSnapshot = finalSnapshotAdmission.value;
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
      observationTranscript: {
        count: checkpoint.observationCount,
        retainedCount: checkpoint.observations.length,
        truncated: checkpoint.observationCount > checkpoint.observations.length,
        digest: checkpoint.observationDigest,
      },
      settlementTranscript: {
        count: checkpoint.settlementCount,
        releasedCount: checkpoint.settlementBaseCount,
        digest: checkpoint.settlementDigest,
      },
      elapsedMs: (await clock.now()) - startedAtMs,
    };
    assertSanitizedReceipt(receipt);
    return receipt;
  };
  try {
    executionResult = await executeWithLease();
    return executionResult;
  } catch (error) {
    executionFailed = true;
    executionError = error;
    throw error;
  } finally {
    let releaseError;
    try {
      const released = await leaseStore.release({ owner, generation: lease.generation });
      if (released !== true && !leaseAuthorityLost) {
        releaseError = new LeaseError(
          "lease_release_unconfirmed",
          "The writer lease release needs inspection before another synchronization begins.",
          { owner, generation: lease.generation, restartAt: "inspect_writer_lease" },
        );
      }
    } catch (error) {
      // A successor generation already owns recovery after authority loss. A
      // failed release from the expired generation therefore cannot replace
      // the typed lease-loss result or become the next operator action.
      if (!leaseAuthorityLost) {
        releaseError = new LeaseError(
          "lease_release_failed",
          "The current synchronization path completed and the writer lease release needs inspection.",
          { owner, generation: lease.generation, restartAt: "inspect_writer_lease" },
        );
      }
    }

    if (
      releaseError
      && !executionFailed
      && executionResult !== undefined
      && executionResult.status !== "accepted"
    ) {
      executionResult.secondaryFailure = boundedLeaseReleaseFailure(
        releaseError,
        owner,
        lease.generation,
      );
      assertSanitizedReceipt(executionResult);
    } else if (releaseError && !executionFailed) {
      throw releaseError;
    }
    if (releaseError && executionFailed) {
      retainSecondaryReleaseFailure(
        executionError,
        boundedLeaseReleaseFailure(releaseError, owner, lease.generation),
      );
    }
  }
}
