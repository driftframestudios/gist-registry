# Migration reconciliation and approval-bound cutover

Current form:
[`migration-reconciliation-cutover@0.1.0`](0.1.0/README.md).

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

## Continuation

- **Standing:** `seeded`
- **Current form:** [`migration-reconciliation-cutover@0.1.0`](0.1.0/)
- **Present use:** A runnable domain exemplar and proposed source set for a
  separately reviewed public Gist projection.
