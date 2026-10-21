# Architecture convergence vantages

Use this skill to turn several plausible technical approaches into one bounded
architecture decision whose guarantees, costs, checks, and recovery route are
clear enough for implementation and review.

## Fastest start

1. Read the [skill contract](SKILL.md).
2. Name the behavior that matters and the consequence of choosing poorly.
3. Compare two genuinely distinct vantages against the same requirements.
4. Select the smallest mechanism that creates the desired guarantee and pair
   it with one distinguishing observation.
5. Open [filesystem state transitions](references/filesystem-state-transitions.md)
   when path freshness, rename, replacement, coordination, or restoration
   affects the decision.

## Success example

A proposed boolean cache removes a repeated filesystem query. A state vantage
shows that the cached value carries an older path observation, while a workload
vantage bounds the saved lookup cost. The synthesis keeps current-state checks
next to the mutation, treats the cache as an optional measured optimization,
and assigns a fault-injection check to the selected promotion and restoration
protocol.

## Recovery example

A promotion probe contradicts the selected guarantee. The team keeps the last
verified source and accepted generation, returns to the affected guarantee row,
and revises either the mechanism or its acceptance check. The viable alternative
stays attached to the exact operating condition that would activate it.

## Package map

- [Skill contract](SKILL.md): fit, vantage selection, convergence rules, and
  completion criteria.
- [Filesystem state transitions](references/filesystem-state-transitions.md):
  operating models, platform primitives, failure ordering, and focused checks
  for filesystem-backed publication.

## Evidence maturity and transfer boundary

This is a source- and behavior-oriented decision contract. Runnable code and
focused tests establish only the actors, states, platforms, and failures they
exercise; official documentation supplies its named platform contracts. Product
priority, policy, mutation authority, and release acceptance transfer to their
existing owners with the selected guarantee map and its open premises.
