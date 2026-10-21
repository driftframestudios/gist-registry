import { LeaseError } from "./errors.mjs";

export class InMemoryLeaseStore {
  #lease = null;
  #generation = 0;

  acquire({ owner, nowMs, ttlMs }) {
    if (!owner || !Number.isSafeInteger(nowMs) || !Number.isSafeInteger(ttlMs) || ttlMs < 1) {
      throw new LeaseError("invalid_lease_request", "Lease acquisition needs owner, time, and positive ttl.");
    }
    if (this.#lease && this.#lease.expiresAtMs > nowMs) {
      throw new LeaseError("lease_held", "Another writer retains the active lease.", {
        holder: this.#lease.owner,
        expiresAtMs: this.#lease.expiresAtMs,
      });
    }
    this.#generation += 1;
    this.#lease = { owner, generation: this.#generation, expiresAtMs: nowMs + ttlMs };
    return structuredClone(this.#lease);
  }

  renew({ owner, generation, nowMs, ttlMs }) {
    if (
      !this.#lease ||
      this.#lease.owner !== owner ||
      this.#lease.generation !== generation ||
      this.#lease.expiresAtMs <= nowMs
    ) {
      throw new LeaseError("lease_lost", "The writer must reacquire a current lease.");
    }
    this.#lease.expiresAtMs = nowMs + ttlMs;
    return structuredClone(this.#lease);
  }

  release({ owner, generation }) {
    if (this.#lease?.owner === owner && this.#lease.generation === generation) {
      this.#lease = null;
      return true;
    }
    return false;
  }

  inspect() {
    return structuredClone(this.#lease);
  }
}

export class InMemoryCheckpointStore {
  #records = new Map();

  load(runId) {
    return this.#records.has(runId) ? structuredClone(this.#records.get(runId)) : null;
  }

  save(runId, checkpoint) {
    this.#records.set(runId, structuredClone(checkpoint));
    return this.load(runId);
  }
}
