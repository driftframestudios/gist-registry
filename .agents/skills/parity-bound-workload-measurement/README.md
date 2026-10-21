# Parity-bound workload measurement

Use this skill to compare complete implementation cost after both candidates
produce the same admitted results, errors, recovery behavior, and caller-control
semantics for a declared workload.

## Fastest start

1. Read the [skill contract](SKILL.md).
2. Declare the receiving decision, independent result oracle, error invariants,
   workload variables, measured phases, environment, and stop rule.
3. Run the correctness gate in the [exercise guide](exercises/README.md).
4. Add optional local timing only when a measured result can change the choice.
5. Read [parity before workload comparison](references/design-and-evidence.md)
   when shifted work, sampling, complexity, or transfer affects interpretation.

## Success example

A repeated-scan baseline and a one-pass counter produce the same canonical
bytes for representative, empty, and invalid inputs. The comparison includes
parse, admission, counting, sorting, and serialization; alternates candidate
order; retains each completed trial; and reports a descriptive median and range
for the named warm process-local workload.

## Recovery example

A later attempt returns the wrong result or raises an ordinary operation error.
The receipt keeps the completed prefix and failed attempt, leaves the complete-
run summary absent, and exits through the owning diagnostic route. Caller
interruption preserves its original identity and transfers durable recovery to
the invoking task.

## Package map

- [Skill contract](SKILL.md): parity gates, operation boundaries, sampling, and
  bounded dispositions.
- [Exercise guide](exercises/README.md): correctness, optional measurement, and
  receipt semantics.
- [Standard-library exercise](exercises/exercise.py): baseline/candidate parity,
  controlled faults, and descriptive timing.
- [Design and evidence](references/design-and-evidence.md): measurement routes,
  source anchors, complexity, and transfer limits.

## Evidence maturity and transfer boundary

`exercised`: the authored fixture establishes exact outputs, selected error
families, incomplete-run accounting, and an optional warm local profile.
Production concurrency, cold-start cost, allocation peaks, I/O, query plans,
energy, field performance, statistical inference, and standing budgets require
their own workload and receiver observations.
