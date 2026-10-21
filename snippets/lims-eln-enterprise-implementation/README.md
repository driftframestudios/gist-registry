# LIMS/ELN Enterprise Implementation release exemplar

This family gives one accepted enterprise implementation release a compact,
public reading surface. The first version carries the complete 94-line
in-memory idempotency ledger from release `v0.3.2` and the immutable
coordinates needed to compare it byte for byte with its source.

The implementation repository retains authority for the release, complete
runtime, tests, license, and attribution. Gist Registry provides a typed
discovery record, the selected public source bytes, and an ordinary-language
guide to what the mechanism demonstrates.

## Current state

| Axis | Standing | Meaning |
| --- | --- | --- |
| Registry acceptance | `0.3.2` accepted | The exact file and release-coordinate record entered Gist Registry through reviewed source |
| Manifest maturity | `candidate` | The exact `snippet.json` records source-supported maturity for this selected representation |
| Continuation | `seeded` | The first repository exemplar supports evaluation and leaves durable implementation questions open |
| Publication | Pages projected | The accepted package is publicly retrievable; optional Gist creation remains a separate human-held action |

**Current coordinate:**
[`lims-eln-enterprise-implementation@0.3.2`](0.3.2/README.md) —
tenant-scoped reservation, exact replay, changed-content collision,
in-progress ownership, committed outcome recovery, and transaction snapshot
restoration in one process-local reference model.

## Next verification step

The current coordinate is ready for inspection, adaptation, forks, and
execution through the owning repository's focused tests. A database-backed
successor can extend the teaching route when durable uniqueness, transaction
isolation, leases, fencing, restart recovery, or multi-process coordination
becomes the receiving question.
