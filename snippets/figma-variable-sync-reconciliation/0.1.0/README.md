# Figma Variable synchronization and reconciliation — 0.1.0

## Practical value

Remote design-token writes become safer when the caller can answer three
questions at every point: which meaning was approved, which operations the
remote accepted, and where a resumed run should begin. This exemplar turns
those questions into a small executable state machine.

It uses synthetic variables and an in-process fake remote. The package
demonstrates the coordination mechanics that remain valuable across service
versions while a live adapter retains current API compatibility, credential,
rate, and workspace authority.

## Run the example

Requires Node.js 22 through 26.

```sh
npm --prefix snippets/figma-variable-sync-reconciliation/0.1.0 ci --ignore-scripts
npm --prefix snippets/figma-variable-sync-reconciliation/0.1.0 run example
```

The command prints a deterministic sanitized receipt. Compare it with
[`expected/accepted-receipt.json`](expected/accepted-receipt.json).

Run the focused evidence:

```sh
npm --prefix snippets/figma-variable-sync-reconciliation/0.1.0 test
```

## Operating model

```text
reviewed local contract
  → preflighted run coordinate and typed operation graph
  → bounded dependency-ordered batches
  → one-writer lease and durable checkpoint
  → temporary-ID resolution and resolved-byte check
  → remote application
  → read and reconcile uncertain outcomes
  → final revision-and-state reconciliation
  → accepted receipt or exact recovery coordinate
```

### State owners

| State | Owner | Durable meaning |
| --- | --- | --- |
| Approved local meaning | Receiving token system | The variable identity and value intended for synchronization |
| Operation plan | `planner.mjs` | Stable intent IDs, dependency edges, batch envelope, and plan digest |
| Writer authority | `InMemoryLeaseStore` | One active writer generation and expiry |
| Resume point | `InMemoryCheckpointStore` | Current writer fence plus next batch, expected revision and state digest, pending transition projection, temporary-ID map, monotonic remote-ID ledger, resolved-byte high-water mark, bounded observation transcript, and completed-batch settlement accumulator |
| Remote truth | `FakeVariableRemote` | Current variables, revision, and applied intent results |
| Final result | Coordinator receipt | Accepted state digest, revisions, counts, and recovery history |

The in-memory stores expose process-local interfaces and behavior. A receiving
implementation selects persistent lease and
checkpoint systems with its own atomicity and availability evidence.

## Material behaviors

- Preflight admits bounded portable run and owner coordinates, validates each
  typed operation envelope, JSON shape, UTF-8 string budget, operation budget,
  and aggregate plan budget, and then scans the
  structurally admitted operations for credential-shaped material. Every
  preflight check completes before the coordinator consults a clock, snapshot,
  checkpoint, lease, or remote mutation route.
- Topological admission reports unresolved dependencies and cycles before
  remote work begins. Every target or reference that names a declared
  temporary ID carries a direct dependency on the operation that creates it,
  so input order and later batch boundaries preserve the same ownership.
- Batch planning enforces an explicit byte envelope. The coordinator measures
  each batch again after temporary IDs become service-issued IDs and returns
  the exact planned, resolved, and allowed byte counts when representation
  growth calls for replanning.
- Payload admission accepts dense arrays and plain or null-prototype JSON data
  records with enumerable data properties. Maps, sets, dates, typed arrays,
  accessors, sparse arrays, cycles, ambiguous numbers, and custom prototypes
  return typed plan friction before a digest or side effect exists.
- Every initial, post-settlement, and final remote snapshot passes an exact,
  bounded contract before hashing or checkpoint advancement. Variable identity,
  type, version, reference, JSON value, uniqueness, and aggregate envelopes
  therefore share one admitted state model.
- A lease carries owner, generation, and expiry; a later writer can acquire a
  new generation after expiry. The coordinator acquires that authority before
  it creates the first durable checkpoint, so a lease-held caller leaves both
  checkpoint and remote state unchanged.
- The checkpoint store claims the lease generation as a monotonic fencing
  token. Every checkpoint save renews the lease before and after its awaited
  write, and the store compares the token atomically at commit. A successor
  generation therefore keeps an expired writer from publishing older progress
  after a slow remote or storage call.
- The coordinator awaits remote, lease, checkpoint, clock, delay, and fault
  collaborators. Promise rejections enter the same retry, reconciliation,
  conflict, and interruption paths as synchronous throws.
- Lease release settles before the caller receives a result. A rejected or
  unconfirmed release returns a typed lease error with an inspection
  coordinate after accepted execution. A typed conflict, friction, or
  interruption keeps primary authority and carries bounded release context in
  `secondaryFailure`; an extensible thrown execution error carries the same
  bounded record in a distinct `secondaryFailure` property while preserving
  its existing `cause` descriptor.
- Every operation has a stable intent ID. Replaying a fully applied batch
  returns the recorded result.
- A lost success response triggers an intent read. The coordinator classifies
  the batch as already applied, safe to retry, or requiring a human decision.
- Before dispatch, the checkpoint records a semantic projection of the complete
  next state. Created variables use temporary identities in that digest, so the
  projection remains stable before the service assigns remote IDs.
- A post-apply interruption leaves that pending projection intact. Resume
  requires an exact intent read, the one expected revision advance, and a full
  observed-state match after service IDs normalize back to their temporary
  identities. Changes to unrelated variables therefore route to reconciliation
  before the checkpoint advances.
- Before another resumed write, the coordinator compares the live revision and
  state digest with the durable checkpoint. An exact applied intent set can
  explain one pending batch transition; other drift returns both coordinates
  for reconciliation.
- Apply and intent-read responses advance progress after their complete,
  one-to-one operation result sets pass structural and semantic admission.
  Create results also pass an identity-transfer check against every previously
  observed or issued remote ID and the settled snapshot. The monotonic ledger
  retains an issued ID after deletion and routes later reuse to explicit
  identity-transfer friction.
- After direct application, the coordinator compares the settled snapshot with
  the same durable semantic projection. This catches unreported changes to
  unrelated variables, version drift, create collisions, and dangling
  references before progress advances.
- Every durable batch checkpoint carries the reconciled state digest. Final
  acceptance requires the remote revision and state digest to match that
  checkpoint, so drift after a completed run receives a typed conflict.
- Checkpoint admission validates the exact field set, batch progress, pending
  transition, bounded transcript window and hash chain, temporary-ID progress,
  revision arithmetic, and resource envelope before a resumed run can accept
  or advance it. The coordinator caps total retry, reconciliation, and
  settlement observations before the next remote mutation while retaining the
  latest 128 records and one digest over the complete transcript. A separate
  settlement count and digest chain stays aligned with `nextBatchIndex`; its
  released-prefix coordinate keeps every retained observation at or beyond the
  last completed batch.
- Every checkpoint save returns through the same structural and semantic
  admission path. The coordinator compares the store-returned record with the
  record submitted for persistence before that durable state can drive another
  batch. Version `0.1.0` is the first published checkpoint shape for this
  exemplar and includes the remote-ID ledger, pending transition, and bounded
  observation transcript as required fields.
- A changed plan receives a successor run ID and checkpoint lineage.
- Receipts carry identifiers, counts, revisions, classifications, and digests;
  credential-shaped fields receive a dedicated finding.

## Fault map and recovery

| Injected condition | Observation | Recovery |
| --- | --- | --- |
| `retry_after` | A safe non-negative integer delay and attempt appear in the checkpoint | Wait for the admitted interval and retry inside the declared attempt and delay budget |
| active writer lease | The current owner and expiry return as typed friction | Preserve checkpoint and remote state, then retry after authority becomes available |
| lease release rejected or unconfirmed | Accepted execution raises `lease_release_failed` or `lease_release_unconfirmed`; typed outcomes and extensible thrown failures retain their primary authority and add bounded `secondaryFailure` context | Follow the primary recovery coordinate, inspect the writer lease, and resume from the durable checkpoint after authority is current |
| writer expires around checkpoint persistence | Lease renewal or the atomic checkpoint fence returns typed friction and the earlier durable coordinate remains authoritative | Read remote intent results and reconcile the exact batch before a successor writer advances |
| `timeout_before_apply` | Intent read returns an absent batch at the expected revision | Retry the same stable intents |
| `response_lost` | Intent read returns every operation as applied | Advance the checkpoint using reconciled results |
| `interrupt_after_apply` | Remote truth advances while the durable checkpoint retains the pre-dispatch full-state projection | Read the exact intents and accept idempotent replay after the complete observed state matches that projection |
| `concurrent_drift` | Remote revision advances outside the prepared plan | Return both revisions to a reconciliation owner |
| drift before interrupted-run resume | Live revision or state differs from the checkpoint while the exact pending intent set leaves the transition unexplained | Return `checkpoint_remote_drift` at `reconcile:resume` before another remote mutation |
| incomplete or mismatched remote results | Apply or intent-read results fail the exact operation-set contract | Return `remote_protocol_invalid`, preserve the durable checkpoint, and inspect the remote adapter at the batch reconciliation coordinate |
| drift after completion | Final revision or state digest differs from the durable accepted checkpoint | Return `final_remote_drift` with both expected and observed coordinates |
| incomplete checkpoint transcript | Batch progress and settlement records disagree | Return `checkpoint_invalid` and inspect the durable checkpoint before resume |
| service-issued ID expands a batch | Resolved bytes exceed the admitted request envelope | Return `resolved_batch_exceeds_limit` before remote dispatch and replan that batch |
| partial prior intent set | Applied and absent intents coexist | Route the exact set to a human decision |

## Complexity and allocation

Let `V` be operations, `E` dependency edges, `B` batches, `R` variables in
the fake remote, `H` total checkpoint observations, and `W` the retained
observation window (`W <= 128`).

- graph admission and ordering: `O(V + E)` time and `O(V + E)` space;
- collision and intent indexes: expected `O(V)` time and space;
- batch formation: `O(V)` plus JSON encoding cost;
- immutable checkpoint-plan indexes: `O(V + B)` once, followed by `O(1)` batch
  and create-progress lookups;
- one observation append: `O(1)` observation and settlement-chain digest work;
  checkpoint admission replays at most `W` retained records, so transcript
  work remains `O(W)` time and space across `H` observations;
- pending-transition projection: `O(R + batch_size)` time and space per batch;
- fake-remote atomic application: `O(R + batch_size)` allocation per batch
  because the simulator uses copy-on-write state; and
- final ordering and digest: `O(R log R)` for locale-independent ordinal
  output across receiving runtimes.

The checkpoint still carries the temporary-ID map and remote-identity ledger.
Structural admission and exact store-return verification therefore scale with
that durable coordinate's current serialized size. Remote snapshot projection
also remains `O(B * R)` across a complete multi-batch run. The bounded
transcript and immutable plan indexes remove the previous repeated scan of the
entire growing observation history and completed plan prefix while continuing
to expose the state that resume actually needs.

The scale evidence admits both a 1,000-operation chain and a 2,000-operation
high-fan-out graph. The fan-out test counts the indexed vertex and edge work and
contrasts it with repeated full-array dependency scans, making the structural
`O(V + E)` difference inspectable while wall-clock timing remains an
environment-bound observation. Boundary tests admit a batch at its exact byte
limit, reject the first exceeding byte, and remeasure a batch after a longer
service-issued ID replaces a temporary ID. A production adapter should measure
request bytes, operations, batches, retries, readbacks, elapsed time, and peak
memory at representative scales.

The local simulator applies these hard admission ceilings before cloning or
digesting a complete plan:

| Resource | Ceiling |
| --- | ---: |
| Operations | 10,000 |
| Dependencies per operation | 128 |
| JSON value nodes / depth | 10,000 / 20 |
| One JSON string or object key | 64 KiB UTF-8 |
| One encoded operation / batch | 256 KiB / 256 KiB |
| Aggregate encoded plan | 4 MiB |
| Remote snapshot variables / JSON nodes / depth | 10,000 / 100,000 / 20 |
| Remote snapshot strings / encoded snapshot | 4 MiB / 8 MiB |
| Historical remote variable identities | 20,000 |
| Total checkpoint observations | 50,000 |
| Retained checkpoint observation window | 128 |

Receiving adapters may select tighter limits inside this envelope. A successor
coordinate receives any broader limit together with representative scale and
failure evidence.

## Live adapter boundary

A live Figma adapter should verify current official documentation at the
adapter version and record:

- endpoint and request/response compatibility;
- request-size and operation-count envelope;
- authentication and file/workspace scopes;
- rate-limit and `Retry-After` behavior;
- temporary and service-issued identifier semantics;
- per-hop network and response limits;
- log and receipt redaction; and
- a final read-and-reconcile observation in a synthetic workspace.

The adapter should remain a distinct versioned coordinate. That keeps service
compatibility evidence adjacent to the code that depends on it.

### Current official service facts

The first live adapter should bind these facts to its implementation date and
recheck them during every successor review:

- [Figma Variables REST](https://developers.figma.com/docs/rest-api/variables/)
  currently places Variables API access on Enterprise plans and separates
  read and write scopes.
- [Variables endpoints](https://developers.figma.com/docs/rest-api/variables-endpoints/)
  describe local, published, and bulk mutation routes. One mutation request is
  atomic, applies collection, mode, variable, and mode-value arrays in order,
  and maps request-local temporary IDs to service IDs.
- The current mutation envelope allows a 4 MB body, up to 40 modes per
  collection, up to 5,000 variables per collection, and variable names that
  exclude `.`, `{`, and `}`. This simulator deliberately uses a smaller byte
  envelope so boundary behavior remains quick to exercise.
- A variable's resolved type remains fixed after creation. A type change forms
  a successor variable, rewires its receiving references, and then moves the
  earlier identity through an accountable deprecation or deletion decision.
- Published variable `id` and `key` values remain stable across updates, while
  `subscribed_id` changes after modification and publication. Reconciliation
  therefore keys durable identity and subscription state separately.
- Updating a string variable bound to text that uses a shared organization
  font can return `400`. A live adapter names that service constraint in its
  preflight and typed error.
- [Figma rate limits](https://developers.figma.com/docs/rest-api/rate-limits/)
  return `Retry-After` and plan/rate metadata. The service can revise numerical
  limits, so a live receipt records the headers observed at its exact date and
  account coordinate.

The official API describes request-level atomicity. Stable intent IDs,
durable checkpoints, leases, and read-before-replay reconciliation are
application-level design choices exercised here. After an outcome-unknown
mutation, the caller reads current local variables and compares expected
meaning before deciding whether replay remains safe.

## Evidence boundary

The focused tests establish side-effect-free preflight rejection, typed
operation envelopes, descriptor-first array and record admission, UTF-8 string
and aggregate-plan ceilings, exact and resolved batch boundaries, capped
checkpoint observations, store-returned checkpoint verification, monotonic
remote-identity ownership, same-batch temporary-target reconciliation,
complete projected batch-state verification, generation-fenced checkpoint
persistence across writer takeover, the local planner, fake-remote atomicity,
lease/checkpoint behavior, typed fault
classifications, idempotent replay, read-and-reconcile handling across
asynchronous adapter rejections, awaited lease release, revision and
state-digest drift reporting, chain and fan-out graph behavior, and the
deterministic receipt in the resolved Node.js environment. Live Figma API compatibility, durable
persistence, authenticated authority, multi-process coordination, production
scale, and organizational release acceptance belong to their receiving
implementations.
