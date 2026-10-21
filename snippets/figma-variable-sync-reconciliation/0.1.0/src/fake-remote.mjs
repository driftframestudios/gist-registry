import {
  ExecutionInterruptedError,
  OutcomeUnknownError,
  RemoteConflictError,
  RetryAfterError,
} from "./errors.mjs";
import { compareOrdinal } from "./canonical.mjs";

function cloneVariable(variable) {
  return {
    id: variable.id,
    name: variable.name,
    resolvedType: variable.resolvedType,
    value: structuredClone(variable.value),
    referenceTo: variable.referenceTo ?? null,
    deprecated: Boolean(variable.deprecated),
    version: variable.version ?? 1,
  };
}

function resolveId(identifier, tempIds) {
  return tempIds.get(identifier) ?? identifier;
}

export class FakeVariableRemote {
  #variables = new Map();
  #intentResults = new Map();
  #revision = 0;
  #nextId = 1;
  #issuedIdPrefix = "var_";

  constructor({ variables = [], revision = 0, issuedIdPrefix = "var_" } = {}) {
    if (typeof issuedIdPrefix !== "string" || issuedIdPrefix.length < 1 || issuedIdPrefix.length > 512) {
      throw new TypeError("issuedIdPrefix needs a string between 1 and 512 characters.");
    }
    this.#issuedIdPrefix = issuedIdPrefix;
    for (const variable of variables) {
      this.#variables.set(variable.id, cloneVariable(variable));
      const numericSuffix = Number.parseInt(variable.id.match(/\d+$/u)?.[0] ?? "", 10);
      if (Number.isSafeInteger(numericSuffix)) {
        this.#nextId = Math.max(this.#nextId, numericSuffix + 1);
      }
    }
    this.#revision = revision;
  }

  snapshot() {
    return {
      revision: this.#revision,
      variables: [...this.#variables.values()]
        .map(cloneVariable)
        .sort((left, right) => compareOrdinal(left.id, right.id)),
    };
  }

  readIntentResults(operationIds) {
    return {
      remoteRevision: this.#revision,
      results: operationIds.map((operationId) =>
        this.#intentResults.has(operationId)
          ? { status: "applied", result: structuredClone(this.#intentResults.get(operationId)) }
          : { status: "absent", operationId },
      ),
    };
  }

  injectDrift(targetId, changes = {}) {
    const current = this.#variables.get(targetId);
    if (!current) {
      throw new RemoteConflictError("drift_target_missing", "The drift target is absent.", {
        targetId,
      });
    }
    this.#variables.set(targetId, {
      ...current,
      ...structuredClone(changes),
      id: targetId,
      version: current.version + 1,
    });
    this.#revision += 1;
    return this.snapshot();
  }

  applyBatch(operations, { expectedRevision, fault = null } = {}) {
    const priorResults = operations.map((operation) => this.#intentResults.get(operation.id));
    if (priorResults.every(Boolean)) {
      return {
        disposition: "idempotent_replay",
        remoteRevision: this.#revision,
        results: priorResults.map((result) => structuredClone(result)),
      };
    }
    if (priorResults.some(Boolean)) {
      throw new RemoteConflictError(
        "partial_prior_application",
        "The remote contains a partial intent set that needs reconciliation.",
        { operationIds: operations.map((operation) => operation.id) },
      );
    }

    if (fault?.kind === "retry_after") {
      throw new RetryAfterError(fault.retryAfterMs, { phase: "before_apply" });
    }
    if (fault?.kind === "timeout_before_apply") {
      throw new OutcomeUnknownError({ phase: "before_apply" });
    }
    if (fault?.kind === "concurrent_drift") {
      this.injectDrift(fault.targetId, fault.changes);
    }

    if (expectedRevision !== this.#revision) {
      throw new RemoteConflictError(
        "remote_revision_changed",
        "The remote revision differs from the prepared checkpoint.",
        { expectedRevision, observedRevision: this.#revision },
      );
    }

    const candidateVariables = new Map(
      [...this.#variables.entries()].map(([id, variable]) => [id, cloneVariable(variable)]),
    );
    const tempIds = new Map();
    const results = [];
    let nextId = this.#nextId;

    for (const operation of operations) {
      let result;
      if (operation.type === "create_variable") {
        const id = `${this.#issuedIdPrefix}${String(nextId).padStart(4, "0")}`;
        nextId += 1;
        if (candidateVariables.has(id)) {
          throw new RemoteConflictError("generated_id_collision", "Generated remote id is occupied.", {
            operationId: operation.id,
          });
        }
        const referenceTo = operation.payload?.referenceTo
          ? resolveId(operation.payload.referenceTo, tempIds)
          : null;
        if (referenceTo && !candidateVariables.has(referenceTo)) {
          throw new RemoteConflictError("reference_target_missing", "Create reference target is absent.", {
            operationId: operation.id,
            referenceTo,
          });
        }
        candidateVariables.set(id, {
          id,
          name: operation.payload?.name,
          resolvedType: operation.payload?.resolvedType,
          value: structuredClone(operation.payload?.value),
          referenceTo,
          deprecated: false,
          version: 1,
        });
        tempIds.set(operation.tempId, id);
        result = { operationId: operation.id, type: operation.type, targetId: id, tempId: operation.tempId };
      } else {
        const targetId = resolveId(operation.targetId, tempIds);
        const current = candidateVariables.get(targetId);
        if (!current) {
          throw new RemoteConflictError("target_missing", "The operation target is absent.", {
            operationId: operation.id,
            targetId,
          });
        }
        if (
          operation.expectedVersion !== undefined &&
          operation.expectedVersion !== current.version
        ) {
          throw new RemoteConflictError("target_version_changed", "The target version changed.", {
            operationId: operation.id,
            targetId,
            expectedVersion: operation.expectedVersion,
            observedVersion: current.version,
          });
        }

        if (operation.type === "delete_variable") {
          const referencingIds = [...candidateVariables.values()]
            .filter((variable) => variable.referenceTo === targetId)
            .map((variable) => variable.id)
            .sort();
          if (referencingIds.length > 0) {
            throw new RemoteConflictError(
              "target_still_referenced",
              "The delete target still supplies references to receiving variables.",
              { operationId: operation.id, targetId, referencingIds },
            );
          }
          candidateVariables.delete(targetId);
          result = { operationId: operation.id, type: operation.type, targetId };
        } else {
          const next = cloneVariable(current);
          if (operation.type === "update_variable") {
            if (operation.payload?.name !== undefined) {
              next.name = operation.payload.name;
            }
            if (operation.payload?.resolvedType !== undefined) {
              next.resolvedType = operation.payload.resolvedType;
            }
            if (Object.hasOwn(operation.payload ?? {}, "value")) {
              next.value = structuredClone(operation.payload.value);
            }
          } else if (operation.type === "rewire_reference") {
            const referenceTo = resolveId(operation.payload?.referenceTo, tempIds);
            if (!candidateVariables.has(referenceTo)) {
              throw new RemoteConflictError("reference_target_missing", "Rewire target is absent.", {
                operationId: operation.id,
                referenceTo,
              });
            }
            next.referenceTo = referenceTo;
          } else if (operation.type === "deprecate_variable") {
            next.deprecated = true;
          }
          next.id = targetId;
          next.version = current.version + 1;
          candidateVariables.set(targetId, next);
          result = { operationId: operation.id, type: operation.type, targetId };
        }
      }
      results.push(result);
    }

    this.#variables = candidateVariables;
    this.#nextId = nextId;
    this.#revision += 1;
    for (const result of results) {
      this.#intentResults.set(result.operationId, structuredClone(result));
    }

    if (fault?.kind === "response_lost") {
      throw new OutcomeUnknownError({ phase: "after_apply", operationIds: results.map((item) => item.operationId) });
    }
    if (fault?.kind === "interrupt_after_apply") {
      throw new ExecutionInterruptedError({
        phase: "after_apply_before_checkpoint",
        operationIds: results.map((item) => item.operationId),
      });
    }

    return { disposition: "applied", remoteRevision: this.#revision, results };
  }
}
