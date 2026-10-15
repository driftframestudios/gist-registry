---
name: parity-bound-workload-measurement
description: Compares complete behavior cost under a declared workload after semantic and recovery parity are established. Applies when an optimization may move computation, allocation, transport, query, or review work across boundaries.
---

# Parity-bound workload measurement

## Contract

- **What:** Compare complete behavior cost under a declared workload and select retain, adopt, combine, defer, reject-for-this-envelope, or indeterminate.
- **When:** A proposed optimization or runtime change may trade computation, transfer, storage, concurrency, recovery, or reviewer work.
- **Boundaries:** Controlled measurements describe the named profile. Field performance, production guarantees and energy/carbon claims require their own evidence. The receiving task governs runtime, data, budget and operational effects.
- **Result:** A reproducible baseline/candidate comparison with preserved invariants, complete resource accounting for the selected boundary, uncertainty and a reversible decision.

## Fit and attention

- **Useful when:** Faster local code may move work into serialization, transport, queries, retained memory, model calls or human review.
- **Poor fit when:** Static reasoning already establishes a deterministic source-size or asymptotic fact, or behavioral parity remains unresolved.
- **Smallest useful dose:** One baseline and candidate, an independent parity gate, a representative workload and the cost phase that can change the decision.
- **Foregrounds:** Equivalent work, transferred costs, complete attempts and uncertainty.
- **May under-attend:** Production interference, rare tails and organizational workload outside the selected envelope; name those limits and select a separate observation when consequential.
- **Interactions:** [Controlled context comparison](https://kindlight.io/skills/controlled-context-comparison/) can establish the comparison contract. Architecture convergence receives the measured tradeoff; this skill owns the bounded cost observation.

## Inputs, defaults and output

Bring source identities for both variants; the receiving decision; independent
expected results and error/recovery invariants; workload shape and scale;
runtime/dependency/platform identities; observation method; execution authority,
resource budget and stopping rule. Include input/output bytes, distinct keys,
depth, fan-in, mutation rate, concurrency and cold/warm state where they change
cost.

When parity, workload or authority is unresolved, return a source analysis and
the smallest missing observation before timing. Prefer descriptive observations
for a small sample. Use the repository's existing runner when it covers the
question; a standing benchmark framework earns maintenance through repeated
use or a consequential boundary.

Return all trials and failures, the measurement envelope, parity evidence,
summary appropriate to the sample, unmeasured costs and a reversible disposition.
Raw environment details stay in the task's approved evidence location.

## Rules

### Rule: Semantic and recovery parity precede timing

Preserve task meaning, result semantics, errors, caller control, retained state,
privacy and accessible interaction. Use an independent result oracle and
representative boundary cases before measuring. A fast candidate that changes
those invariants returns to design; correctness gates remain deterministic
while timing observations retain their variability.

### Rule: The operation boundary includes shifted work

Choose prepare, parse, validate, transform, clone, serialize, query, commit,
queue, transport/inference, render, export and review phases only where each
can change the decision. Report excluded phases explicitly. A cache trades
computation for retained state, invalidation and copies; streaming may still
retain a full input or emitted output. Measure or bound the actual owner.

### Rule: Complexity names the workload variables

Distinguish records n, groups g, bytes b, depth d and emitted results k where
relevant. Name worst-case work, retained space and cumulative allocations
separately. A one-pass count may change O(n·g) to O(n), while parsing, key
sorting and serialization remain in the end-to-end expression. Allocation
counts, live heap and peak resident memory describe different costs.

### Rule: Trials preserve order, identity and failures

Retain every attempt, runtime identity, variant order, warmup and cold/warm
state. Interleave variants when it controls drift; serialize timing jobs sharing
one host. Treat failed durations as failed attempts, outside complete-run
summaries. An early stop keeps its reason and the observed prefix.

### Rule: Sampling determines the strength of the summary

For a small descriptive set, report sample size, all initial values, median,
range and failures. Tail percentiles and inferential claims require enough
observations and a declared method. Clock resolution differs from accuracy.
Choose a larger or configured campaign when concurrency, I/O, tail behavior
or a production budget is the receiving question.

### Rule: Interruption and checkpoint reuse retain their meaning

State cancellation, deadlines, partial completion and persistence behavior.
Reuse a checkpoint only when its source, input, environment, observer and
required artifacts match the current claim. Caller control propagates through
the owned boundary; the invoking task retains any durable recovery duty that
the measurement tool lacks. An incomplete receipt stays incomplete after restart
until the declared protocol establishes completion.

### Rule: Adoption follows a bounded consequence

Compare three to five plausible mechanisms when the architectural decision
warrants alternatives. A forecast about when to test remains advisory unless
calibrated for this task. Establish a standing performance budget only after
repeatability, consequence, owner, tolerance and re-entry conditions are
observed. Preserve a rollback coordinate and distinguish local speedup from
end-to-end benefit.

## Operating sequence

1. **Frame:** Name the receiving decision, plausible mechanisms, source coordinates and authorized budget.
2. **Bind:** Declare invariants, workload ladder, environment, phases, observation method and stop rule.
3. **Gate:** Establish result and failure parity before expensive measurement.
4. **Observe:** Run the smallest useful comparison, preserving warmups, ordering, complete attempts and interruption state.
5. **Interpret:** Compare total selected cost, uncertainty and shifted ownership; identify costs that remain unmeasured.
6. **Decide:** Return retain, adopt, combine, defer, reject-for-this-envelope or indeterminate with the fitting evidence and recovery coordinate.

## Scenarios

### Scenario: A cache shifts the cost

- Given repeated transformations become faster under caching,
- When copies, serialization and retained memory grow,
- Then the receiver compares end-to-end latency and memory for the same workload and retains a local-only speedup claim until broader benefit is observed.

### Scenario: A later trial fails

- Given several completed attempts and a later operation failure,
- When the run stops,
- Then the receipt preserves the completed prefix and failed attempt, leaves its complete-run summary absent, and names the retry or diagnostic owner.

The linked executable demonstrates these measurement decisions through authored
counting and failure controls. Its optional timing measures a process-local warm
profile; durable interruption checkpoints require a separate implementation.

## Conditional context

Read [design and evidence](references/design-and-evidence.md) when selecting
source reasoning, inner-loop timing, complete-operation timing or a configured
campaign, or when interpreting complexity and transfer. Use the
[exercise guide](exercises/README.md) and [bounded exercise](exercises/exercise.py)
for literal-result parity, incomplete-run accounting and optional descriptive
timing. Load a receiving SQL plan or runtime profile only for its named workload.

## Recovery and re-entry

A parity failure returns the candidate and independent counterexample to its
behavior owner. An unstable timing result returns an indeterminate disposition
and the variation that needs control. Preserve completed attempts before a
retry and verify checkpoint identities. Reopen after a material workload,
implementation, dependency, platform, observer or receiving-use change.

## Completion

Complete when the evidence supports a bounded choice or names the specific
observation needed to resolve an indeterminate result. Return attention to the
implementation or decision owner; another timing pass earns its place through
a changed question or unresolved material uncertainty.
