# Gist Registry orientation sources

This directory helps a cold or resumed collaborator select a small amount of
external practice context while Gist Registry source continues to own the work.
The catalog carries semantic identity, reader job, current standing, and a
repository-local fallback. An authorized resolver supplies an exact Notion,
MCP, or Obsidian retrieval coordinate.

## Repository entrances

- The [root README](../README.md) gives a first-time evaluator purpose, current
  state, reader routes, and the quickest proof.
- The [artifact family catalog](../snippets/README.md) selects one technical
  mechanism and its current exact coordinate.
- This directory adds external practice context when it can change the active
  decision.
- The [cold-session entry runbook](../.agents/runbooks/gist-registry-cold-session-entry.v0.1.md)
  orders re-entry and hands one bounded task capsule to the source or Pages
  owner.

The desired route is:

```text
current repository truth
  → one contribution or settlement front
  → the cold-session core when workspace context changes the decision
  → the smallest decision-changing subset from one task-specific profile
  → one repository skill and source owner
  → one bounded contribution or handback
```

Use the [cold-session entry
runbook](../.agents/runbooks/gist-registry-cold-session-entry.v0.1.md) for the
ordered procedure. `selection.json` supplies its provider-neutral source
selection.

## Authority map

| Surface | Authority |
| --- | --- |
| Versioned runnable source and focused tests | Demonstrated behavior and failure states |
| Exact-version `snippet.json` | Local artifact identity, representations, evidence, and transfer boundary |
| `registry.json` | Exact-version discovery |
| GitHub Issue and current task grant | Outcome, acceptance, mutation, and external-action authority |
| Canonical Registry or Field Guide page | Full contextual meaning of that page |
| `orientation/selection.json` | Which semantic sources apply to Gist Registry and which local route remains useful |
| Notion or Obsidian adapter | Retrieval procedure |
| Authorized resolver | Exact provider locator, access state, private ancestry, and provider-local mapping |
| `docs` and optional Gists | Reviewed delivery projections |

External guidance can improve selection and technical judgment. Repository
source, tests, manifests, and live GitHub state continue to decide current
behavior and work standing.

## Smallest useful source set

The `cold-session-core` profile contains four sources:

1. **Practitioner Probes** selects one technical layer or cross-cutting
   concern.
2. **Start Here — How to Use the Probes** supplies the question, mechanism,
   review surface, technical-veracity, and instruction-yield anatomy.
3. **Cross-Cutting — Verification Under AI Assistance** connects plausible
   output with named contracts and distinguishing evidence.
4. **Behavior- and Goal-Driven Development — Verifiable Outcomes & Testable
   Loops** connects desired behavior with a plausible failure and observable
   oracle.

Load this profile when workspace context can change the task decision. Then
select at most one conditional record for an ordinary single-front task. A
named task profile is an eligibility set: hydrate only the members whose
distinct contributions change the current decision, even when its candidate
set contains several records. The Registry Orientation & Information Radiator
is a conditional router for cases where the fitting family remains unclear.

Connector availability enriches this pass. Every record carries a local
fallback so repository work can continue when an external source is
unavailable, unauthorized, ambiguous, or unnecessary for the present
decision.

## Practitioner Probe translation

A selected probe hydrates the existing Registry contract rather than creating
a second artifact model:

| Probe contribution | Gist Registry owner |
| --- | --- |
| Practical question | `use.practicalQuestion` |
| Changed ability | `use.changedAbility` |
| Technical mechanism | Runnable source |
| Distinguishing observation | Focused tests and expected result |
| Evidence standing | `technicalVeracity` |
| Reusable instruction | `practice.instructionYields` |
| Failure and recovery | `failureRecovery` |
| Receiving route | `relationships` and the active Issue |

Probe depth describes the technical judgment brought to the artifact. Artifact
standing, source acceptance, immutable tagging, Pages delivery, and optional
Gist publication keep their existing independent owners.

## Code and runnable-artifact posture

- A `code_sample` presents one mechanism with enough source, tests, fixtures,
  expected results, and runtime declaration to stand on its own.
- A `domain_exemplar` keeps the state, identity, failure, recovery, and
  transfer relationships needed to understand its operating model.
- A `code_excerpt` resolves byte-for-byte to the complete runnable source and
  test owner.
- A `repository_exemplar` binds an immutable upstream release, selected bytes,
  digest, license, attribution, and upstream evidence authority.
- A `practitioner_probe` carries a practical question, mechanism,
  distinguishing observation, technical-veracity standing, instruction yield,
  and receiver.

AI-produced code enters as a review candidate. Focused execution establishes
the behavior it exercises, and each adjacent production, durability, security,
scientific, or organizational claim remains with its fitting receiver.

## Selection contract

`selection.json` uses one small repository-owned v0.1 format. Every record
contains:

- an operator-blind local ID;
- exact title and an evidenced semantic key, or an expected parent when the
  semantic key remains unobserved;
- source family, role, reader job, and activation conditions;
- `default`, `conditional`, or `authorized-overlay` selection depth;
- observed access and publication standing with its date;
- one or more repository-local source, skill, or runbook routes;
- an offline fallback; and
- a condition that makes a later retrieval useful.

Profiles collect records for a reader job. They remain selection aids rather
than instruction bundles: the collaborator loads the smallest record set that
can change the current decision.

When `jq` is available, inspect one profile and its eligible records without
reading the full catalog:

```sh
jq --arg id cold-session-core '
  . as $catalog
  | (.profiles[] | select(.id == $id)) as $profile
  | {profile: $profile, records: [$catalog.records[] | select(.id as $record | $profile.recordIds | index($record))]}
' orientation/selection.json
```

Exact provider locators stay with the authorized resolver. The tracked catalog
and its orientation surfaces carry semantic identities and local routes;
provider URLs, page IDs, signed or query-bearing routes, vault paths,
workstation paths, and mirrored page bodies remain in their access-controlled
owners. This keeps semantic identity stable as providers and retrieval
locations change.

## Adapter contract

Both adapters receive one catalog record and return the same safe observation:

```json
{
  "pointerId": "gr-orient-002",
  "provider": "provider-name",
  "resolutionStatus": "resolved",
  "resolvedTitle": "Practitioner Probes",
  "resolvedSemanticKey": "@driftframe/practitioner-probes",
  "observedSourceRole": "probe-family-selector",
  "catalogAccessStanding": "connector-unverified",
  "catalogPublicationStanding": "public-possible-signed-out-unverified",
  "observedOn": "2026-09-29",
  "decisionChangingContribution": "Selected one technical concern for the current artifact.",
  "exactLocatorRetainedByResolver": true
}
```

`resolutionStatus` is `resolved`, `ambiguous`, `unavailable`, or
`unauthorized` for the current retrieval. The two catalog standing fields carry
the repository's dated source snapshot rather than restating that result.
Repository-facing prose carries the normalized result and the local fallback.
Provider coordinates remain in the authorized retrieval context.

See [the Notion adapter](adapters/notion.md) and [the Obsidian
adapter](adapters/obsidian.md).

## Validation and evolution

Run the focused contract check with:

```sh
npm run check:orientation
```

The checker establishes exact v0.1 fields, stable and unique identities,
profile closure, repository-local regular-file routes, the four cold-session
anchors, and the tracked locator boundary across this directory and its entry
runbook. Provider access, page content, publication approval, and signed-out
availability receive their own observations.

An additive record or profile can use format `0.1.0`. An incompatible field
change advances the format. A formal exchange schema becomes useful after a
second executable adapter or an external consumer demonstrates shared use.

The catalog remains source-only in this tranche. The Pages builder allowlist
continues to exclude `orientation/`; a later public projection begins through
a separate reviewed publication decision.
