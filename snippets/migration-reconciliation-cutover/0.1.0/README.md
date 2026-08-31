# Migration reconciliation and approval-bound cutover 0.1.0

## Practical question

How can a process-local migration reconcile exact active and candidate
generations, bind a supplied approval record whose declared approver differs
from the actor to the same report and restore evidence, and publish activation,
recovery, event, and replay state through one atomic state change?

This version answers with one in-memory conformance model. `MigrationRecord`
admits a Python JSON tree with text object keys and finite numbers, requires
canonical identity text, and captures nested caller-owned payloads before
hashing. `MigrationGeneration` sorts those records by structured
tenant-and-record identity, requires one record per identity, and carries one
generation digest. A coordinator stages the candidate through an epoch
compare-and-set, remembers each observed generation ID and digest for its
lifetime, and keeps active and prior generations in their retained roles.

Reconciliation classifies every identity as matching, missing, divergent, or
extra. A ready report and verified supplied restore observation form a
`CutoverPlan`. Its request binds the current state epoch, active and candidate
generations, reconciliation report, restore evidence, operation contract, and
actor. A supplied approval record must describe that exact request, carry a
declared approver that differs from the actor, and cover the coordinator's
evaluation instant before the process-local activation can publish.

## One activation, several evidence owners

| Evidence | This exemplar makes inspectable | Receiving owner |
| --- | --- | --- |
| Generation state | Immutable records, tenant-scoped identity, active and candidate generation digests, and a prior-generation recovery coordinate | Durable migration and data platform |
| Reconciliation | Matching, missing, divergent, and extra identity partitions plus one report digest | Migration and data-quality review |
| Restore observation | Supplied generation parity, artifact multiplicity, declared participants, and supplied timing objectives | Operations and recovery rehearsal |
| Approval record | Exact request, report, operation, actor, declared-distinct approver, half-open activation window, and revocation values supplied to the model | Accountable human decision and approval or identity service |
| Activation publication | One process-local state swap covering the active and prior generations, request, approval consumption, receipt, and event | Durable cutover orchestration service |

The model performs the selected activation inside one coordinator instance.
Authenticated identity, accountable authorization, observed clean restore,
durable execution, and production authority transfer remain with the receiving
systems and people named for that environment.

## Run the realistic synthetic encounters

From the repository root:

```sh
uv --cache-dir .artifacts/uv-cache run \
  --project snippets/migration-reconciliation-cutover/0.1.0 --locked \
  python snippets/migration-reconciliation-cutover/0.1.0/src/migration_cutover.py \
  snippets/migration-reconciliation-cutover/0.1.0/fixtures/reconciled-cutover.json \
  snippets/migration-reconciliation-cutover/0.1.0/fixtures/returned-for-evidence.json
```

The deterministic JSON result should match
[`expected/cutover-evaluation.json`](expected/cutover-evaluation.json)
byte-for-byte. One fixture activates a fully reconciled generation and then
replays its recorded receipt. The other preserves the accepted generation and
returns the exact reconciliation work that remains.

## State and publication shape

The route:

1. snapshots every record payload and forms ordered immutable generations;
2. stages one candidate through an epoch compare-and-set while retaining the
   accepted active generation and every observed generation ID-to-digest
   binding;
3. reconciles matching, missing, divergent, and extra identities as a complete
   disjoint partition;
4. compares supplied restore generations, artifact multiplicity, participants,
   and timing objectives;
5. binds the state epoch, active and candidate digests, report, restore
   evidence, operation contract, actor, and request identity into one plan;
6. evaluates the supplied approval on the coordinator clock against the exact
   request, a declared approver distinct from the actor, the half-open
   `[approved_at, expires_at)` window, and revocation state;
7. prepares active, prior, request, approval-consumption, receipt, and event
   state away from the accepted snapshot;
8. compares the accepted state reference once more and publishes the complete
   candidate through one state-reference change; and
9. releases the coordinator lock before invoking the response-delivery hook.

A completed request replays only with its exact original approval record; that
exact pair resolves before renewed time evaluation. This ordering lets a
caller recover the known result after the activation committed and its first
response was lost. Pre-publication interruptions leave the accepted snapshot
available for a fitting retry.

Generation, report, restore, request, approval, and receipt digests are
reproducible under this artifact's Python 3.12 canonical-JSON profile. That
profile sorts object keys, uses compact separators, escapes non-ASCII text, and
rejects non-finite numbers. Cross-language byte equality requires explicit
conformance to the same profile. Authenticated identity and source attestation
remain distinct trust mechanisms.

## Validate

```sh
npm run check:python-lock:migration-reconciliation-cutover:0.1.0
npm run lint:python:migration-reconciliation-cutover:0.1.0
npm run test:python:migration-reconciliation-cutover:0.1.0
```

The focused suite establishes the named execution examples in the resolved
Python 3.12 environment, including the reviewed deterministic fixture result.
Source inspection establishes the admitted Python value profile and placement
of the response hook after lock release.

## Technical judgment

**TARGET:** one accepted generation transition and one recorded receipt whose
reconciliation, restore evidence, exact request-and-approval pair, prior
generation, and event remain linked through the artifact's declared digest
profile.

**CONTRAST:** equal record counts establish volume. Matching, missing,
divergent, and extra identities retain the distinctions needed for a legible
activation decision, while the recorded receipt distinguishes a completed
activation from a request that still awaits evidence.

**GUARD:** prepare the request, approval consumption, receipt, event, active
generation, and prior-generation recovery state away from the accepted
snapshot, then publish them through one process-local state reference.

This shape keeps the activation evidence useful while accountable authority
stays with its named receiver. A receiving team can inspect what agreed, what
changed, whether publication occurred, and which owner supplies the next
observation.

## Source, evidence, and transfer boundary

This realistic synthetic artifact is a separately reviewed public adaptation
of authorized LIMS/ELN specification, implementation, and Site Reading source
roles. Its manifest carries stable semantic source keys and captured
integration coordinates. The versioned implementation and focused tests own
the behavior claimed for `0.1.0`.

The suite establishes process-local immutable state, exact reconciliation,
supplied restore comparison, approval-record evaluation, one-instance atomic
activation, exact request-and-original-approval replay, and tested interruption
recovery. A receiving
approval service establishes signer identity, eligibility, expiry, revocation,
and accountable authorization. Operations evidence establishes that a clean
restore ran and that observed recovery objectives were met. Domain owners
establish scientific, relationship, audit, distribution, and sampling
acceptance.

A durable receiver selects its database, transaction and isolation model,
source-freeze protocol, restart behavior, participating processes, effect
execution, rollback procedure, authority-transfer sequence, and production
observations. The recorded prior generation supplies a recovery coordinate;
the receiving system establishes the procedure and evidence that can restore
it.

The manifest records a proposed Gist source set and reading order. A public
Gist remains a separate human-held exact-version publication action.
