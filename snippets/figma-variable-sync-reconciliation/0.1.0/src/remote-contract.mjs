import { types as utilTypes } from "node:util";

const settlementDispositions = new Set(["applied", "idempotent_replay"]);
const settlementKeys = new Set(["disposition", "remoteRevision", "results"]);
const observationKeys = new Set(["remoteRevision", "results"]);
const appliedObservationKeys = new Set(["status", "result"]);
const absentObservationKeys = new Set(["status", "operationId"]);
const createResultKeys = new Set(["operationId", "type", "targetId", "tempId"]);
const mutationResultKeys = new Set(["operationId", "type", "targetId"]);
const snapshotKeys = new Set(["revision", "remainingGeneratedIds", "variables"]);
const variableKeys = new Set([
  "id",
  "name",
  "resolvedType",
  "value",
  "referenceTo",
  "deprecated",
  "version",
]);

export const REMOTE_CONTRACT_LIMITS = Object.freeze({
  variables: 10_000,
  valueNodes: 100_000,
  valueDepth: 20,
  stringBytes: 4 * 1024 * 1024,
  snapshotBytes: 8 * 1024 * 1024,
});

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

function violation(reason, details = {}) {
  return { accepted: false, reason, ...details };
}

function boundedString(value, maximum) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function compareOrdinal(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function admitDataArray(value, owner, { maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (
    utilTypes.isProxy(value)
    || !Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximum
  ) {
    return violation("array_shape", { owner, limit: maximum });
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
    return violation("array_shape", { owner, limit: maximum });
  }
  return { accepted: true, value: keys.map(key => descriptors[key].value) };
}

function admitSnapshotJsonValue(value, state, path, depth = 0) {
  state.nodes += 1;
  if (state.nodes > REMOTE_CONTRACT_LIMITS.valueNodes) {
    return violation("snapshot_value_nodes", { path, limit: REMOTE_CONTRACT_LIMITS.valueNodes });
  }
  if (depth > REMOTE_CONTRACT_LIMITS.valueDepth) {
    return violation("snapshot_value_depth", { path, limit: REMOTE_CONTRACT_LIMITS.valueDepth });
  }
  if (value === null || typeof value === "boolean") return { accepted: true, value };
  if (typeof value === "number") {
    return Number.isFinite(value) && !Object.is(value, -0)
      ? { accepted: true, value }
      : violation("snapshot_value_number", { path });
  }
  if (typeof value === "string") {
    state.stringBytes += Buffer.byteLength(value, "utf8");
    return state.stringBytes <= REMOTE_CONTRACT_LIMITS.stringBytes
      ? { accepted: true, value }
      : violation("snapshot_value_string_bytes", {
          path,
          limit: REMOTE_CONTRACT_LIMITS.stringBytes,
        });
  }
  if (typeof value !== "object") return violation("snapshot_value_type", { path });
  if (utilTypes.isProxy(value)) return violation("snapshot_value_record", { path });
  if (state.active.has(value)) return violation("snapshot_value_cycle", { path });

  state.active.add(value);
  try {
    if (Array.isArray(value)) {
      const arrayAdmission = admitDataArray(value, path);
      if (!arrayAdmission.accepted) return violation("snapshot_value_array", { path });
      const admitted = [];
      for (const [index, child] of arrayAdmission.value.entries()) {
        const admission = admitSnapshotJsonValue(child, state, `${path}[${index}]`, depth + 1);
        if (!admission.accepted) return admission;
        admitted.push(admission.value);
      }
      return { accepted: true, value: admitted };
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return violation("snapshot_value_record", { path });
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== "string")) {
      return violation("snapshot_value_key", { path });
    }
    const admitted = {};
    for (const [keyIndex, key] of keys.sort(compareOrdinal).entries()) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !("value" in descriptor)) {
        return violation("snapshot_value_property", { path: `${path}.property[${keyIndex}]` });
      }
      state.stringBytes += Buffer.byteLength(key, "utf8");
      if (state.stringBytes > REMOTE_CONTRACT_LIMITS.stringBytes) {
        return violation("snapshot_value_string_bytes", {
          path,
          limit: REMOTE_CONTRACT_LIMITS.stringBytes,
        });
      }
      const admission = admitSnapshotJsonValue(
        descriptor.value,
        state,
        `${path}.value[${keyIndex}]`,
        depth + 1,
      );
      if (!admission.accepted) return admission;
      Object.defineProperty(admitted, key, {
        configurable: true,
        enumerable: true,
        value: admission.value,
        writable: true,
      });
    }
    return { accepted: true, value: admitted };
  } finally {
    state.active.delete(value);
  }
}

function admitExactKeys(record, admitted, owner) {
  const descriptors = Object.getOwnPropertyDescriptors(record);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (
    ownKeys.some(key => typeof key !== "string")
    || ownKeys.some(key => {
      const descriptor = descriptors[key];
      return !descriptor.enumerable || !("value" in descriptor);
    })
  ) {
    return violation("field_shape", { owner });
  }
  const observed = ownKeys.sort();
  const expected = [...admitted].sort();
  if (
    observed.length !== expected.length
    || observed.some((key, index) => key !== expected[index])
  ) {
    return violation("field_set", {
      owner,
      expectedFieldCount: expected.length,
      observedFieldCount: observed.length,
    });
  }
  return null;
}

function admitOperationResult(result, operation, index, batchTempIdToTargetId = new Map()) {
  if (!isRecord(result)) return violation("result_shape", { index });
  const admittedKeys = operation.type === "create_variable" ? createResultKeys : mutationResultKeys;
  const fieldSetViolation = admitExactKeys(result, admittedKeys, `results[${index}]`);
  if (fieldSetViolation) return fieldSetViolation;
  if (result.operationId !== operation.id) return violation("result_operation_id", { index });
  if (result.type !== operation.type) return violation("result_operation_type", { index });
  if (
    typeof result.targetId !== "string"
    || result.targetId.length < 1
    || result.targetId.length > 512
  ) {
    return violation("result_target_id", { index });
  }
  if (operation.type === "create_variable") {
    if (result.tempId !== operation.tempId) return violation("result_temporary_id", { index });
  } else if (result.targetId !== (batchTempIdToTargetId.get(operation.targetId) ?? operation.targetId)) {
    return violation("result_target_id", { index });
  }

  const admittedTargetId = batchTempIdToTargetId.get(operation.targetId) ?? result.targetId;

  return {
    accepted: true,
    value: operation.type === "create_variable"
      ? {
          operationId: operation.id,
          type: operation.type,
          targetId: result.targetId,
          tempId: operation.tempId,
        }
      : {
          operationId: operation.id,
          type: operation.type,
          targetId: admittedTargetId,
        },
  };
}

function admitCreatedTargetIdentity(operation, admittedResult, createdTargetIds, index) {
  if (operation.type !== "create_variable") return null;
  if (createdTargetIds.has(admittedResult.targetId)) {
    return violation("duplicate_created_target_id", { index });
  }
  createdTargetIds.add(admittedResult.targetId);
  return null;
}

function admitResultSet(results, operations) {
  const resultArray = admitDataArray(results, "results", { maximum: operations.length });
  if (!resultArray.accepted) return violation("result_set_shape");
  if (resultArray.value.length !== operations.length) {
    return violation("result_count", {
      expectedCount: operations.length,
      observedCount: resultArray.value.length,
    });
  }

  const operationById = new Map(operations.map((operation) => [operation.id, operation]));
  const rawById = new Map();
  const indexById = new Map();
  const createdTargetIds = new Set();
  for (const [index, result] of resultArray.value.entries()) {
    if (!isRecord(result)) {
      return violation("result_operation_id", { index });
    }
    const resultShape = admitExactKeys(
      result,
      Object.hasOwn(result, "tempId") ? createResultKeys : mutationResultKeys,
      `results[${index}]`,
    );
    if (resultShape) return resultShape;
    if (typeof result.operationId !== "string") return violation("result_operation_id", { index });
    const operation = operationById.get(result.operationId);
    if (!operation) return violation("unknown_operation_id", { index });
    if (rawById.has(result.operationId)) {
      return violation("duplicate_operation_id", { index });
    }
    const expectedKeys = operation.type === "create_variable" ? createResultKeys : mutationResultKeys;
    const exactShape = admitExactKeys(result, expectedKeys, `results[${index}]`);
    if (exactShape) return exactShape;
    rawById.set(operation.id, result);
    indexById.set(operation.id, index);
  }

  const admittedById = new Map();
  const batchTempIdToTargetId = new Map();
  for (const operation of operations.filter(item => item.type === "create_variable")) {
    const index = indexById.get(operation.id);
    const admission = admitOperationResult(rawById.get(operation.id), operation, index);
    if (!admission.accepted) return admission;
    const identityViolation = admitCreatedTargetIdentity(
      operation,
      admission.value,
      createdTargetIds,
      index,
    );
    if (identityViolation) return identityViolation;
    admittedById.set(operation.id, admission.value);
    batchTempIdToTargetId.set(operation.tempId, admission.value.targetId);
  }
  for (const operation of operations.filter(item => item.type !== "create_variable")) {
    const index = indexById.get(operation.id);
    const admission = admitOperationResult(
      rawById.get(operation.id),
      operation,
      index,
      batchTempIdToTargetId,
    );
    if (!admission.accepted) return admission;
    admittedById.set(operation.id, admission.value);
  }

  // Response order is transport detail; the planned operation order owns receipts.
  return {
    accepted: true,
    value: operations.map((operation) => admittedById.get(operation.id)),
  };
}

export function admitRemoteSnapshot(response) {
  if (!isRecord(response)) return violation("snapshot_shape");
  const fieldSetViolation = admitExactKeys(response, snapshotKeys, "snapshot");
  if (fieldSetViolation) return fieldSetViolation;
  if (!Number.isSafeInteger(response.revision) || response.revision < 0) {
    return violation("remote_revision");
  }
  if (
    !Number.isSafeInteger(response.remainingGeneratedIds)
    || response.remainingGeneratedIds < 0
  ) {
    return violation("remote_generated_id_capacity");
  }
  const variableArray = admitDataArray(response.variables, "snapshot.variables", {
    maximum: REMOTE_CONTRACT_LIMITS.variables,
  });
  if (!variableArray.accepted) {
    return violation("snapshot_variables", { limit: REMOTE_CONTRACT_LIMITS.variables });
  }

  const ids = new Set();
  const state = { active: new WeakSet(), nodes: 0, stringBytes: 0 };
  const variables = [];
  for (const [index, variable] of variableArray.value.entries()) {
    if (!isRecord(variable)) return violation("snapshot_variable_shape", { index });
    const variableFieldViolation = admitExactKeys(variable, variableKeys, `variables[${index}]`);
    if (variableFieldViolation) return variableFieldViolation;
    if (!boundedString(variable.id, 512) || ids.has(variable.id)) {
      return violation(ids.has(variable.id) ? "snapshot_variable_id_duplicate" : "snapshot_variable_id", {
        index,
      });
    }
    if (!boundedString(variable.name, 256)) {
      return violation("snapshot_variable_name", { index });
    }
    if (!boundedString(variable.resolvedType, 64)) {
      return violation("snapshot_variable_type", { index });
    }
    if (
      variable.referenceTo !== null
      && !boundedString(variable.referenceTo, 512)
    ) {
      return violation("snapshot_variable_reference", { index });
    }
    if (typeof variable.deprecated !== "boolean") {
      return violation("snapshot_variable_deprecated", { index });
    }
    if (!Number.isSafeInteger(variable.version) || variable.version < 1) {
      return violation("snapshot_variable_version", { index });
    }
    const valueAdmission = admitSnapshotJsonValue(
      variable.value,
      state,
      `variables[${index}].value`,
    );
    if (!valueAdmission.accepted) return valueAdmission;
    ids.add(variable.id);
    variables.push({
      id: variable.id,
      name: variable.name,
      resolvedType: variable.resolvedType,
      value: valueAdmission.value,
      referenceTo: variable.referenceTo,
      deprecated: variable.deprecated,
      version: variable.version,
    });
  }
  variables.sort((left, right) => compareOrdinal(left.id, right.id));
  const admitted = {
    revision: response.revision,
    remainingGeneratedIds: response.remainingGeneratedIds,
    variables,
  };
  const snapshotBytes = Buffer.byteLength(JSON.stringify(admitted), "utf8");
  if (snapshotBytes > REMOTE_CONTRACT_LIMITS.snapshotBytes) {
    return violation("snapshot_bytes", {
      observedBytes: snapshotBytes,
      limit: REMOTE_CONTRACT_LIMITS.snapshotBytes,
    });
  }
  return { accepted: true, value: admitted };
}

export function admitRemoteSettlement(response, operations) {
  if (!isRecord(response)) return violation("settlement_shape");
  const fieldSetViolation = admitExactKeys(response, settlementKeys, "settlement");
  if (fieldSetViolation) return fieldSetViolation;
  if (!settlementDispositions.has(response.disposition)) {
    return violation("settlement_disposition");
  }
  if (!Number.isSafeInteger(response.remoteRevision) || response.remoteRevision < 0) {
    return violation("remote_revision");
  }
  const resultSet = admitResultSet(response.results, operations);
  if (!resultSet.accepted) return resultSet;
  return {
    accepted: true,
    value: {
      disposition: response.disposition,
      remoteRevision: response.remoteRevision,
      results: resultSet.value,
    },
  };
}

export function admitRemoteIntentObservation(response, operations) {
  if (!isRecord(response)) return violation("observation_shape");
  const fieldSetViolation = admitExactKeys(response, observationKeys, "observation");
  if (fieldSetViolation) return fieldSetViolation;
  if (!Number.isSafeInteger(response.remoteRevision) || response.remoteRevision < 0) {
    return violation("remote_revision");
  }
  const observationArray = admitDataArray(response.results, "observation.results", {
    maximum: operations.length,
  });
  if (!observationArray.accepted) return violation("result_set_shape");
  if (observationArray.value.length !== operations.length) {
    return violation("result_count", {
      expectedCount: operations.length,
      observedCount: observationArray.value.length,
    });
  }

  const operationById = new Map(operations.map((operation) => [operation.id, operation]));
  const rawById = new Map();
  for (const [index, item] of observationArray.value.entries()) {
    if (!isRecord(item)) {
      return violation("result_status", { index });
    }
    const itemDescriptors = Object.getOwnPropertyDescriptors(item);
    const statusDescriptor = itemDescriptors.status;
    if (!statusDescriptor?.enumerable || !("value" in statusDescriptor)) {
      return violation("result_status", { index });
    }
    const status = statusDescriptor.value;
    if (status !== "applied" && status !== "absent") return violation("result_status", { index });
    const admittedKeys = status === "applied" ? appliedObservationKeys : absentObservationKeys;
    const itemFieldSetViolation = admitExactKeys(
      item,
      admittedKeys,
      `observation.results[${index}]`,
    );
    if (itemFieldSetViolation) return itemFieldSetViolation;
    if (status === "applied") {
      if (!isRecord(item.result)) return violation("result_shape", { index });
      const nestedShape = admitExactKeys(
        item.result,
        Object.hasOwn(item.result, "tempId") ? createResultKeys : mutationResultKeys,
        `observation.results[${index}].result`,
      );
      if (nestedShape) return nestedShape;
    }
    const operationId = status === "applied" ? item.result.operationId : item.operationId;
    if (typeof operationId !== "string") return violation("result_operation_id", { index });
    const operation = operationById.get(operationId);
    if (!operation) return violation("unknown_operation_id", { index });
    if (rawById.has(operationId)) return violation("duplicate_operation_id", { index });
    rawById.set(operationId, { index, item, operation, status });
  }

  const admittedById = new Map();
  const createdTargetIds = new Set();
  const batchTempIdToTargetId = new Map();
  for (const operation of operations.filter(item => item.type === "create_variable")) {
    const raw = rawById.get(operation.id);
    if (raw.status !== "applied") continue;
    const admission = admitOperationResult(raw.item.result, operation, raw.index);
    if (!admission.accepted) return admission;
    const identityViolation = admitCreatedTargetIdentity(
      operation,
      admission.value,
      createdTargetIds,
      raw.index,
    );
    if (identityViolation) return identityViolation;
    batchTempIdToTargetId.set(operation.tempId, admission.value.targetId);
    admittedById.set(operation.id, { status: "applied", result: admission.value });
  }
  for (const operation of operations) {
    if (admittedById.has(operation.id)) continue;
    const raw = rawById.get(operation.id);
    if (raw.status === "absent") {
      admittedById.set(operation.id, { status: "absent", operationId: operation.id });
      continue;
    }
    const admission = admitOperationResult(
      raw.item.result,
      operation,
      raw.index,
      batchTempIdToTargetId,
    );
    if (!admission.accepted) return admission;
    admittedById.set(operation.id, { status: "applied", result: admission.value });
  }

  return {
    accepted: true,
    value: {
      remoteRevision: response.remoteRevision,
      results: operations.map((operation) => admittedById.get(operation.id)),
    },
  };
}
