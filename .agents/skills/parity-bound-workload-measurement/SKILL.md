---
name: parity-bound-workload-measurement
description: Compares complete behavior cost under a declared workload after semantic and recovery parity are established. Applies when an optimization may move computation, allocation, transport, query, or review work across boundaries.
---

# Parity-bound workload measurement

## Contract

**What:** Compare complete behavior cost under a declared workload and select retain, adopt, combine, defer, reject-for-this-envelope, or indeterminate.

**When:** A proposed optimization or runtime change may trade computation, transfer, storage, concurrency, recovery, or reviewer work.

**Boundaries:** Controlled measurements describe the named profile. Field experience, production guarantees, and energy/carbon claims require their own evidence.

**Result:** A reproducible baseline/candidate comparison with preserved invariants, resource accounting, uncertainty, and a reversible decision.

## Fit and attention

Useful when faster local code may move work into serialization, transport, database queries, model calls, or user review. Static reasoning suffices for a deterministic source-size fact. A benchmark framework earns adoption only when repeated use or a consequential boundary warrants it.

## Rules

- Name records, bytes, shape, depth, fan-in, output size, mutation rate, concurrency, and cold/warm state as relevant.
- Preserve task, result semantics, error/recovery behavior, privacy, and accessible interaction when comparing mechanisms.
- Attribute prepare, parse, validate, transform, clone, serialize, query, commit, queue, transport/inference, render, export, and review phases only where each changes the decision.
- Keep correctness gates separate from variable timing observations.
- Retain every trial and environment identity; interleave variants where appropriate and serialize timing jobs on one host.
- Report all initial observations, median, range, failures, and sample size. Tail percentiles and inferential claims require adequate sampling and an explicit method.
- Name complexity variables and cumulative allocations. Memoization and streaming claims require examination of retained and emitted state.
- Cancellation, deadlines, partial completion, and checkpoint reuse have explicit contracts. Reuse binds source, environment, input, observer, and required artifacts.
- A forecast about when to test is advisory unless independently calibrated for this receiving task. Consequential correctness and security boundaries retain their focused checks.
- Promote a standing performance budget only after repeatability, consequence, owner, tolerance, and re-entry conditions are demonstrated.

## Operating sequence

1. Name the receiving decision and plausible mechanisms.
2. Bind invariants, workload ladder, environment, measurement phases, and stop rule.
3. Establish correctness and source identities before expensive measurements.
4. Run the smallest useful baseline/candidate set with checkpointed completion.
5. Compare total cost and uncertainty; record retained behavior and limits.
6. Pass the selected mechanism to architecture convergence or rest with an explicit disposition.

## Boundary scenario

Given a cache reduces repeated transformation time, when copy/serialization cost and retained memory increase, then the decision compares end-to-end latency and memory under the same workload. A local speedup alone remains a local observation.

## Completion and re-entry

Complete when evidence supports a bounded choice or an explicit indeterminate result. Reopen after a material workload, implementation, dependency, platform, observer, or receiving-use change.

## Conditional context

Read [design and evidence](references/design-and-evidence.md) when selecting controls, interpreting a near miss, or transferring the result. Run the [bounded exercise](exercises/exercise.py) for a synthetic example; the [exercise guide](exercises/README.md) names its observable result and evidence boundary.
