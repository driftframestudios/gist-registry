---
name: transaction-boundary-evidence-mapping
description: Maps a logical operation's meaning, accepted-state dependency, aligned effects, publication point, retry outcomes, and evidence owners. Applies when several state changes must become visible together or retry correctness depends on whether publication occurred.
---

# Transaction boundary evidence mapping

## Contract

- **What:** An evidence-backed map from one logical operation to the state,
  records, and consequences that must agree at publication.
- **When:** Two or more effects form one consumer-visible outcome, or identity
  reuse, stale state, retry, interruption, or response loss can change the
  correct result.
- **Boundaries:** Runnable source and focused observations retain behavior
  authority. Persistence technology, isolation level, authorization source,
  external delivery, clock authority, and domain acceptance retain their named
  owners. The map can live in the source-and-test pair and its nearest README,
  Issue, or pull request; a separate report earns its place through a named
  reader.
- **Result:** One bounded operation map, materially distinguishing evidence for
  each asserted guarantee, explicit recovery meaning, and a receiver for every
  adjacent claim.
- **Interactions:** `architecture-convergence-vantages` selects among
  mechanisms that create materially different guarantees.
  `probe-bearing-exemplar-formation` can consume the selected map when forming
  a transaction-bearing artifact. A map that exposes competing mechanisms
  returns the decision to architecture convergence.

## Fit and attention

- **Useful when:** A logical operation publishes several related records, a
  retry needs semantic rather than transport identity, or preparation and
  publication observe state at different times.
- **Direct route when:** One state change already has a complete operation
  contract and one source reading or focused repair answers the question.
- **Smallest useful dose:** Map only guarantees the artifact actually claims.
  Pair each with one source mechanism, one distinguishing observation, and one
  adjacent owner when the operation reaches beyond the demonstrated boundary.
- **Foregrounds:** Meaning-bearing identity, freshness, effect alignment,
  publication, replay, reconciliation, interruption, and evidence reach.
- **May under-attend:** Domain policy and human-held acceptance unless the
  receiving task names them.
- **Rest or release when:** Another row, check, or vantage would repeat the
  same mechanism, observable distinction, and receiver without changing the
  implementation or review decision.

## Portable operation map

Use the rows that can change the claimed behavior:

| Row | Question |
| --- | --- |
| Consumer result | What capability or visible outcome must this operation create? |
| Operation meaning | What scopes the logical identity, which fields give it complete meaning, and what equivalence relation defines an exact replay? |
| Accepted pre-state | Which state, version, epoch, evidence, or authorization must remain current at publication? |
| Aligned effects | Which domain state, receipt, event, replay record, outbox message, quarantine record, or authority consumption must become visible together? |
| Publication point | Which operation makes the candidate effects accepted, and what source mechanism creates that boundary? |
| Outcome families | How do first acceptance, exact replay, and reused identity with changed meaning resolve? |
| Failure intervals | What does interruption before publication preserve, and what does response loss after publication return on retry? |
| Evidence owners | Which observation establishes the local claim, and which adjacent guarantee belongs to another system or human receiver? |

## Rules

### Rule: Operation meaning precedes mechanism

Define identity scope and every meaning-bearing field before selecting a lock,
transaction, outbox, compare-and-set, or digest. Tenant or equivalent ownership
scope participates wherever equal local identifiers may coexist. A digest
supports the declared equivalence relation under its named canonicalization
profile; its surrounding trust relationship keeps its own owner.

### Rule: Freshness reaches the publication point

Select the smallest mechanism that keeps the accepted pre-state current: hold
serialization through preparation, repeat identity or state resolution after
outside work, compare an expected version or epoch, or make a final accepted
state comparison. An earlier snapshot establishes the state at its observation
time; the publication mechanism establishes whether that state can still be
accepted.

### Rule: Aligned effects share one visible boundary

Construct candidate effects away from accepted state, validate the
relationships among them, and expose them through one modeled publication
event. An external effect that uses another transaction boundary receives an
outbox, inbox, or durable handoff whose delivery observation remains with that
receiver.

### Rule: Replay follows the recorded equivalence relation

An exact replay returns the recorded outcome while retaining the established
effect set. Reused identity with changed meaning returns an explicit comparison
and constructive reconciliation route. When approval or another consumed
authority record determined the original effect, replay equivalence binds that
record as part of the original meaning.

### Rule: Failure intervals remain distinguishable

Pre-publication interruption preserves the exact accepted snapshot. When the
operation claims recovery from post-publication response loss, the accepted
recorded outcome remains available to the same-meaning retry. A retry whose
meaning differs enters the named reconciliation path.

### Rule: Evidence changes a decision

Each asserted guarantee names a plausible alternate state or fault, an
observable oracle that distinguishes it from the desired state, and the
implementation, acceptance, recovery, or receiver decision the observation can
change. Counts support effect cardinality when cardinality is itself part of
the runtime contract. State equality, relationship checks, and independently
derived identities carry their respective semantic claims.

Select claim-specific observations proportionately:

- an atomicity claim pairs successful effect relationships with a
  pre-publication fault that preserves a populated prior snapshot;
- a replay claim pairs same-meaning reuse without an additional effect with a
  changed-meaning comparison and preserved accepted state;
- a concurrency claim forces overlap among the actors it covers;
- a freshness claim moves accepted state between preparation and publication;
- a response-loss claim injects the loss after publication and observes the
  recorded result on retry; and
- a digest-reproducibility claim uses an independent oracle for the declared
  canonical form.

### Rule: Claims retain their evidence owner

A process-local lock and state swap establish one-instance behavior. Database
durability, cross-process isolation, broker acknowledgement, authenticated
authority, clock truth, and operational recovery remain with their receiving
systems. State the local guarantee first, then name the adjacent owner and the
observation that could establish it.

## Operating sequence

1. **Name the result:** State the consumer-visible outcome and consequence
   that make the boundary material.
2. **Define meaning:** Record logical identity, ownership scope, and
   meaning-bearing fields. Add canonicalization and exact-replay equivalence
   when digest or retry behavior enters the claim.
3. **Bind accepted state:** Name the precondition and the mechanism that keeps
   it current through publication.
4. **Enumerate aligned effects:** Trace every state and record that forms the
   outcome, their relationships, and the single modeled publication point.
5. **Separate outcomes:** Define first acceptance and the applicable failure
   intervals. Add exact replay, changed-meaning reconciliation, and
   post-publication recovery when the operation claims those outcomes.
6. **Pair mechanism and observation:** For every asserted guarantee, identify
   its source mechanism, plausible alternative, focused oracle, and decision
   consequence.
7. **Route adjacent claims:** Name the current system or human receiver for
   durability, authorization, external delivery, time, domain acceptance, and
   recovery claims beyond the demonstrated boundary.
8. **Release:** Return the map through the nearest source, test, README, Issue,
   or pull request once another eligible observation would leave the decision
   unchanged.

## Scenario: A response is lost after publication

Given one operation has published its complete effect set and recorded the
request meaning that produced it<br>
When the caller retries after losing the response<br>
Then the same meaning returns the recorded outcome without another effect<br>
And changed meaning returns the comparison and reconciliation route while the
accepted state remains available

## Completion

The mapping completes when a reviewer can trace every selected guarantee to
its source mechanism, one material observation, its applicable outcome and
failure meaning, and its current or receiving evidence owner. A changed
operation meaning, publication mechanism, failure interval, environment,
authority source, or receiving system can reopen the relevant row.
