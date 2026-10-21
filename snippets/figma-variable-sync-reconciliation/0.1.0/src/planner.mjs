import { types as utilTypes } from "node:util";

import { digest } from "./canonical.mjs";
import { PlanError } from "./errors.mjs";

const operationTypes = new Set([
  "create_variable",
  "update_variable",
  "rewire_reference",
  "deprecate_variable",
  "delete_variable",
]);
const reservedKeys = new Set(["__proto__", "constructor", "prototype"]);
const operationKeys = new Set([
  "id",
  "type",
  "dependsOn",
  "tempId",
  "targetId",
  "expectedVersion",
  "payload",
]);
const payloadKeysByType = new Map([
  ["create_variable", new Set(["name", "resolvedType", "value", "referenceTo"])],
  ["update_variable", new Set(["name", "value"])],
  ["rewire_reference", new Set(["referenceTo"])],
  ["deprecate_variable", new Set()],
  ["delete_variable", new Set()],
]);

export const PLANNER_RESOURCE_LIMITS = Object.freeze({
  operations: 10_000,
  dependenciesPerOperation: 128,
  valueNodes: 10_000,
  valueDepth: 20,
  valueStringBytes: 64 * 1024,
  operationBytes: 256 * 1024,
  planBytes: 4 * 1024 * 1024,
  batchBytes: 256 * 1024,
});

function validateBoundedString(value, field, { min = 1, max = 256 } = {}) {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    throw new PlanError(
      "invalid_string",
      `${field} needs a string between ${min} and ${max} characters.`,
      { field },
    );
  }
}

function isPlainRecord(value) {
  if (
    value === null
    || typeof value !== "object"
    || utilTypes.isProxy(value)
    || Array.isArray(value)
  ) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateDataRecord(value, field, code, message) {
  if (!isPlainRecord(value)) {
    throw new PlanError(code, message, { field });
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key];
    if (
      typeof key !== "string"
      || !descriptor.enumerable
      || !("value" in descriptor)
    ) {
      throw new PlanError(code, message, { field });
    }
  }
}

function dataArrayValues(value, field, code = "non_json_value", message = `${field} requires a dense JSON array.`) {
  if (
    utilTypes.isProxy(value)
    || !Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype
  ) {
    throw new PlanError(code, message, { field });
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
    throw new PlanError(code, message, { field });
  }
  return keys.map(key => descriptors[key].value);
}

function validateJsonValue(value, field) {
  let nodes = 0;
  let stringBytes = 0;
  const active = new WeakSet();
  const countString = (candidate) => {
    const bytes = Buffer.byteLength(candidate, "utf8");
    if (bytes > PLANNER_RESOURCE_LIMITS.valueStringBytes) {
      throw new PlanError(
        "value_string_limit_exceeded",
        `${field} contains a string beyond the admitted byte envelope.`,
        { field, observedBytes: bytes, limitBytes: PLANNER_RESOURCE_LIMITS.valueStringBytes },
      );
    }
    stringBytes += bytes;
    if (stringBytes > PLANNER_RESOURCE_LIMITS.operationBytes) {
      throw new PlanError(
        "value_string_limit_exceeded",
        `${field} contains aggregate string bytes beyond the admitted operation envelope.`,
        { field, observedBytes: stringBytes, limitBytes: PLANNER_RESOURCE_LIMITS.operationBytes },
      );
    }
  };
  const visit = (child, depth) => {
    nodes += 1;
    if (
      nodes > PLANNER_RESOURCE_LIMITS.valueNodes ||
      depth > PLANNER_RESOURCE_LIMITS.valueDepth
    ) {
      throw new PlanError("value_limit_exceeded", `${field} exceeds the JSON shape limit.`, {
        field,
      });
    }
    if (typeof child === "string") {
      countString(child);
      return;
    }
    if (child === null || typeof child === "boolean") {
      return;
    }
    if (typeof child === "number") {
      if (!Number.isFinite(child) || Object.is(child, -0)) {
        throw new PlanError("invalid_number", `${field} contains a number without an unambiguous JSON encoding.`, { field });
      }
      return;
    }
    if (Array.isArray(child)) {
      const values = dataArrayValues(
        child,
        field,
        "non_json_value",
        `${field} contains an array outside the admitted dense data shape.`,
      );
      if (active.has(child)) {
        throw new PlanError("non_json_value", `${field} contains a cyclic value.`, { field });
      }
      active.add(child);
      try {
        values.forEach((item) => visit(item, depth + 1));
      } finally {
        active.delete(child);
      }
      return;
    }
    if (child && typeof child === "object") {
      validateDataRecord(
        child,
        field,
        "non_json_value",
        `${field} contains an object outside the admitted JSON record shape.`,
      );
      if (active.has(child)) {
        throw new PlanError("non_json_value", `${field} contains a cyclic value.`, { field });
      }
      active.add(child);
      try {
        for (const [key, item] of Object.entries(child)) {
          if (reservedKeys.has(key)) {
            throw new PlanError("reserved_key", `${field} contains a reserved key.`, { field, key });
          }
          countString(key);
          visit(item, depth + 1);
        }
      } finally {
        active.delete(child);
      }
      return;
    }
    throw new PlanError("non_json_value", `${field} contains a value outside the admitted JSON shape.`, {
      field,
    });
  };
  visit(value, 0);
}

function validateOperation(operation) {
  validateDataRecord(
    operation,
    "operation",
    "invalid_operation",
    "Each operation must be a plain data object.",
  );
  for (const key of Object.keys(operation)) {
    if (!operationKeys.has(key) || reservedKeys.has(key)) {
      throw new PlanError(
        "operation_field_outside_contract",
        "An operation contains a field outside the typed operation contract.",
        { field: key },
      );
    }
  }
  validateBoundedString(operation.id, "operation.id", { max: 128 });
  if (!operationTypes.has(operation.type)) {
    throw new PlanError(
      "operation_type_outside_contract",
      `Operation ${operation.id} has a type outside the admitted contract.`,
      { operationId: operation.id, operationType: operation.type },
    );
  }
  const dependencies = Object.hasOwn(operation, "dependsOn")
    ? dataArrayValues(
        operation.dependsOn,
        `operation.${operation.id}.dependsOn`,
        "invalid_dependencies",
        `Operation ${operation.id} needs a dense string dependency list.`,
      )
    : [];
  if (dependencies.some((item) => typeof item !== "string")) {
    throw new PlanError(
      "invalid_dependencies",
      `Operation ${operation.id} needs a string dependency list.`,
      { operationId: operation.id },
    );
  }
  if (dependencies.length > PLANNER_RESOURCE_LIMITS.dependenciesPerOperation) {
    throw new PlanError("dependency_limit_exceeded", `Operation ${operation.id} has too many dependencies.`, {
      operationId: operation.id,
    });
  }
  if (new Set(dependencies).size !== dependencies.length) {
    throw new PlanError(
      "duplicate_dependency",
      `Operation ${operation.id} repeats a dependency.`,
      { operationId: operation.id },
    );
  }
  dependencies.forEach((dependency) =>
    validateBoundedString(dependency, `operation.${operation.id}.dependsOn`, { max: 128 }),
  );
  const hasTempId = Object.hasOwn(operation, "tempId");
  if (operation.type === "create_variable" && !hasTempId) {
    throw new PlanError(
      "missing_temp_id",
      `Create operation ${operation.id} needs a temporary id.`,
      { operationId: operation.id },
    );
  }
  if (operation.type !== "create_variable" && hasTempId) {
    throw new PlanError(
      "operation_field_outside_contract",
      `Operation ${operation.id} carries a temporary id outside the create contract.`,
      { operationId: operation.id, field: "tempId" },
    );
  }
  if (hasTempId) {
    validateBoundedString(operation.tempId, `operation.${operation.id}.tempId`, { max: 128 });
  }
  const hasTargetId = Object.hasOwn(operation, "targetId");
  if (operation.type !== "create_variable" && !hasTargetId) {
    throw new PlanError(
      "missing_target_id",
      `Operation ${operation.id} needs a target id.`,
      { operationId: operation.id },
    );
  }
  if (operation.type === "create_variable" && hasTargetId) {
    throw new PlanError(
      "operation_field_outside_contract",
      `Create operation ${operation.id} carries a target id outside its contract.`,
      { operationId: operation.id, field: "targetId" },
    );
  }
  if (hasTargetId) {
    validateBoundedString(operation.targetId, `operation.${operation.id}.targetId`, { max: 128 });
  }
  const hasExpectedVersion = Object.hasOwn(operation, "expectedVersion");
  if (
    hasExpectedVersion &&
    (!Number.isSafeInteger(operation.expectedVersion) || operation.expectedVersion < 1)
  ) {
    throw new PlanError("invalid_expected_version", `Operation ${operation.id} has an invalid expected version.`, {
      operationId: operation.id,
    });
  }
  if (operation.type === "create_variable" && hasExpectedVersion) {
    throw new PlanError(
      "operation_field_outside_contract",
      `Create operation ${operation.id} carries an expected version outside its contract.`,
      { operationId: operation.id, field: "expectedVersion" },
    );
  }

  const payload = Object.hasOwn(operation, "payload") ? operation.payload : {};
  validateDataRecord(
    payload,
    `operation.${operation.id}.payload`,
    "invalid_payload",
    `Operation ${operation.id} needs a plain data-object payload.`,
  );
  const admittedKeys = payloadKeysByType.get(operation.type);
  for (const key of Object.keys(payload)) {
    if (!admittedKeys.has(key) || reservedKeys.has(key)) {
      throw new PlanError(
        "payload_field_outside_contract",
        `Operation ${operation.id} has a field outside its typed payload contract.`,
        { operationId: operation.id, field: key },
      );
    }
  }
  if (Object.hasOwn(payload, "name")) {
    validateBoundedString(payload.name, `operation.${operation.id}.payload.name`, { max: 256 });
  }
  if (Object.hasOwn(payload, "resolvedType")) {
    validateBoundedString(payload.resolvedType, `operation.${operation.id}.payload.resolvedType`, { max: 64 });
  }
  if (Object.hasOwn(payload, "referenceTo")) {
    validateBoundedString(payload.referenceTo, `operation.${operation.id}.payload.referenceTo`, { max: 128 });
  }
  if (Object.hasOwn(payload, "value")) {
    validateJsonValue(payload.value, `operation.${operation.id}.payload.value`);
  }
  if (
    operation.type === "create_variable" &&
    (!Object.hasOwn(payload, "name") || !Object.hasOwn(payload, "resolvedType") || !Object.hasOwn(payload, "value"))
  ) {
    throw new PlanError(
      "incomplete_create_payload",
      `Create operation ${operation.id} needs name, resolvedType, and value.`,
      { operationId: operation.id },
    );
  }
  if (operation.type === "rewire_reference" && !Object.hasOwn(payload, "referenceTo")) {
    throw new PlanError(
      "missing_reference_target",
      `Rewire operation ${operation.id} needs a reference target.`,
      { operationId: operation.id },
    );
  }
}

function requireTemporaryReferenceDependencies(operations, createTempIds) {
  for (const operation of operations) {
    const references = [
      ["targetId", operation.targetId],
      ["payload.referenceTo", operation.payload?.referenceTo],
    ];
    for (const [field, coordinate] of references) {
      const creatorOperationId = createTempIds.get(coordinate);
      if (creatorOperationId && !(operation.dependsOn ?? []).includes(creatorOperationId)) {
        throw new PlanError(
          "temporary_reference_dependency_required",
          `Operation ${operation.id} needs a direct dependency on ${creatorOperationId} for ${field}.`,
          { operationId: operation.id, creatorOperationId, field },
        );
      }
    }
  }
}

export function orderOperations(operations) {
  if (utilTypes.isProxy(operations) || !Array.isArray(operations)) {
    throw new PlanError(
      "invalid_operation_list",
      "The synchronization plan requires a dense data array of operations.",
    );
  }
  if (operations.length === 0) {
    throw new PlanError("empty_plan", "A synchronization plan needs at least one operation.");
  }
  const operationValues = dataArrayValues(
    operations,
    "operations",
    "invalid_operation_list",
    "The synchronization plan requires a dense data array of operations.",
  );
  if (operationValues.length > PLANNER_RESOURCE_LIMITS.operations) {
    throw new PlanError(
      "operation_limit_exceeded",
      `The plan exceeds the ${PLANNER_RESOURCE_LIMITS.operations}-operation limit.`,
    );
  }

  const byId = new Map();
  const createTempIds = new Map();
  let planBytes = 2;
  for (const operation of operationValues) {
    validateOperation(operation);
    const operationBytes = encodedOperationBytes(operation);
    if (operationBytes > PLANNER_RESOURCE_LIMITS.operationBytes) {
      throw new PlanError(
        "operation_size_limit_exceeded",
        `Operation ${operation.id} exceeds the admitted operation byte envelope.`,
        {
          operationId: operation.id,
          observedBytes: operationBytes,
          limitBytes: PLANNER_RESOURCE_LIMITS.operationBytes,
        },
      );
    }
    planBytes += operationBytes + (byId.size === 0 ? 0 : 1);
    if (planBytes > PLANNER_RESOURCE_LIMITS.planBytes) {
      throw new PlanError(
        "plan_size_limit_exceeded",
        "The operation plan exceeds the admitted aggregate byte envelope.",
        { observedBytes: planBytes, limitBytes: PLANNER_RESOURCE_LIMITS.planBytes },
      );
    }
    if (byId.has(operation.id)) {
      throw new PlanError("duplicate_operation", `Operation id ${operation.id} is repeated.`, {
        operationId: operation.id,
      });
    }
    byId.set(operation.id, structuredClone(operation));
    if (operation.tempId) {
      if (createTempIds.has(operation.tempId)) {
        throw new PlanError(
          "duplicate_temp_id",
          `Temporary id ${operation.tempId} belongs to more than one create operation.`,
          { operationIds: [createTempIds.get(operation.tempId), operation.id] },
        );
      }
      createTempIds.set(operation.tempId, operation.id);
    }
  }

  // A declared temporary coordinate carries one explicit creator edge, so
  // topological order remains authoritative when input order or batching changes.
  requireTemporaryReferenceDependencies(byId.values(), createTempIds);

  const indegree = new Map([...byId.keys()].map((id) => [id, 0]));
  const dependents = new Map([...byId.keys()].map((id) => [id, []]));

  for (const operation of byId.values()) {
    for (const dependency of operation.dependsOn ?? []) {
      if (!byId.has(dependency)) {
        throw new PlanError(
          "dependency_unresolved",
          `Operation ${operation.id} names unresolved dependency ${dependency}.`,
          { operationId: operation.id, dependency },
        );
      }
      indegree.set(operation.id, indegree.get(operation.id) + 1);
      dependents.get(dependency).push(operation.id);
    }
  }

  const ready = [...byId.keys()].filter((id) => indegree.get(id) === 0);
  let readyIndex = 0;
  const ordered = [];
  while (readyIndex < ready.length) {
    const id = ready[readyIndex];
    readyIndex += 1;
    ordered.push(byId.get(id));
    for (const dependent of dependents.get(id)) {
      indegree.set(dependent, indegree.get(dependent) - 1);
      if (indegree.get(dependent) === 0) {
        ready.push(dependent);
      }
    }
  }

  if (ordered.length !== operationValues.length) {
    const cycleMembers = [...indegree.entries()]
      .filter(([, count]) => count > 0)
      .map(([id]) => id)
      .sort();
    throw new PlanError("dependency_cycle", "The operation dependency graph contains a cycle.", {
      operationIds: cycleMembers,
    });
  }
  return ordered;
}

function encodedOperationBytes(operation) {
  return Buffer.byteLength(JSON.stringify(operation), "utf8");
}

export function encodedBatchBytes(operations) {
  return Buffer.byteLength(JSON.stringify(operations), "utf8");
}

export function planOperations(operations, { maxBatchBytes = 4096 } = {}) {
  if (
    !Number.isSafeInteger(maxBatchBytes) ||
    maxBatchBytes < 1 ||
    maxBatchBytes > PLANNER_RESOURCE_LIMITS.batchBytes
  ) {
    throw new PlanError(
      "invalid_batch_limit",
      `maxBatchBytes must be a safe integer from 1 through ${PLANNER_RESOURCE_LIMITS.batchBytes}.`,
      { observed: maxBatchBytes, maximum: PLANNER_RESOURCE_LIMITS.batchBytes },
    );
  }
  const ordered = orderOperations(operations);
  const batches = [];
  let current = [];
  let currentBytes = 2;

  for (const operation of ordered) {
    const operationBytes = encodedOperationBytes(operation);
    if (operationBytes + 2 > maxBatchBytes) {
      throw new PlanError(
        "operation_exceeds_batch_limit",
        `Operation ${operation.id} exceeds the declared batch envelope.`,
        { operationId: operation.id, operationBytes, maxBatchBytes },
      );
    }
    const separatorBytes = current.length === 0 ? 0 : 1;
    if (current.length > 0 && currentBytes + separatorBytes + operationBytes > maxBatchBytes) {
      batches.push(current);
      current = [];
      currentBytes = 2;
    }
    current.push(operation);
    currentBytes += (current.length === 1 ? 0 : 1) + operationBytes;
  }
  if (current.length > 0) {
    batches.push(current);
  }

  return {
    planDigest: digest({ maxBatchBytes, ordered }),
    maxBatchBytes,
    operationCount: ordered.length,
    edgeCount: ordered.reduce((sum, operation) => sum + (operation.dependsOn?.length ?? 0), 0),
    batches: batches.map((batch, index) => ({
      index,
      operationIds: batch.map((operation) => operation.id),
      encodedBytes: encodedBatchBytes(batch),
      operations: batch,
    })),
  };
}
