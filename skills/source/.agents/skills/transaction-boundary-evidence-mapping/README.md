# Transaction boundary evidence mapping

Use this skill to map a multi-effect operation into explicit preparation,
commit, publication, acknowledgement, and recovery states. It helps reviewers
distinguish atomicity, idempotency, durability, rollback, and reconciliation
claims before an implementation or test suite treats them as one guarantee.

## Fastest start

1. Read the [skill contract](SKILL.md).
2. Name each effect, its authority, irreversible boundary, and accepted prior
   state.
3. Build a state table for preparation, candidate, commit, publication,
   acknowledgement, and uncertain outcome.
4. Select one distinguishing failure for every guarantee the design claims.
5. Open [failure intervals and evidence](references/failure-intervals-and-evidence.md)
   for retry, rollback, reconciliation, and test patterns.

Example request:

> Use `$transaction-boundary-evidence-mapping` to map this database write,
> object publication, and notification flow. Identify the commit point,
> uncertain outcomes, idempotency key, and the smallest fault set that proves
> recovery.

## Success example

An operation writes an immutable object, commits a database pointer, then sends
a notification. The map names the database commit as acceptance, treats the
notification as a later effect, and assigns reconciliation to response loss
after commit. Focused faults before and after each boundary establish retained
state and the next safe action.

## Recovery example

The caller loses the response after the accepted pointer changes. The operation
uses its stable attempt identity to observe the accepted coordinate, returns an
already-applied outcome, and leaves the prior and current immutable objects
inspectable. The uncertain attempt routes to reconciliation rather than an
unbounded replay.

## Package map

- [Skill contract](SKILL.md): effect model, rules, operating sequence, and
  completion criteria.
- [Failure intervals and evidence](references/failure-intervals-and-evidence.md):
  state maps, fault placement, idempotency, rollback, and reconciliation.

## Maturity and transfer boundary

This package is an architecture and evidence-mapping contract. The receiving
implementation and its fault tests establish actual atomicity, durability,
concurrency, and recovery behavior. Mutation authority, retry budgets,
operational reconciliation, and release acceptance remain with their named
systems and owners.
