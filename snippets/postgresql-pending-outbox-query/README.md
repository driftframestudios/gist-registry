# PostgreSQL pending outbox query

Count pending messages for each tenant-scoped specimen, then inspect the work a
matching partial index removes. The [0.1.0 package](0.1.0/README.md) contains
readable SQL, synthetic fixtures, an independent count oracle, an owned
PostgreSQL 17 runner, deliberate predicate failures, and normalized query plans.

## Current state

| Axis | Standing | Meaning |
| --- | --- | --- |
| Registry acceptance | Registered source | The accepted exact package is discoverable through the registry; its source pull request records independent review |
| Manifest maturity | `candidate` | The manifest records the bounded PostgreSQL 17.10 evidence |
| Continuation | `seeded` | The first runnable form supports use and receiver-specific workload exploration |
| Publication | Tagged Pages route | The immutable site release receipt records the accepted source, projected bytes and hosted observation |

**Current coordinate:**
[`postgresql-pending-outbox-query@0.1.0`](0.1.0/README.md).

**Continuation: seeded.** A receiver can reproduce the fixed workload, inspect
the complete query path, and propose a successor for a different distribution
or authenticated application boundary.

## Next evidence-bearing route

Start with the [query and result meaning](0.1.0/README.md#meaning-and-relations),
then [run the proof](0.1.0/README.md#run-the-proof). The
[parity-bound measurement exercise](0.1.0/exercises/parity-bound-query-plans.md)
shows how semantic agreement constrains a performance comparison.

[Artifact catalog](../README.md) · [Registry orientation](../../README.md)
