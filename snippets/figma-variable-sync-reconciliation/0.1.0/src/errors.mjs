export class SyncError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = structuredClone(details);
  }
}

export class PlanError extends SyncError {}
export class LeaseError extends SyncError {}
export class RemoteConflictError extends SyncError {}

export class RetryAfterError extends SyncError {
  constructor(retryAfterMs, details = {}) {
    super("retry_after", `Remote asks the caller to retry after ${retryAfterMs} ms.`, {
      ...details,
      retryAfterMs,
    });
    this.retryAfterMs = retryAfterMs;
  }
}

export class OutcomeUnknownError extends SyncError {
  constructor(details = {}) {
    super(
      "outcome_unknown",
      "The remote outcome needs a read-and-reconcile observation.",
      details,
    );
  }
}

export class ExecutionInterruptedError extends SyncError {
  constructor(details = {}) {
    super(
      "execution_interrupted",
      "Execution stopped after remote acceptance and before the next durable checkpoint.",
      details,
    );
  }
}
