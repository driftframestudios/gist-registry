---
title: Gist Registry cold-session entry
version: 0.1.0
status: exercised
audience: ai_collaborators
source_band: public_possible
task_type: repository_orientation
---

# Gist Registry cold-session entry

## Desired receiving state

A cold or resumed AI collaborator can reconstruct current Gist Registry truth,
distinguish active implementation from settlement or observation work, load
only the external context that can change the decision, and hand one bounded
task capsule to the existing source collaboration cycle.

Completion produces one compact relationship:

```text
current Git, GitHub, source, and projection truth
  → one classified work front
  → one source and authority map
  → optional semantic-source hydration with a local fallback
  → one selected Registry route and skill
  → one exact first action or held signal
```

This runbook supplies entry and selection. The [source collaboration
cycle](gist-registry-source-collaboration-cycle.v0.1.md) owns implementation
through a review-ready pull request. The [Pages publication
runbook](gist-registry-pages-publication.v0.1.md) owns an accepted source
coordinate through generated `docs` and hosted observation. The current task
grant continues to own mutation, external action, merge, tag, publication, and
Gist authority.

## Entry condition

Use this route when a collaborator enters Gist Registry with little current
context, resumes after another collaboration wave, encounters disagreement
among Issues and planning, or needs workspace guidance to select a useful
technical contribution.

Begin in `observation_only`. Read [`AGENTS.md`](../../AGENTS.md), the root
[`README.md`](../../README.md), [`BRANCHING.md`](../../BRANCHING.md), the
[runbook index](README.md), and the live Issue or pull request under
consideration. Read [`SCHEMA-NURSERY.md`](../../SCHEMA-NURSERY.md) when an
artifact envelope or schema question enters scope.

Preserve existing work. When remote, connector, or runtime observations remain
unavailable, label them unobserved and continue through the repository-local
sources that still answer the task. A material owner or authority ambiguity
returns `friction` with the last verified coordinate and the signal that can
release work.

## Current owners

| Surface | Owner | Role in this route |
| --- | --- | --- |
| Task authority | Current human request and active Issue | Defines the material result, granted actions, held decisions, and acceptance |
| Accepted authored source | `main` | Carries reviewed artifacts, tests, schemas, documentation, tools, and runbooks |
| Artifact behavior | Exact-version runnable source and focused tests | Establishes the mechanism and exercised failure states |
| Artifact contract | Exact-version `snippet.json` | Declares identity, representations, provenance, evidence, and transfer boundary |
| Discovery | `registry.json` | Resolves accepted exact-version coordinates |
| Branch and release topology | [`BRANCHING.md`](../../BRANCHING.md) | Separates `main`, generated `docs`, research `res`, short-lived Issue branches, and immutable tags |
| Current work state | Live GitHub Issues, pull requests, and transition comments | Establishes implementation, settlement, observation, and held decisions |
| Prospective terrain | [`planning/README.md`](../../planning/README.md) | Provides revisable orientation whose status is reconciled with current source and GitHub |
| External practice context | [`orientation/selection.json`](../../orientation/selection.json) | Selects semantic knowledge sources and repository-local fallbacks |
| Exact external retrieval | Authorized Notion, MCP, or Obsidian resolver | Retains provider coordinates, access state, and private ancestry |
| Generated public projection | `docs` plus its `projection-manifest.json` | Carries builder-owned public bytes bound to an accepted source revision |
| Publication and optional Gists | Human or explicitly granted receiver | Selects audience change, immutable release, hosted promotion, and Gist creation |

## Phase 1 — Reconstruct repository and remote truth

**Action mode:** `observation_only`.

Confirm the local coordinate before interpreting planning or an Issue:

```sh
git status --short --branch
git branch --show-current
git rev-parse HEAD
git remote -v
git log -5 --oneline --decorate HEAD
```

When the current grant permits networked reads, refresh and compare accepted
source and generated projection:

```sh
git fetch origin --prune
git rev-parse origin/main
git rev-parse origin/docs
git show origin/docs:projection-manifest.json
gh pr list --state open
gh issue list --state open
```

When local ref mutation sits outside the observation grant, use
`git ls-remote origin refs/heads/main refs/heads/docs` and GitHub read APIs,
then label local remote-tracking refs as cached. In a partial clone, a
historical `git show` can hydrate a promisor object from the network; make that
effect visible before using it in a strictly local exercise.

Inspect recent merged pull requests and the latest decision-changing Issue
comment when an open Issue may describe an earlier phase. A generated manifest
binding to `origin/main` establishes source-to-projection identity for that
coordinate; hosted delivery remains with its latest delivery observation.

**Checkpoint:** The pass names repository, branch, revision, worktree state,
remote freshness, current `main`, current `docs`, manifest source revision,
open pull request, and selected Issue.

**Recovery and stop:** Preserve a dirty or ownership-unclear worktree. Treat a
network result as cached until refreshed. A source/projection mismatch routes
to the Pages runbook or its owning Issue before implementation selection.

## Phase 2 — Classify the current work front

**Action mode:** `observation_only`.

Read the Issue body, latest transition comments, accepted source, tags,
projection receipts, and next receiver together. Classify the selected work as
one of:

| Front | Current state | Fitting first action |
| --- | --- | --- |
| `implementation_front` | Acceptance still requires source or repository changes | Select a canonical owner and hand a task capsule to the source cycle |
| `settlement_front` | Material implementation and evidence are accepted; a human closure or downstream-use decision remains | Return the accepted coordinate and exact held decision |
| `observation_front` | Source is accepted; a named runtime, delivery, compatibility, or external response remains to be observed | Run or route only that observation |
| `held_publication` | Candidate source exists; tag, Pages, release, or Gist authority remains human-held | Preserve the candidate and name the publication grant required |

An Issue can be open while its implementation is complete. An older planning
row can describe a candidate that current source, tags, and receipts have
already accepted. Current source and live transition evidence lead, while the
older record keeps its rationale.

Choose one primary front for the next move. Secondary held actions can remain
visible without changing it: an Issue can be a settlement front while optional
Gist publication remains separately human-held.

**Checkpoint:** One front owns the next move, and any difference between the
Issue body, planning, and current source is explicit.

**Recovery and stop:** A missing human decision returns the accepted evidence
and exact question rather than opening implementation. A conflicting source
owner returns the authority map and pauses mutation.

## Phase 3 — Map source, projection, and evidence

**Action mode:** `observation_only`.

For artifact work, resolve the smallest complete chain:

```text
family README
  → exact-version README and snippet.json
  → runnable source, focused tests, fixtures, and expected results
  → registry.json discovery entry
  → immutable tag when accepted
  → docs projection manifest
  → hosted observation when present
```

For repository tooling or prose, name the owning file, its consumer, and the
check that observes its result. Keep authored source, generated output,
delivery, and publication as distinct roles.

State each observation as:

```text
Observed state: affirmative result at the named coordinate.
Establishes: behavior, identity, membership, or delivery fact exercised.
Coverage boundary: adjacent claim and its fitting owner.
```

**Checkpoint:** The collaborator can identify the current behavior owner,
artifact or repository contract, discovery projection, delivery carrier,
evidence reach, and held publication consequence.

**Recovery and stop:** A missing exact-version owner or unverifiable external
coordinate becomes a named evidence gap. Keep the rest of the repository map
available while that gap receives its fitting observation.

## Phase 4 — Hydrate only decision-changing external context

**Action mode:** `observation_only` through an authorized connector or local
fallback.

Read [`orientation/README.md`](../../orientation/README.md) and
[`orientation/selection.json`](../../orientation/selection.json). Use the
`cold-session-core` profile when external practice context can change route or
evidence selection. For an ordinary single-front task, load at most one
conditional record whose mechanism can change the decision. A named task
profile is an eligibility set; load the smallest subset whose distinct
contributions change a multi-owner decision.

Resolution uses this order:

1. stable semantic key;
2. exact title;
3. exact title constrained by expected parent and source family; and
4. `ambiguous`, `unavailable`, or `unauthorized` plus the record's local
   fallback.

Record only the pointer ID, title, semantic key when established, source role,
catalog access standing, catalog publication standing, observation date, and
decision-changing contribution. Exact provider locators, page IDs, private
ancestry, vault paths, signed routes, and raw connector diagnostics remain with
the authorized resolver.

The default Practitioner Probe footing asks for one practical question,
mechanism, material observation, technical-veracity standing, and instruction
yield. It supplies technical judgment; repository source and executable checks
retain behavior authority.

**Checkpoint:** The selected external context changes a named decision or
releases without expanding the working set. Connector absence still leaves one
complete repository-local route.

**Recovery and stop:** A truncated result receives the missing section before
it supports a claim. A source disagreement is named and returns behavior to the
repository owner. The authorized-overlay profile begins only with fitting
workspace access and a named cross-repository receiver.

## Phase 5 — Select one contribution route and skill

**Action mode:** `observation_only` for selection. The current task grant
supplies any later implementation authority.

| Need | Primary route |
| --- | --- |
| First code sample, Practitioner Probe, or domain exemplar | `probe-bearing-exemplar-formation` |
| Several plausible mechanisms create different guarantees | `architecture-convergence-vantages` |
| Identity, aligned effects, publication, replay, or recovery shape the result | `transaction-boundary-evidence-mapping` |
| Accepted exact-version behavior needs material strengthening | `versioned-exemplar-successor` |
| Human-facing prose carries collaboration-local shorthand | `contextual-jargon-scan` |
| Source, exact index, history, or a generated artifact crosses a handoff | `secret-boundary-inspection` |
| One authorized Issue should reach a review-ready source coordinate | `repository-collaboration-cycle` and the source runbook |
| Accepted source should reach `docs` and hosted observation | Pages publication runbook under a separate publication grant |

Choose one primary synthesis owner. A direct source reading or scoped repair
remains sufficient when a specialized skill adds no decision-changing method.

**Checkpoint:** The route names the practical result, canonical changed
surface, fitting skill, proportionate checks, evidence boundary, and next
receiver.

**Recovery and stop:** Competing architectures return to convergence before
source formation. A protected merge, tag, publication, provider-access, or
Gist decision returns to its human receiver with the candidate intact.

## Phase 6 — Form the task capsule and hand off

**Action mode:** `implementation_authorized` only when the current task grants
the selected source actions.

Prepare this capsule:

| Field | Required return |
| --- | --- |
| Goal | One material ability or settled decision |
| Repository coordinate | Branch, HEAD, accepted `origin/main`, and worktree state |
| Current front | Implementation, settlement, observation, or held publication |
| Active owner | Issue, pull request, source file, artifact coordinate, or human decision |
| Canonical changed surface | Exact source owner that will receive the change |
| Selected context | Catalog pointer IDs and their decision-changing contribution, or `local-fallback-only` |
| Primary skill | One route with a distinct receiving job |
| Evidence | Focused command or observation, what it establishes, and coverage boundary |
| Held actions | Merge, tag, Pages, Gist, provider, or other decisions outside the grant |
| Exact first action | One command, source edit, observation, or return question |

An `implementation_front` proceeds through the [source collaboration
cycle](gist-registry-source-collaboration-cycle.v0.1.md). A settlement,
observation, or held-publication front returns its capsule to the named
receiver without manufacturing source work.

**Checkpoint:** Another collaborator can begin from one source path and one
exact action without reconstructing the repository history.

**Recovery and stop:** A changed remote base, Issue disposition, source owner,
or authority grant reopens the matching phase. Preserve the last verified
capsule and name the changed signal.

## Public-safe handback

Return one receiving surface with:

- scope statement;
- current front and source coordinate;
- selected source or local fallback;
- concrete change, observation, or held decision;
- exact validation and normalized result;
- what the result establishes and leaves open;
- environment or access difference that changed behavior; and
- next receiver plus one exact re-entry action.

Raw logs, traces, credentials, headers, signed or query-bearing routes, exact
private provider coordinates, workstation paths, and connector diagnostics
stay with their access-controlled owners.

## Exercise receipt and maturity

On 2026-09-29, a fresh-context read-only traversal used Issue #31. It correctly
classified the open Issue as a settlement front: source, review, immutable tag,
Pages projection, signed-out byte observation, and the named downstream use
were complete. External hydration would not have changed the decision, so the
session used local fallbacks and returned the human Issue owner as the exact
closure receiver. Optional Gist publication remained a visible secondary held
action rather than reopening implementation.

That exercise exposed stale planning language, the distinction between one
primary front and secondary held actions, partial-clone network behavior, and
the value of profile-filtered catalog reading. Those findings were reconciled
into this version, advancing the runbook to `exercised`. Repeated stable use can
support `stable`.

The route releases when the task capsule or held-state handback is complete.
A changed owner, evidence boundary, external-source role, or branch topology
reopens the matching phase while accepted work remains at its established
coordinate.
