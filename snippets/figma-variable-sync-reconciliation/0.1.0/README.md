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
| Resume point | `InMemoryCheckpointStore` | Next batch, expected revision and state digest, temporary-ID map, resolved-byte high-water mark, and observations |
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
  remote work begins.
- Batch planning enforces an explicit byte envelope. The coordinator measures
  each batch again after temporary IDs become service-issued IDs and returns
  the exact planned, resolved, and allowed byte counts when representation
  growth calls for replanning.
- Payload admission accepts bounded JSON data and the named fields assigned to
  each operation type.
- A lease carries owner, generation, and expiry; a later writer can acquire a
  new generation after expiry. The coordinator acquires that authority before
  it creates the first durable checkpoint, so a lease-held caller leaves both
  checkpoint and remote state unchanged.
- The coordinator awaits remote, lease, checkpoint, clock, delay, and fault
  collaborators. Promise rejections enter the same retry, reconciliation,
  conflict, and interruption paths as synchronous throws.
- Lease release settles before the caller receives a result. A rejected or
  unconfirmed release returns a typed lease error with an inspection
  coordinate. When execution and release both fail, the execution error keeps
  primary authority and carries the release error as its secondary cause.
- Every operation has a stable intent ID. Replaying a fully applied batch
  returns the recorded result.
- A lost success response triggers an intent read. The coordinator classifies
  the batch as already applied, safe to retry, or requiring a human decision.
- A post-apply interruption leaves the earlier checkpoint intact. Resume
  reaches the same accepted state through idempotent replay when the observed
  revision advances by the one expected batch transition.
- Concurrent drift returns expected and observed revisions for reconciliation,
  including drift between interrupted application and resume.
- Every durable batch checkpoint carries the reconciled state digest. Final
  acceptance requires the remote revision and state digest to match that
  checkpoint, so drift after a completed run receives a typed conflict.
- Checkpoint admission validates the exact field set, batch progress,
  settlement transcript, temporary-ID progress, revision arithmetic, and
  resource envelope before a resumed run can accept or advance it. The
  coordinator also caps accumulated retry, reconciliation, and settlement
  observations before the next remote mutation.
- A changed plan receives a successor run ID and checkpoint lineage.
- Receipts carry identifiers, counts, revisions, classifications, and digests;
  credential-shaped fields receive a dedicated finding.

## Fault map and recovery

| Injected condition | Observation | Recovery |
| --- | --- | --- |
| `retry_after` | Bounded delay and attempt appear in the checkpoint | Retry inside the declared attempt and delay budget |
| active writer lease | The current owner and expiry return as typed friction | Preserve checkpoint and remote state, then retry after authority becomes available |
| lease release rejected or unconfirmed | The caller receives `lease_release_failed` or `lease_release_unconfirmed` with the writer generation | Inspect the writer lease and resume from the durable checkpoint after authority is current |
| `timeout_before_apply` | Intent read returns an absent batch at the expected revision | Retry the same stable intents |
| `response_lost` | Intent read returns every operation as applied | Advance the checkpoint using reconciled results |
| `interrupt_after_apply` | Remote truth advances while the durable checkpoint remains earlier | Resume the same batch and accept idempotent replay |
| `concurrent_drift` | Remote revision advances outside the prepared plan | Return both revisions to a reconciliation owner |
| drift before interrupted-run resume | Idempotent intent results arrive at a later revision than the single expected transition | Return `remote_revision_changed_after_settlement` and the batch reconciliation coordinate |
| drift after completion | Final revision or state digest differs from the durable accepted checkpoint | Return `final_remote_drift` with both expected and observed coordinates |
| incomplete checkpoint transcript | Batch progress and settlement records disagree | Return `checkpoint_invalid` and inspect the durable checkpoint before resume |
| service-issued ID expands a batch | Resolved bytes exceed the admitted request envelope | Return `resolved_batch_exceeds_limit` before remote dispatch and replan that batch |
| partial prior intent set | Applied and absent intents coexist | Route the exact set to a human decision |

## Complexity and allocation

Let `V` be operations, `E` dependency edges, `B` batches, and `R` variables in
the fake remote.

- graph admission and ordering: `O(V + E)` time and `O(V + E)` space;
- collision and intent indexes: expected `O(V)` time and space;
- batch formation: `O(V)` plus JSON encoding cost;
- fake-remote atomic application: `O(R + batch_size)` allocation per batch
  because the simulator uses copy-on-write state; and
- final ordering and digest: `O(R log R)` for locale-independent ordinal
  output across receiving runtimes.

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
| Checkpoint observations | 50,000 |

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
operation envelopes, UTF-8 string and aggregate-plan ceilings, exact and
resolved batch boundaries, capped checkpoint observations, the local planner,
fake-remote atomicity, lease/checkpoint behavior, typed fault classifications,
idempotent replay, read-and-reconcile handling across asynchronous adapter
rejections, awaited lease release, revision and state-digest drift reporting,
chain and fan-out graph behavior, and the deterministic receipt in the
resolved Node.js environment. Live Figma API compatibility, durable
persistence, authenticated authority, multi-process coordination, production
scale, and organizational release acceptance belong to their receiving
implementations.
