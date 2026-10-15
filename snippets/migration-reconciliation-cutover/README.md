# Migration reconciliation and approval-bound cutover

This family makes one migration-activation boundary inspectable. Exact
generation reconciliation and restore evidence form one cutover plan; a
request-bound approval record then participates in a single process-local
publication of active, prior, receipt, and event state.

The first version is a realistic synthetic, process-local conformance model.
It admits a bounded Python JSON tree, preserves structured tenant-and-record
identities, and stages candidates through an epoch compare-and-set while
remembering every generation ID and digest it has observed. Complete
reconciliation, supplied restore comparison, coordinator-clock approval
evaluation, copy-on-write publication, exact request-and-approval replay, and
post-publication response recovery remain inspectable together. Receiving
identity, operations, quality, and durable-storage systems retain their own
authority and evidence roles.

## Current state

| Axis | Standing | Meaning |
| --- | --- | --- |
| Registry acceptance | `0.1.0` accepted | The exact version is registered and its immutable tag preserves the reviewed coordinate |
| Manifest maturity | `candidate` | The exact `snippet.json` records the process-local evidence maturity |
| Continuation | `seeded` | The first runnable form supports use and leaves durable cutover questions open |
| Publication | Pages projected | The accepted package is publicly retrievable; optional Gist creation remains a separate human-held action |

**Current coordinate:**
[`migration-reconciliation-cutover@0.1.0`](0.1.0/README.md).

## Next evidence-bearing route

The current version is a runnable domain exemplar and proposed compact Gist
source set. A durable coordination and persistence owner receives multi-process
epoch control, restart recovery, operational approval, and production cutover
evidence.
