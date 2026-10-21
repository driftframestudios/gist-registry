# Specimen custody and transactional outbox

This family makes one custody-transfer boundary inspectable: an attributable,
tenant-scoped command advances specimen custody and records its event, replay
outcome, and outbox message through one accepted state change. Exact replay
returns the recorded outcome. Changed command meaning returns an explicit
reconciliation result.

The first version is a realistic synthetic, process-local conformance model.
It demonstrates immutable command capture, optimistic state checks,
single-instance serialization, copy-on-write atomicity, and injected failure
recovery. A durable database implementation is the next fitting route for
transaction isolation, persistence, process interruption, and concurrent
writers.

## Current state

| Axis | Standing | Meaning |
| --- | --- | --- |
| Registry acceptance | `0.1.0` accepted | The exact version is registered and its immutable tag preserves the reviewed coordinate |
| Manifest maturity | `candidate` | The exact `snippet.json` records the process-local evidence maturity |
| Continuation | `seeded` | The first runnable form supports use and leaves durable transaction questions open |
| Publication | Pages projected | The accepted package is publicly retrievable; optional Gist creation remains a separate human-held action |

**Current coordinate:**
[`specimen-custody-outbox@0.1.0`](0.1.0/README.md).

## Next verification step

The current version is a runnable domain exemplar and proposed compact Gist
source set. A durable database implementation receives transaction isolation,
persistence, process interruption, concurrent-writer, and broker-delivery
evidence.
