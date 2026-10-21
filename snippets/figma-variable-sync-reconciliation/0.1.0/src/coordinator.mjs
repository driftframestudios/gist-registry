import { setTimeout as delay } from "node:timers/promises";
import { types as utilTypes } from "node:util";
import {
  assertSanitizedReceipt,
  canonicalize,
  compareOrdinal,
  digest,
} from "./canonical.mjs";
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
const typedErrorDetailLimits = Object.freeze({
  depth: 8,
  nodes: 256,
  stringCodeUnits: 1_024,
  stringBytes: 4_096,
  aggregateStringBytes: 16_384,
});
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
  if (
    value === null
    || typeof value !== "object"
    || utilTypes.isProxy(value)
    || Array.isArray(value)
  ) return false;
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
    utilTypes.isProxy(value)
    || !Array.isArray(value)
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
  if (initialRemoteRevision > Number.MAX_SAFE_INTEGER - completedBatchCount) {
    throw checkpointAdmissionError("revision_capacity_exhausted", {
      initialRemoteRevision,
      completedBatchCount,
    });
  }
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
  if (checkpoint.initialRemoteRevision > Number.MAX_SAFE_INTEGER - checkpoint.nextBatchIndex) {
    throw checkpointAdmissionError("revision_capacity_exhausted", {
      initialRemoteRevision: checkpoint.initialRemoteRevision,
      completedBatchCount: checkpoint.nextBatchIndex,
    });
  }
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
  checkpointSave,
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
  let admittedSaved = null;
  let saveSettled = false;
  try {
    // Retain an admitted, caller-independent comparison coordinate before any
    // awaited collaborator receives a value. A store may mutate the object it
    // receives. The retained snapshot keeps durability comparison authority
    // fixed and preserves the coordinator's working checkpoint.
    const expectedCheckpoint = admitCheckpointShape(checkpoint);
    validateCheckpoint(expectedCheckpoint, { runId, planIndex, maxBatchBytes });
    const expectedCheckpointDigest = digest(expectedCheckpoint);
    // Renewal proves live ownership around the awaited store write. The store's
    // atomic fencing token closes the expiry/takeover race between these checks.
    await renewLease();
    const pendingSave = checkpointSave(
      runId,
      structuredClone(expectedCheckpoint),
      { fencingToken },
    );
    const saved = utilTypes.isProxy(pendingSave) ? pendingSave : await pendingSave;
    saveSettled = true;
    admittedSaved = admitCheckpointShape(saved);
    validateCheckpoint(admittedSaved, { runId, planIndex, maxBatchBytes });
    if (digest(admittedSaved) !== expectedCheckpointDigest) {
      throw checkpointAdmissionError("persistence_mismatch");
    }
    await renewLease();
  } catch (error) {
    const admittedLeaseError = admitTypedError(error, LeaseError);
    if (admittedLeaseError !== null) {
      return {
        accepted: false,
        leaseAuthorityLost: leaseFailureTransfersAuthority(admittedLeaseError.code),
        result: statusResult("friction", {
          code: admittedLeaseError.code,
          runId,
          ...(batchIndex === null ? {} : { batchIndex }),
          details: {
            ...admittedLeaseError.details,
            checkpointPersistence: saveSettled
              ? "store_returned_record_requires_authority_reconciliation"
              : "earlier_checkpoint_retained",
          },
          ...(admittedSaved === null
            ? {}
            : { durableCheckpoint: structuredClone(admittedSaved) }),
          restartAt: leaseFailureRestartAt,
        }),
        durableCheckpoint: admittedSaved,
      };
    }
    const admittedClockError = admitTypedError(error, PlanError);
    if (admittedClockError?.code === "clock_observation_invalid") {
      return {
        accepted: false,
        clockObservationInvalid: true,
        result: statusResult("friction", {
          code: admittedClockError.code,
          runId,
          ...(batchIndex === null ? {} : { batchIndex }),
          details: {
            ...admittedClockError.details,
            checkpointPersistence: saveSettled
              ? "store_returned_record_requires_clock_reconciliation"
              : "earlier_checkpoint_retained",
          },
          ...(admittedSaved === null
            ? {}
            : { durableCheckpoint: structuredClone(admittedSaved) }),
          restartAt: "inspect_clock",
        }),
        durableCheckpoint: admittedSaved,
      };
    }
    const admittedPlanError = admitTypedError(error, PlanError);
    if (admittedPlanError?.code === "checkpoint_invalid") {
      return {
        accepted: false,
        result: statusResult("friction", {
          code: "checkpoint_persistence_invalid",
          runId,
          details: admittedPlanError.details,
          restartAt,
        }),
      };
    }
    throw error;
  }
  return { accepted: true, value: admittedSaved };
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
  if (
    value === null
    || typeof value !== "object"
    || utilTypes.isProxy(value)
    || Array.isArray(value)
  ) {
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

function ownDataValue(value, key) {
  if (
    value === null
    || (typeof value !== "object" && typeof value !== "function")
    || utilTypes.isProxy(value)
  ) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function admitBoundedJsonRecord(record) {
  if (!isRecord(record)) return null;
  const pending = [{ value: record, depth: 0 }];
  const seen = new WeakSet();
  let nodes = 0;
  let aggregateStringBytes = 0;
  const admitString = (value) => {
    // Code-unit admission is O(1) and prevents byte measurement from scanning
    // a caller-provided string beyond the declared per-string envelope.
    if (value.length > typedErrorDetailLimits.stringCodeUnits) return false;
    const bytes = Buffer.byteLength(value, "utf8");
    if (bytes > typedErrorDetailLimits.stringBytes) return false;
    aggregateStringBytes += bytes;
    return aggregateStringBytes <= typedErrorDetailLimits.aggregateStringBytes;
  };

  while (pending.length > 0) {
    const current = pending.pop();
    nodes += 1;
    if (nodes > typedErrorDetailLimits.nodes || current.depth > typedErrorDetailLimits.depth) {
      return null;
    }
    if (typeof current.value === "string") {
      if (!admitString(current.value)) return null;
      continue;
    }
    if (current.value === null || typeof current.value === "boolean") continue;
    if (typeof current.value === "number") {
      if (!Number.isFinite(current.value) || Object.is(current.value, -0)) return null;
      continue;
    }
    if (typeof current.value !== "object" || utilTypes.isProxy(current.value)) return null;
    if (seen.has(current.value)) return null;
    seen.add(current.value);

    if (Array.isArray(current.value)) {
      if (
        Object.getPrototypeOf(current.value) !== Array.prototype
        || current.value.length > typedErrorDetailLimits.nodes - nodes
      ) return null;
      const descriptors = Object.getOwnPropertyDescriptors(current.value);
      const keys = Reflect.ownKeys(descriptors).filter((key) => key !== "length");
      if (
        keys.length !== current.value.length
        || keys.some((key, index) => {
          const descriptor = descriptors[key];
          return key !== String(index)
            || !descriptor.enumerable
            || !Object.hasOwn(descriptor, "value");
        })
      ) return null;
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        pending.push({ value: descriptors[keys[index]].value, depth: current.depth + 1 });
      }
      continue;
    }

    if (!isRecord(current.value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(current.value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > typedErrorDetailLimits.nodes - nodes) return null;
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      const descriptor = descriptors[key];
      if (
        typeof key !== "string"
        || !descriptor.enumerable
        || !Object.hasOwn(descriptor, "value")
        || !admitString(key)
      ) return null;
      pending.push({ value: descriptor.value, depth: current.depth + 1 });
    }
  }

  try {
    const admitted = canonicalize(record);
    assertSanitizedReceipt(admitted);
    return admitted;
  } catch {
    return null;
  }
}

function admitTypedError(error, ErrorType) {
  if (
    error === null
    || (typeof error !== "object" && typeof error !== "function")
    || utilTypes.isProxy(error)
  ) return null;
  try {
    if (Object.getPrototypeOf(error) !== ErrorType.prototype) return null;
  } catch {
    return null;
  }
  const code = ownDataValue(error, "code");
  const details = ownDataValue(error, "details");
  if (typeof code !== "string" || code.length < 1 || code.length > 128) {
    return null;
  }
  const admittedDetails = admitBoundedJsonRecord(details);
  if (admittedDetails === null) return null;
  return Object.freeze({ code, details: admittedDetails });
}

function admitRetryAfterError(error) {
  const admitted = admitTypedError(error, RetryAfterError);
  if (admitted === null) return null;
  const retryAfterMs = ownDataValue(error, "retryAfterMs");
  if (!Number.isSafeInteger(retryAfterMs) || retryAfterMs < 0) {
    return Object.freeze({ ...admitted, retryAfterMs: null });
  }
  return Object.freeze({ ...admitted, retryAfterMs });
}

function isExactTypeError(error) {
  if (
    error === null
    || (typeof error !== "object" && typeof error !== "function")
    || utilTypes.isProxy(error)
  ) return false;
  try {
    return Object.getPrototypeOf(error) === TypeError.prototype;
  } catch {
    return false;
  }
}

function requireCollaboratorMethod(receiver, methodName, owner) {
  if (
    receiver === null
    || (typeof receiver !== "object" && typeof receiver !== "function")
    || utilTypes.isProxy(receiver)
  ) {
    throw new PlanError(
      "invalid_collaborator",
      `${owner} requires a directly addressed collaborator object.`,
      { owner, methodName },
    );
  }
  const ownDescriptor = Object.getOwnPropertyDescriptor(receiver, methodName);
  const prototype = ownDescriptor === undefined ? Object.getPrototypeOf(receiver) : null;
  if (prototype !== null && utilTypes.isProxy(prototype)) {
    throw new PlanError(
      "invalid_collaborator",
      `${owner} requires an inert immediate prototype.`,
      { owner, methodName },
    );
  }
  const descriptor = ownDescriptor ?? (
    prototype === null ? undefined : Object.getOwnPropertyDescriptor(prototype, methodName)
  );
  if (
    descriptor === undefined
    || !Object.hasOwn(descriptor, "value")
    || typeof descriptor.value !== "function"
    || utilTypes.isProxy(descriptor.value)
  ) {
    throw new PlanError(
      "invalid_collaborator",
      `${owner}.${methodName} requires an own or immediate-prototype data-property function.`,
      { owner, methodName },
    );
  }
  return Reflect.apply(Function.prototype.bind, descriptor.value, [receiver]);
}

function requireCollaboratorFunction(value, owner) {
  if (typeof value !== "function" || utilTypes.isProxy(value)) {
    throw new PlanError(
      "invalid_collaborator",
      `${owner} requires a directly addressed function.`,
      { owner },
    );
  }
  return value;
}

function formClockReader(clock, leaseTtlMs) {
  const readNow = requireCollaboratorMethod(clock, "now", "clock");
  let previous = null;
  return async ({ owner, reservesLeaseTtl = false }) => {
    const pendingValue = readNow();
    const value = utilTypes.isProxy(pendingValue) ? pendingValue : await pendingValue;
    const maximum = reservesLeaseTtl
      ? Number.MAX_SAFE_INTEGER - leaseTtlMs
      : Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(value)) {
      throw new PlanError(
        "clock_observation_invalid",
        "The execution clock requires a safe-integer observation.",
        { phase: owner, reason: "shape", maximum },
      );
    }
    if (value < 0 || value > maximum) {
      throw new PlanError(
        "clock_observation_invalid",
        "The execution clock observation falls outside the active lease envelope.",
        { phase: owner, reason: "range", observed: value, minimum: 0, maximum },
      );
    }
    if (previous !== null && value < previous) {
      throw new PlanError(
        "clock_observation_invalid",
        "The execution clock moved behind its previous admitted sample.",
        { phase: owner, reason: "regression", previous, observed: value },
      );
    }
    previous = value;
    return value;
  };
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
    if (isExactTypeError(error)) {
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

function leaseFailureTransfersAuthority(code) {
  return code === "lease_lost" || code === "checkpoint_fence_rejected";
}

function retainSecondaryReleaseFailure(primaryError, secondaryFailure) {
  if (
    primaryError === null
    || (typeof primaryError !== "object" && typeof primaryError !== "function")
    || utilTypes.isProxy(primaryError)
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

function clockInspectionResult({ runId, details, durableCheckpoint = null, batchIndex = null }) {
  return statusResult("friction", {
    code: "clock_observation_invalid",
    runId,
    ...(batchIndex === null ? {} : { batchIndex }),
    details,
    ...(durableCheckpoint === null ? {} : { durableCheckpoint }),
    restartAt: "inspect_clock",
  });
}

function successorCapacityResult({ runId, code, details = {}, batchIndex = null }) {
  return statusResult("friction", {
    code,
    runId,
    ...(batchIndex === null ? {} : { batchIndex }),
    details,
    restartAt: "rebase_or_upgrade_representation",
  });
}

function inspectPlanSuccessorCapacity(snapshot, plan, startBatchIndex = 0) {
  const remainingBatches = plan.batches.slice(startBatchIndex);
  const remainingBatchCount = remainingBatches.length;
  if (snapshot.revision > Number.MAX_SAFE_INTEGER - remainingBatchCount) {
    return {
      accepted: false,
      code: "revision_capacity_exhausted",
      details: { currentRevision: snapshot.revision, requiredSuccessors: remainingBatchCount },
    };
  }

  const requiredGeneratedIds = remainingBatches.reduce(
    (count, batch) => count + batch.operations.filter(
      (operation) => operation.type === "create_variable",
    ).length,
    0,
  );
  if (snapshot.remainingGeneratedIds < requiredGeneratedIds) {
    return {
      accepted: false,
      code: "generated_id_capacity_exhausted",
      details: {
        remainingGeneratedIds: snapshot.remainingGeneratedIds,
        requiredGeneratedIds,
      },
    };
  }

  const remoteVersions = new Map(
    snapshot.variables.map((variable) => [variable.id, variable.version]),
  );
  const temporaryVersions = new Map();
  for (const batch of remainingBatches) {
    for (const operation of batch.operations) {
      if (operation.type === "create_variable") {
        temporaryVersions.set(operation.tempId, 1);
        continue;
      }
      const targetVersions = temporaryVersions.has(operation.targetId)
        ? temporaryVersions
        : remoteVersions;
      const currentVersion = targetVersions.get(operation.targetId);
      if (currentVersion === undefined) continue;
      if (operation.type === "delete_variable") {
        targetVersions.delete(operation.targetId);
        continue;
      }
      if (currentVersion === Number.MAX_SAFE_INTEGER) {
        return {
          accepted: false,
          code: "version_capacity_exhausted",
          details: { operationId: operation.id, targetId: operation.targetId, currentVersion },
        };
      }
      targetVersions.set(operation.targetId, currentVersion + 1);
    }
  }
  return { accepted: true };
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

function immutableTransportSnapshot(value) {
  const owned = structuredClone(value);
  const pending = [owned];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== "object") continue;
    for (const child of Object.values(current)) {
      if (child !== null && typeof child === "object") pending.push(child);
    }
    Object.freeze(current);
  }
  return owned;
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
  if (!Number.isSafeInteger(remoteRevision) || remoteRevision < 0) {
    return { accepted: false, reason: "revision_capacity_exhausted" };
  }
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
    if (current.version === Number.MAX_SAFE_INTEGER) {
      return {
        accepted: false,
        reason: "version_capacity_exhausted",
        operationId: operation.id,
        targetId: operation.targetId,
        currentVersion: current.version,
      };
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
  // Capture admitted collaborator methods once. Awaited work can then resume
  // without re-reading caller-controlled properties or changing authority.
  const remoteSnapshot = requireCollaboratorMethod(remote, "snapshot", "remote");
  const remoteApplyBatch = requireCollaboratorMethod(remote, "applyBatch", "remote");
  const remoteReadIntentResults = requireCollaboratorMethod(
    remote,
    "readIntentResults",
    "remote",
  );
  const leaseAcquire = requireCollaboratorMethod(leaseStore, "acquire", "leaseStore");
  const leaseRenew = requireCollaboratorMethod(leaseStore, "renew", "leaseStore");
  const leaseRelease = requireCollaboratorMethod(leaseStore, "release", "leaseStore");
  const checkpointClaimFence = requireCollaboratorMethod(
    checkpointStore,
    "claimFence",
    "checkpointStore",
  );
  const checkpointLoad = requireCollaboratorMethod(checkpointStore, "load", "checkpointStore");
  const checkpointSave = requireCollaboratorMethod(checkpointStore, "save", "checkpointStore");
  const sleepFor = requireCollaboratorFunction(sleep, "sleep");
  const faultForBatch = requireCollaboratorFunction(faultFor, "faultFor");
  const readClock = formClockReader(clock, leaseTtlMs);
  const startedAtMs = await readClock({ owner: "execution_start" });
  let lease;
  try {
    const acquiredAtMs = await readClock({
      owner: "lease_acquire_request",
      reservesLeaseTtl: true,
    });
    const pendingAcquire = leaseAcquire({
      owner,
      nowMs: acquiredAtMs,
      ttlMs: leaseTtlMs,
    });
    const acquired = utilTypes.isProxy(pendingAcquire) ? pendingAcquire : await pendingAcquire;
    // Admit enough authority to release a lease if the awaited acquisition
    // consumed its freshness window before control returned.
    lease = admitLeaseAuthority(acquired, { owner, nowMs: acquiredAtMs });
    const acquiredSettledAtMs = await readClock({ owner: "lease_acquire_settled" });
    lease = admitLeaseAuthority(acquired, { owner, nowMs: acquiredSettledAtMs });
  } catch (error) {
    const admittedLeaseError = admitTypedError(error, LeaseError);
    const admittedClockError = admitTypedError(error, PlanError);
    let result = null;
    if (admittedLeaseError !== null) {
      result = statusResult("friction", {
        code: admittedLeaseError.code,
        runId,
        details: admittedLeaseError.details,
        restartAt: "acquire_writer_lease",
      });
    } else if (admittedClockError?.code === "clock_observation_invalid") {
      result = clockInspectionResult({ runId, details: admittedClockError.details });
    }

    let releaseError;
    if (lease !== undefined) {
      try {
        const pendingRelease = leaseRelease({ owner, generation: lease.generation });
        const released = utilTypes.isProxy(pendingRelease)
          ? pendingRelease
          : await pendingRelease;
        if (released !== true) {
          releaseError = new LeaseError(
            "lease_release_unconfirmed",
            "The acquired writer lease needs inspection before another synchronization begins.",
            { owner, generation: lease.generation },
          );
        }
      } catch {
        releaseError = new LeaseError(
          "lease_release_failed",
          "The acquired writer lease needs inspection before another synchronization begins.",
          { owner, generation: lease.generation },
        );
      }
    }
    if (result !== null) {
      if (releaseError !== undefined) {
        result.secondaryFailure = boundedLeaseReleaseFailure(
          releaseError,
          owner,
          lease.generation,
        );
        assertSanitizedReceipt(result);
      }
      return result;
    }
    if (releaseError !== undefined) {
      retainSecondaryReleaseFailure(
        error,
        boundedLeaseReleaseFailure(releaseError, owner, lease.generation),
      );
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
      const pendingFence = checkpointClaimFence(runId, lease.generation);
      claimedFencingToken = utilTypes.isProxy(pendingFence) ? pendingFence : await pendingFence;
    } catch (error) {
      const admittedLeaseError = admitTypedError(error, LeaseError);
      if (admittedLeaseError !== null) {
        if (leaseFailureTransfersAuthority(admittedLeaseError.code)) {
          leaseAuthorityLost = true;
        }
        return statusResult("friction", {
          code: admittedLeaseError.code,
          runId,
          details: admittedLeaseError.details,
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
    let durableCheckpoint = null;
    const renewWriterLease = async () => {
      const renewedAtMs = await readClock({
        owner: "lease_renew_request",
        reservesLeaseTtl: true,
      });
      const pendingRenewal = leaseRenew({
        owner,
        generation: lease.generation,
        nowMs: renewedAtMs,
        ttlMs: leaseTtlMs,
      });
      const renewed = utilTypes.isProxy(pendingRenewal) ? pendingRenewal : await pendingRenewal;
      const provisionalLease = admitLeaseAuthority(renewed, {
        owner,
        expectedGeneration: lease.generation,
        nowMs: renewedAtMs,
      });
      const renewedSettledAtMs = await readClock({ owner: "lease_renew_settled" });
      lease = admitLeaseAuthority(renewed, {
        owner,
        expectedGeneration: provisionalLease.generation,
        nowMs: renewedSettledAtMs,
      });
      return lease;
    };
    const persistCurrentCheckpoint = async ({
      checkpoint,
      restartAt,
      leaseFailureRestartAt,
      batchIndex = null,
    }) => {
      const persisted = await persistCheckpoint({
        checkpointSave,
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
      if (persisted.durableCheckpoint !== null && persisted.durableCheckpoint !== undefined) {
        durableCheckpoint = structuredClone(persisted.durableCheckpoint);
      }
      if (persisted.clockObservationInvalid) {
        persisted.result = clockInspectionResult({
          runId,
          batchIndex,
          details: persisted.result.details,
          durableCheckpoint,
        });
      }
      if (persisted.accepted) durableCheckpoint = structuredClone(persisted.value);
      return persisted;
    };
    const pendingCheckpoint = checkpointLoad(runId);
    const storedCheckpoint = utilTypes.isProxy(pendingCheckpoint)
      ? pendingCheckpoint
      : await pendingCheckpoint;
    let existing = null;
    if (storedCheckpoint !== null) {
      try {
        existing = admitCheckpointShape(storedCheckpoint);
      } catch (error) {
        const admittedPlanError = admitTypedError(error, PlanError);
        if (admittedPlanError?.code === "checkpoint_invalid") {
          return statusResult("friction", {
            code: admittedPlanError.code,
            runId,
            details: admittedPlanError.details,
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
        const admittedPlanError = admitTypedError(error, PlanError);
        if (admittedPlanError?.code === "checkpoint_invalid") {
          return statusResult("friction", {
            code: admittedPlanError.code,
            runId,
            details: admittedPlanError.details,
            restartAt: "inspect_checkpoint",
          });
        }
        throw error;
      }
      durableCheckpoint = structuredClone(existing);
    }
    const pendingStartSnapshot = remoteSnapshot();
    const observedStartAdmission = admitRemoteSnapshot(
      utilTypes.isProxy(pendingStartSnapshot)
        ? pendingStartSnapshot
        : await pendingStartSnapshot,
    );
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
        existing.expectedRemoteRevision < Number.MAX_SAFE_INTEGER
        && observedStart.revision === existing.expectedRemoteRevision + 1;
      if (onePendingBatchAdvanced) {
        const pendingResponse = remoteReadIntentResults(
          immutableTransportSnapshot(pendingBatch.operationIds),
        );
        const response = utilTypes.isProxy(pendingResponse)
          ? pendingResponse
          : await pendingResponse;
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
    const successorCapacityStartBatch = existing === null
      ? 0
      : existing.nextBatchIndex + (resumeSettlement === null ? 0 : 1);
    const successorCapacity = inspectPlanSuccessorCapacity(
      observedStart,
      plan,
      successorCapacityStartBatch,
    );
    if (!successorCapacity.accepted) {
      return successorCapacityResult({
        runId,
        code: successorCapacity.code,
        details: successorCapacity.details,
        batchIndex: successorCapacityStartBatch < plan.batches.length
          ? successorCapacityStartBatch
          : null,
      });
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
        if (checkpoint.expectedRemoteRevision === Number.MAX_SAFE_INTEGER) {
          return successorCapacityResult({
            runId,
            code: "revision_capacity_exhausted",
            details: { currentRevision: checkpoint.expectedRemoteRevision, requiredSuccessors: 1 },
            batchIndex,
          });
        }
        const projectedTransition = projectSemanticBatchTransition({
          priorSnapshot: lastObservedSnapshot,
          operations: resolvedOperations,
          remoteRevision: checkpoint.expectedRemoteRevision + 1,
        });
        if (!projectedTransition.accepted) {
          if (
            projectedTransition.reason === "revision_capacity_exhausted"
            || projectedTransition.reason === "version_capacity_exhausted"
          ) {
            const { accepted: _accepted, reason, ...details } = projectedTransition;
            return successorCapacityResult({
              runId,
              code: reason,
              details,
              batchIndex,
            });
          }
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
        const pendingFault = faultForBatch(immutableTransportSnapshot({
          batchIndex,
          attempt,
          batch,
        }));
        if (utilTypes.isProxy(pendingFault)) {
          throw new PlanError(
            "invalid_collaborator_result",
            "faultFor requires an inert result before the next remote effect.",
            { owner: "faultFor" },
          );
        }
        const observedFault = await pendingFault;
        const fault = observedFault === null
          ? null
          : admitBoundedJsonRecord(observedFault);
        if (observedFault !== null && fault === null) {
          throw new PlanError(
            "invalid_collaborator_result",
            "faultFor requires a bounded plain-data fault record.",
            { owner: "faultFor" },
          );
        }
        try {
          await renewWriterLease();
        } catch (error) {
          const admittedLeaseError = admitTypedError(error, LeaseError);
          if (admittedLeaseError !== null) {
            leaseAuthorityLost = leaseFailureTransfersAuthority(admittedLeaseError.code);
            return statusResult("friction", {
              code: admittedLeaseError.code,
              runId,
              batchIndex,
              details: admittedLeaseError.details,
              restartAt: "acquire_writer_lease",
            });
          }
          const admittedClockError = admitTypedError(error, PlanError);
          if (admittedClockError?.code === "clock_observation_invalid") {
            return clockInspectionResult({
              runId,
              batchIndex,
              details: admittedClockError.details,
              durableCheckpoint,
            });
          }
          throw error;
        }
        try {
          const pendingResponse = remoteApplyBatch(
            immutableTransportSnapshot(resolvedOperations),
            immutableTransportSnapshot({
              expectedRevision: checkpoint.expectedRemoteRevision,
              fault,
            }),
          );
          const response = utilTypes.isProxy(pendingResponse)
            ? pendingResponse
            : await pendingResponse;
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
          const admittedRetryAfter = admitRetryAfterError(error);
          if (admittedRetryAfter !== null) {
            if (admittedRetryAfter.retryAfterMs === null) {
              return remoteProtocolInvalidResult({
                runId,
                batchIndex,
                source: "retry_after",
                admission: { accepted: false, reason: "retry_after_ms" },
              });
            }
            if (attempt >= maxRetries || admittedRetryAfter.retryAfterMs > maxRetryAfterMs) {
              return statusResult("friction", {
                code: "retry_budget_exhausted",
                runId,
                batchIndex,
                attempt,
                retryAfterMs: admittedRetryAfter.retryAfterMs,
                restartAt: `batch:${batchIndex}`,
              });
            }
            appendCheckpointObservation(checkpoint, {
              batchIndex,
              attempt,
              classification: "bounded_retry",
              retryAfterMs: admittedRetryAfter.retryAfterMs,
            }, planIndex);
            const persisted = await persistCurrentCheckpoint({
              checkpoint,
              restartAt: `persist:retry:batch:${batchIndex}`,
              leaseFailureRestartAt: `batch:${batchIndex}`,
              batchIndex,
            });
            if (!persisted.accepted) return persisted.result;
            checkpoint = persisted.value;
            const pendingSleep = sleepFor(admittedRetryAfter.retryAfterMs);
            if (utilTypes.isProxy(pendingSleep)) {
              throw new PlanError(
                "invalid_collaborator_result",
                "sleep requires an inert completion result.",
                { owner: "sleep" },
              );
            }
            await pendingSleep;
            attempt += 1;
            continue;
          }

          const admittedOutcomeUnknown = admitTypedError(error, OutcomeUnknownError);
          if (admittedOutcomeUnknown !== null) {
            const pendingResponse = remoteReadIntentResults(
              immutableTransportSnapshot(batch.operationIds),
            );
            const response = utilTypes.isProxy(pendingResponse)
              ? pendingResponse
              : await pendingResponse;
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

          const admittedInterruption = admitTypedError(error, ExecutionInterruptedError);
          if (admittedInterruption !== null) {
            return statusResult("interrupted", {
              code: admittedInterruption.code,
              runId,
              batchIndex,
              durableCheckpoint: checkpoint,
              restartAt: `batch:${batchIndex}`,
            });
          }

          const admittedRemoteConflict = admitTypedError(error, RemoteConflictError);
          if (admittedRemoteConflict !== null) {
            if (
              admittedRemoteConflict.code === "revision_capacity_exhausted"
              || admittedRemoteConflict.code === "version_capacity_exhausted"
              || admittedRemoteConflict.code === "generated_id_capacity_exhausted"
            ) {
              return successorCapacityResult({
                runId,
                code: admittedRemoteConflict.code,
                details: admittedRemoteConflict.details,
                batchIndex,
              });
            }
            return statusResult("conflict", {
              code: admittedRemoteConflict.code,
              runId,
              batchIndex,
              details: admittedRemoteConflict.details,
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

      const pendingSettledSnapshot = remoteSnapshot();
      const settledSnapshotAdmission = admitRemoteSnapshot(
        utilTypes.isProxy(pendingSettledSnapshot)
          ? pendingSettledSnapshot
          : await pendingSettledSnapshot,
      );
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

    const pendingFinalSnapshot = remoteSnapshot();
    const finalSnapshotAdmission = admitRemoteSnapshot(
      utilTypes.isProxy(pendingFinalSnapshot)
        ? pendingFinalSnapshot
        : await pendingFinalSnapshot,
    );
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
    let completedAtMs;
    try {
      completedAtMs = await readClock({ owner: "execution_complete" });
    } catch (error) {
      const admittedClockError = admitTypedError(error, PlanError);
      if (admittedClockError?.code === "clock_observation_invalid") {
        return clockInspectionResult({
          runId,
          details: admittedClockError.details,
          durableCheckpoint,
        });
      }
      throw error;
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
      elapsedMs: completedAtMs - startedAtMs,
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
    if (!leaseAuthorityLost) {
      try {
        const pendingRelease = leaseRelease({ owner, generation: lease.generation });
        const released = utilTypes.isProxy(pendingRelease)
          ? pendingRelease
          : await pendingRelease;
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
