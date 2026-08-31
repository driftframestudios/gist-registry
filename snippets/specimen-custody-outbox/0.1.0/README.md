# Specimen custody and transactional outbox 0.1.0

## Practical question

How can a custody transfer remain attributable, tenant-scoped, replay-safe,
and atomically aligned with event and outbox state under retries, stale
callers, and an interrupted commit?

This version answers with one process-local conformance model. A transfer
command snapshots every meaning-bearing field, including its JSON payload,
then binds that meaning to a SHA-256 fingerprint. One repository instance
serializes transfer calls, prepares custody, event, replay, and outbox effects
in detached maps, and publishes their immutable successor through one final
state swap.

## Observable model

A transfer carries:

- actor identity and role;
- tenant and specimen identity;
- reason and timezone-aware observation time;
- current custody source and expected version;
- destination; and
- a canonical JSON payload captured before repository work begins.

The repository resolves one of three outcomes:

- `applied` records one custody version, event, replay record, and tenant-keyed
  outbox message;
- `replayed` returns the stored receipt when the tenant-scoped transfer
  identity and complete command fingerprint agree; or
- `reconciliation_required` names the state or identity condition that calls
  for a new decision.

Reuse of a transfer identity with changed meaning reports the changed fields
and both fingerprints. Cross-tenant context, actor-context disagreement,
capability, custody availability, stale version, stale source, and outbox
identity conditions use explicit typed results. Event identity is derived from
the tenant-scoped transfer identity inside the same unit of work.

## Run the realistic synthetic transfer

From the repository root:

```sh
uv --cache-dir .artifacts/uv-cache run \
  --project snippets/specimen-custody-outbox/0.1.0 --locked \
  python snippets/specimen-custody-outbox/0.1.0/src/specimen_custody.py \
  snippets/specimen-custody-outbox/0.1.0/fixtures/transfer-command.json
```

The deterministic JSON result should equal
[`expected/transfer-commit.json`](expected/transfer-commit.json).

## Transaction and recovery shape

The accepted repository state contains four immutable maps. Under one
instance lock, the transfer route:

1. verifies actor and tenant context;
2. verifies the named transfer capability;
3. resolves exact replay or changed-intent reconciliation;
4. verifies the expected version and current source;
5. constructs the successor custody record, attributable event, replay record,
   and canonical outbox payload;
6. applies those values to detached working maps; and
7. freezes and publishes the complete candidate with one reference change.

The optional fault seam can stop after any candidate write. Because each write
still belongs to the detached candidate, the accepted snapshot remains equal
to its pre-call value. A same-instance reentrant transfer receives an explicit
runtime boundary while snapshot observation remains available from the fault
callback.

Outbox identity is `(tenant_id, message_id)`. Each message stores canonical
payload bytes and exposes their SHA-256 digest. An occupied identity with
changed content becomes a visible collision. Equal logical message IDs in two
tenants remain independent.

## Validate

```sh
npm run check:python-lock:specimen-custody-outbox:0.1.0
npm run lint:python:specimen-custody-outbox:0.1.0
npm run test:python:specimen-custody-outbox:0.1.0
```

The focused suite establishes:

- one accepted effect across custody, event, replay, and outbox state;
- exact replay with the recorded receipt and zero additional effects;
- explicit changed-field reconciliation for actor, role, time, source,
  version, destination, specimen, reason, and payload;
- complete snapshot preservation for context, capability, stale-state,
  collision, injected-write, and reentrant-call paths;
- tenant-scoped transfer and outbox identities;
- canonical payload capture and content binding; and
- one applied result under process-local concurrent calls.

## Technical judgment

**TARGET:** one attributable command meaning, one recorded outcome, and one
atomic custody/event/replay/outbox effect inside the demonstrated unit of work.

**CONTRAST:** separately mutating domain and delivery state leaves retries to
infer whether an interrupted operation completed and which meaning owns an
identity.

**GUARD:** tenant and capability checks precede domain lookup; stale callers
preserve accepted state; exact replay returns before current-state checks;
changed meaning enters reconciliation; detached candidate state reaches
readers through one final publication point.

The lock creates a linearized entry for one repository instance. Copy-on-write
maps make rollback a discard operation, which keeps the failure oracle exact
and inspectable. This allocation favors architectural clarity over mutation
throughput in an intentionally small conformance artifact.

## Source, evidence, and publication boundary

This realistic synthetic conformance model is a separately reviewed public
adaptation of authorized custody-semantics, transaction-conformance, and
durable-SQL design sources. The versioned Python implementation and focused
tests own the behavior claimed for `0.1.0`. Exact source locators and house
annotations remain with their authorized resolver.

The suite establishes semantic replay, one-instance serialized mutation,
immutable payload capture, optimistic stale-state handling, atomic
copy-on-write publication, and injected Python-event recovery in the resolved
Python 3.12 environment. SHA-256 binds content for comparison; authenticity
belongs to a separate trust mechanism.

A durable receiver can place the tenant-scoped custody update, event insert,
transfer-record insert, and outbox insert in one database transaction with
fitting unique keys and content comparison. Database isolation, commit
durability, process interruption, concurrent processes, broker delivery,
consumer acknowledgement, operational role authority, and external clock
truth retain their own implementation and observation routes.

The manifest records a proposed Gist source set and reading order for
publication review. A flattened, independently runnable Gist projection can
form through the separate human-held exact-version decision and carry its own
public-boundary wrapper, canonical identity, links, commands, and digests.
