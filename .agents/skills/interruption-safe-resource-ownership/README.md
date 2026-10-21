# Interruption-safe resource ownership

Use this skill to make acquisition, transfer, release, and failure precedence
explicit so resources return to a known owner during success, error, timeout,
or caller interruption.

## Fastest start

1. Read the [skill contract](SKILL.md).
2. Draw the ownership states from acquisition through transfer and release.
3. Run the [synthetic ownership exercise](exercises/README.md).
4. Add the receiving runtime's cancellation and cleanup observations.
5. Read [mechanisms and evidence](references/mechanisms-and-evidence.md) when
   descriptors, streams, transactions, subprocesses, or async scopes enter the
   boundary.

## Success example

A caller interrupts a streaming operation after the descriptor opens. The
operation propagates caller control, closes the descriptor exactly once, and
records the final ownership state. A separate transfer case moves release duty
to the receiver and keeps the original owner from closing the transferred
resource.

## Recovery example

The primary operation and cleanup both fail. The public result keeps the
primary failure as the initiating event, retains the cleanup failure and owned
resource coordinate, and routes reconciliation to the layer that can complete
release. A retry begins from the recorded ownership state.

## Package map

- [Skill contract](SKILL.md): lifecycle states, caller control, failure
  precedence, and re-entry.
- [Exercise guide](exercises/README.md): local execution and expected cases.
- [Synthetic exercise](exercises/exercise.py): interruption, transfer, exact
  release, and dual-failure behavior.
- [Mechanisms and evidence](references/mechanisms-and-evidence.md): runtime
  patterns, source anchors, and proof boundaries.

## Evidence maturity and transfer boundary

`exercised`: the authored fixture establishes its synchronous ownership and
failure-order semantics. Each receiving runtime supplies cancellation behavior,
process-crash recovery, durable reconciliation, security policy, and resource-
specific release evidence.
