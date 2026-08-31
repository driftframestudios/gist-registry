# Specimen custody and transactional outbox

Current form: [`specimen-custody-outbox@0.1.0`](0.1.0/README.md).

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

## Continuation

- **Standing:** `seeded`
- **Current form:** [`specimen-custody-outbox@0.1.0`](0.1.0/)
- **Present use:** A runnable domain exemplar and candidate source set for a
  separately reviewed public Gist projection.
