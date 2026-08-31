---
title: Gist Registry source collaboration cycle
version: 0.1.0
status: working
audience: ai_collaborators
source_band: public_possible
task_type: repository_collaboration
---

# Gist Registry source collaboration cycle

## Desired receiving state

One active Gist Registry Issue reaches one review-ready or accepted source
coordinate. The canonical owner carries the requested behavior or repository
change, focused and repository checks answer its acceptance question, the
exact proposed index receives the repository secret-material observation, and
one pull request provides the evidence boundary and direct re-entry.

Completion keeps later publication roles distinct:

```text
current truth and active Issue
  → one selected source route
  → canonical implementation and focused evidence
  → schema and projection reconciliation
  → exact-index boundary observation
  → one reviewable source pull request
  → separately granted tag, Pages, hosted, or Gist receivers
```

The current task grant retains mutation and external-action authority. The
active Issue retains outcome and acceptance. This runbook orders source work;
it supplies neither merge nor publication authority.

## Entry condition

Begin with an active repository task or Issue and enough access to establish
the intended source base. Read [`AGENTS.md`](../../AGENTS.md),
[`BRANCHING.md`](../../BRANCHING.md), the nearest artifact README when one
exists, [`SCHEMA-NURSERY.md`](../../SCHEMA-NURSERY.md) when an artifact or
schema enters scope, and the live Issue or pull request.

```sh
git status --short --branch
git branch --show-current
git rev-parse HEAD
git fetch origin --prune
git rev-parse origin/main
```

When the worktree contains unrelated or ownership-unclear changes, preserve it
and use a separately authorized clean worktree. When network freshness,
acceptance, or mutation authority remains open, continue in
`observation_only` and return the exact release signal.

## Current owners

| Surface | Owner | Role in this route |
| --- | --- | --- |
| Task authority | Current human request and active Issue | Grants mutation and external actions; defines material acceptance |
| Accepted authored source | `main` | Carries reviewed artifacts, schemas, tests, documentation, and builders |
| Branch and release topology | [`BRANCHING.md`](../../BRANCHING.md) | Separates short-lived source work, generated `docs`, research `res`, and immutable tags |
| Artifact behavior | Exact-version runnable source and focused tests | Owns the demonstrated mechanism and behavior boundary |
| Artifact contract | Exact-version `snippet.json` | Declares identity, representations, provenance, veracity, execution, and transfer boundary |
| Registry discovery | [`registry.json`](../../registry.json) | Resolves exact artifact coordinates |
| Shared schema learning | [`SCHEMA-NURSERY.md`](../../SCHEMA-NURSERY.md) | Records cross-artifact pressure and extension standing |
| Public projection builder | [`tools/build-pages.mjs`](../../tools/build-pages.mjs) | Projects declared source bytes and generated discovery routes while canonical owners retain authorship |
| Secret-material boundary | `secret-boundary-inspection` and repository scanner | Observes a named source tree, exact index, available history, or artifact after a fresh canary |
| Pages publication | [`gist-registry-pages-publication.v0.1.md`](gist-registry-pages-publication.v0.1.md) | Receives an accepted `main` coordinate for deterministic `docs` and hosted observation |
| Immutable tags and optional Gists | Human or explicitly granted receiver | Selects accepted version tags and public Gist materialization |

## Ordered phases

### Phase 1 — Reconstruct current truth

**Action mode:** `observation_only` until the current task and Issue establish
a wider grant.

Confirm the branch, revision, worktree, upstream relation, recent history,
accepted `origin/main`, live Issue or pull request, nearest README, planning
record, manifest, and runnable source. Name any difference between historical
status and current source.

Use `gh issue view <number>` or `gh pr view <number>` when live state changes
scope, dependency, review, or delivery standing.

**Checkpoint:** One compact map identifies the inspected coordinate, current
behavior owner, active acceptance boundary, open decision, and first bounded
move.

**Recovery and stop:** Preserve existing work. A missing live observation
remains labelled cached or unverified. Ambiguous ownership returns the current
map and the one signal needed before mutation.

### Phase 2 — Select the registry route

**Action mode:** `observation_only` for classification. The chosen route and
task grant supply later implementation authority.

| Route | Select it when | Receiving owner |
| --- | --- | --- |
| First artifact coordinate | One public-safe source-grounded question has a named reader and fitting evidence | `probe-bearing-exemplar-formation` |
| Accepted-version successor | Material behavior, guarantee, or evidence changes accepted exact-version bytes | `versioned-exemplar-successor` |
| Architecture convergence | Several mechanisms create materially different concurrency, recovery, portability, evidence, or publication guarantees | `architecture-convergence-vantages` |
| Schema experiment | A real artifact or reader exposes new shared-contract pressure | `SCHEMA-NURSERY.md`, using `extensions` first |
| Repository tooling or prose | One current owner can receive the bounded change directly | The owning script, test, instruction, or document |
| Held route | A human choice, source fact, environment capability, or external dependency can materially change the result | Named receiver and observable release event |

**Checkpoint:** One route owns synthesis, and adjacent opportunities have a
named receiver or rest condition.

**Recovery and stop:** A changed premise returns to Phase 1. A consequential
selection returns to its human or Issue owner with the smallest decision
surface that can release work.

### Phase 3 — Bind the branch and toolchain

**Action mode:** `implementation_authorized` when the task grants branch and
environment preparation.

Use a clean short-lived Issue branch from the verified base:

```sh
git switch main
git merge --ff-only origin/main
git switch -c codex/<issue>-<short-purpose>
```

When the shared worktree belongs to another branch, create a separate clean
worktree from the verified `origin/main`. If the Issue branch already exists,
inspect its remote and pull-request relationship before continuing.

Inspect the root Node lock and only the artifact-local runtime declared by the
selected source:

```sh
node --version
npm --version
uv --version
npm ls --depth=0
```

Use `npm ci` when the root dependency tree needs its committed resolution.
Use the artifact's `uv --project ... --locked` commands for its Python line.
Dependencies earn their place by protecting a named contract or reducing
repeated, observed work.

The `res` branch keeps high-variance shared research history. Accepted material
returns through a fresh Issue branch from current `main`, selecting only the
settled result while `res` retains its exploratory history.

**Checkpoint:** The branch has one accepted base, one owning task, a clean or
ownership-legible worktree, and a toolchain capable of running the selected
checks.

**Recovery and stop:** Preserve a divergent or dirty owner. A restricted
network or missing runtime leaves its specific claim open and routes the check
to an authorized environment while source work that remains observable can
continue.

### Phase 4 — Change the canonical owner

**Action mode:** `repair_authorized` or `implementation_authorized` within the
active Issue and task grant.

For a runnable artifact, form only the surfaces its receiving use needs:

- mutable family README and lightweight continuation;
- exact-version README and `snippet.json`;
- source, focused tests, realistic synthetic or public-source-derived
  fixtures, expected results, runtime declaration, and resolved lock;
- one `registry.json` entry; and
- repository commands when they create a reusable lock, lint, or test route.

Record provenance class, public-safe semantic source keys, technical-veracity
standing, evidence and trust reach, transfer boundary, failure and recovery,
and relationships. Independently addressable files carry enough local context
to remain useful. `TARGET`, `CONTRAST`, and `GUARD` stay text-only and appear
where they materially aid review.

Accepted exact-version bytes remain unchanged. Material strengthening forms a
successor. A Gist candidate may record canonical source selection and proposed
publication ordering; independently runnable projection and actual Gist
creation remain human-held.

**Checkpoint:** The diff changes the source that owns the requested result,
stays inside the granted scope, and preserves accepted coordinates and
unrelated work.

**Recovery and stop:** A new source owner, private locator, publication
boundary, or consequential selection returns one compact decision surface.
Keep the smallest reviewable diff and last verified coordinate available.

### Phase 5 — Reconcile schema and projection pressure

**Action mode:** `observation_only` for interpretation;
`implementation_authorized` for already-granted schema, registry, builder, or
test changes.

Read `SCHEMA-NURSERY.md`. Keep one-artifact needs in `extensions`. Promote a
shared field only when materially different artifacts and a real reader,
check, or projection depend on one common shape.

Update registry and Pages tests for exact source membership and generated
discovery behavior. Let the manifest-driven builder project declared
representations. Build locally into ignored `.artifacts/pages/`; `docs` remains
at its accepted coordinate for the publication runbook.

**Checkpoint:** Registry, schema, and projection owners agree on exact identity,
declared representations, generated routes, and experimental-field standing.

**Recovery and stop:** A schema identity or published byte change returns to a
dedicated schema decision. Unexpected Pages membership returns to the manifest
or builder owner. The accepted `docs` coordinate remains unchanged.

### Phase 6 — Run proportionate evidence

**Action mode:** `observation_only` for checks; repairs stay within the current
implementation grant.

During iteration, run the artifact's focused lock, lint, and behavior commands.
Prepare the complete source evidence that remains valid with a working diff:

```sh
node --test tests/*.test.mjs
npm run check:public-boundary
npm run check:registry
npm run check:schema
npm run check:delivery-observations
npm run check:python-lock
npm run lint:python
npm run test:python
git diff --check
```

The Pages builder tests use a fixed test coordinate while source is changing.
The accepted-source build requires a clean committed worktree and runs in the
delivery phase.

Every evidence statement uses:

```text
Command → normalized result
Establishes: affirmative state observed at this revision
Coverage boundary: adjacent claim and its fitting owner
```

**Checkpoint:** Focused and repository checks answer the active acceptance
question at the proposed source bytes, and remaining claims retain visible
owners.

**Recovery and stop:** A failing check returns to its nearest source owner. A
scanner finding enters private local triage and pauses the handoff. Public
returns carry the normalized condition rather than raw diagnostics or
candidate material.

### Phase 7 — Deliver one source pull request

**Action mode:** `implementation_authorized` for commit, push, and pull request
when the current task grants them. Merge follows its explicit grant.

Inspect the complete diff, prepare the exact index, and observe that index
before committing:

```sh
git add <exact-intended-paths>
git diff --cached --check
npm run security:secrets:staged
git commit -m "<change-centered summary>"
```

The accepted-source builder binds projection bytes to `HEAD` and requires a
clean worktree. From the clean candidate commit, run:

```sh
npm test
npm run build:pages
npm run security:secrets:pages
npm run security:secrets
git diff --check origin/main...HEAD
```

These commands establish the complete source suite, deterministic
accepted-source projection, generated artifact boundary, and locally available
source/history boundary at the candidate commit. A failure returns to the
owning source, receives a follow-up commit, and reruns the complete lane.

Push the Issue branch and open one pull request to `main`. Give it the active
Issue's milestone and the smallest meaningful label set. The body names:

- one-sentence scope and exact artifact or repository owner;
- changed surfaces and why they create the desired state;
- exact normalized validation and what it establishes;
- evidence, environment, and publication boundaries;
- recovery coordinate; and
- next receiver plus exact re-entry action.

**Checkpoint:** One review surface contains the complete proposed change and
enough evidence for its next decision. The exact index and complete local
source boundary have named clean secret-material dispositions after their
fresh canaries.

**Recovery and stop:** A changed base, failed hosted check, or review finding
returns to the matching owner and reruns combined evidence. A review-only
grant ends with the pull request ready and human merge action named.

### Phase 8 — Route post-acceptance actions

**Action mode:** `observation_only` until each follow-on action receives its
own grant.

After merge, verify the accepted `main` coordinate. Create an immutable
`snippet/<semantic-id>/v<version>` or `schema/v<version>` tag only when the
task explicitly grants it. Hand deterministic `docs` projection and hosted
byte observation to
[`gist-registry-pages-publication.v0.1.md`](gist-registry-pages-publication.v0.1.md).
Leave optional Gist materialization with its human review receiver.

Record a skill observation only when the exercise changes routing, contract
meaning, or the conditions under which an existing skill should rest.

**Checkpoint:** Accepted source and every remaining release action have exact
coordinates, owners, and re-entry events.

**Recovery and stop:** A source, tag, projection, hosted, or Gist premise change
reopens only its matching route while accepted coordinates remain settled.

## Bounded vantage lane

A neighboring collaborator can receive one finite source reading, guarantee
comparison, focused test, wording pass, or implementation suggestion with an
exact starting revision, action mode, observable return, and stopping event.
The primary collaborator reviews the premise and integrates the result. The
cycle remains complete when support capacity rests.

## Public-safe handback

```text
Disposition: pass | friction | blocker
Scope: one-sentence material result
Source coordinate: branch or accepted main revision and pull request
Changed surfaces: concise repository-relative paths
Validation: exact command → normalized result
Establishes: affirmative evidence state
Coverage boundary: adjacent claim and its receiver
Environment note: retained toolchain or behavior-relevant local change
Recovery coordinate: last accepted revision or reversible source point
Next receiver: Issue, review, tag, Pages runbook, hosted observation, or Gist decision
Exact re-entry: one command, review action, or source path
```

Raw logs, scanner reports, traces, credentials, headers, signed or
query-bearing URLs, private locators, and user-specific filesystem paths stay
with their existing controlled receiver.

## Release and re-entry

The runbook releases when one active Issue has one reviewable or accepted
canonical source result, fitting checks, an exact-index boundary observation,
one sufficient receiving surface, and a direct continuation. Issue #18 is the
first live traversal. The runbook remains `working` until a later fresh-context
cycle establishes that its entry, phases, recovery, and handback supply
self-contained orientation from current source.
