# Typed error recovery contracts

Use this skill to give callers a finite, safe, and actionable account of
failure. It connects admission, error classification, retained state,
diagnostic audience, interruption behavior, and the next bounded recovery
action.

## Fastest start

1. Read the [skill contract](SKILL.md).
2. Map the caller, input boundary, responsible operation, publication event,
   accepted prior state, and recovery owner.
3. Define the finite outcome families whose handling differs.
4. Place validation before derived work and translate errors around the
   operation that owns them.
5. From this skill directory, run `python3 exercises/exercise.py --check`; read
   the [exercise guide](exercises/README.md) for the synthetic fault cases.

Example request:

> Use `$typed-error-recovery-contracts` to design the failure contract for this
> review-and-publish operation. Preserve the last accepted snapshot, classify
> stale input separately from internal defects, and give each public outcome
> one bounded next action.

## Success example

A caller submits a reviewed label with an earlier source digest. Admission
returns a typed stale-source outcome with fixed public guidance, preserves the
accepted snapshot, and points to fresh review. An adapter failure and a
programming defect retain distinct internal classifications and diagnostics.

## Recovery example

An interruption arrives after an attempt is reserved and before its external
outcome is known. Cleanup preserves the interruption, the accepted prior result
stays available, and the attempt enters reconciliation. The caller receives the
state and recovery owner instead of an inferred success or automatic replay.

## Package map

- [Skill contract](SKILL.md): taxonomy, translation rules, interruption, and
  completion.
- [Python exception boundaries](references/python-exception-boundaries.md):
  Python, Pydantic, exception chaining, cancellation, and safe projection.
- [Exercise guide](exercises/README.md): runnable cases and expected outcomes.
- [`exercise.py`](exercises/exercise.py): synthetic operation and checks.
- [Offline review boundary](exercises/offline-review-boundary.md): original
  source-reading exercise and its narrower evidence standing.

## Maturity and transfer boundary

This package combines a research-informed contract with a runnable synthetic
operation. The exercise establishes its named types, retained-state behavior,
and recovery routes. A receiving framework, real dependency, mutation system,
retry policy, and incident process retain their own compatibility, authority,
and operational evidence.
