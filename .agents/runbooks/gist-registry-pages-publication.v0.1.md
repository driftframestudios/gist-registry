---
title: Gist Registry Pages publication
version: 0.1.0
status: exercised
audience: ai_collaborators
source_band: public_possible
task_type: operational_collaboration
---

# Gist Registry Pages publication

## Desired receiving state

One accepted `main` revision produces one deterministic, secret-observed
GitHub Pages projection. The exact generated tree becomes the next builder-owned
`docs` commit, GitHub Pages completes from that commit, and an ordinary
signed-out HTTPS pass establishes status and byte equality for every
addressable projected file.

Completion is a compact source → projection → delivery relationship:

```text
accepted main revision
  → deterministic generated tree and manifest
  → clean named-artifact observation
  → exact docs commit
  → completed Pages build
  → signed-out byte-parity result
```

The active Issue retains scope and acceptance. The current task grant retains
branch mutation, push, publication, and external-action authority. This
runbook orders an already-authorized route.

## Entry condition

Begin when a reviewed source change has entered `main` and an active task or
Issue grants the fitting publication actions. Use a clean source worktree and
a separate clean `docs` worktree. Read [`AGENTS.md`](../../AGENTS.md),
[`BRANCHING.md`](../../BRANCHING.md), the active source pull request, and its
receiving Issue before acting.

```sh
git status --short --branch
git fetch origin --prune
git rev-parse origin/main
git log -5 --oneline --decorate origin/main
```

When source acceptance, a clean worktree, remote freshness, or publication
authority remains open, use `observation_only`: report the exact missing state
and preserve both branches. Existing work stays with its owner. A dirty shared
worktree receives a separate clean worktree or a `friction` return.

## Current owners

| Surface | Owner | Role in this route |
| --- | --- | --- |
| Authored artifacts, schemas, records, tests, and builder | `main`, the active source pull request, and its Issue | Defines accepted meaning and builder behavior |
| Branch relationship | [`BRANCHING.md`](../../BRANCHING.md) | Defines `main`, `docs`, `res`, review branches, and immutable-tag roles |
| Projection membership and bytes | [`tools/build-pages.mjs`](../../tools/build-pages.mjs) | Builds and checks the allowlisted Pages tree |
| Manual hosted parity | [`tools/observe-pages.mjs`](../../tools/observe-pages.mjs) | Compares ordinary HTTPS responses with the generated projection |
| Secret-material observation | [`tools/scan-secret-material.mjs`](../../tools/scan-secret-material.mjs), [`.betterleaks.toml`](../../.betterleaks.toml), and `npm run security:secrets:pages` | Establishes the generated Pages scope after a fresh canary proves the pinned reader and sanitized output |
| Builder-owned public branch | `docs` | Records one exact projection of one accepted `main` revision |
| Delivery interpretation | [Issue #6](https://github.com/driftframestudios/gist-registry/issues/6) or its successor | Owns durable response observations and declared-versus-observed media interpretation |
| Pages, domain, DNS, and certificate settings | Human or repository-administrator receiver | Owns configuration and activation decisions |

`main` retains authored meaning. `docs` retains generated retrieval bytes.
GitHub Pages operates delivery. A durable observation records one response;
it remains distinct from the subject and projection it describes.

## Ordered phases

### Phase 1 — Bind the accepted source and build it twice

**Action mode:** `implementation_authorized` when the current task grants local
source preparation and generated-output work. Remote and publication actions
remain with later phases.

Move a clean source worktree to the accepted `main` coordinate through the
repository's normal fast-forward path. Install locked dependencies with
`npm ci` when the current environment needs them, then run:

```sh
npm test
npm run build:pages
git status --short --branch
```

`npm test` includes the deterministic two-build Pages comparison. The explicit
build writes the candidate to ignored `.artifacts/pages/`.

Read `projection-manifest.json` and confirm that `sourceRevision` equals the
accepted `main` SHA and that `projectionOwner` remains
`gist-registry-pages-builder`.

**Checkpoint:** Passing source, registry, schema, artifact, Python, and Pages
checks establish the repository contracts they exercise. Two generated builds
agree on membership and bytes for the named source revision. Hosted delivery
remains open.

**Recovery and stop:** A source mismatch, dirty tracked tree, nondeterministic
build, changed published exact-version byte, or failed test returns to the
source pull request or owning Issue. Keep the current `docs` tip unchanged.

### Phase 2 — Observe the publication candidate's secret boundary

**Action mode:** `observation_only` through the repository-owned scanner.
Installation verifies the accepted pinned reader; a version, checksum,
configuration, or wrapper change returns to its own Issue branch.

Observe the exact `.artifacts/pages/` directory. Require the selected route to
name its engine version, configuration identity, fresh synthetic-canary result,
artifact scope, and normalized finding disposition. The canary passes only
when detection and redaction both succeed.

```sh
npm run security:secrets:install
npm run test:secret-material
npm run security:secrets:pages
```

**Checkpoint:** A clean named-artifact result establishes zero unresolved
matches from the selected detector, version, configuration, and exact
generated tree after its synthetic canary passed. Audience fit, public
availability, exhaustive credential absence, and provider validity retain
their fitting owners.

**Recovery and stop:** A scanner finding pauses the publication handoff and
enters the private response route. A missing accepted scanner returns
`friction` with the exact artifact ready for a named receiver. Candidate values
and raw reports stay outside Issues and pull requests.

### Phase 3 — Assemble one exact `docs` commit

**Action mode:** `implementation_authorized` when the task explicitly grants
the `docs` worktree, commit, and comparison actions. Push remains with Phase 4.

Use a dedicated temporary worktree on the current `docs` branch. Confirm it is
clean and equal to `origin/docs` before replacement. Synchronize the complete
generated tree into that worktree while preserving only its `.git` carrier:

```sh
git status --short --branch
git rev-parse HEAD
rsync -a --delete --exclude .git .artifacts/pages/ <clean-docs-worktree>/
diff -qr --exclude=.git .artifacts/pages <clean-docs-worktree>
```

Run the named-artifact observation again on the receiving assembly when the
scanner contract requires receiver-local observation. Then stage the complete
tree, inspect the candidate, and commit it:

```sh
git add -A
git diff --cached --check
git status --short
git commit -m "Project Pages from main@<short-sha>"
diff -qr --exclude=.git <generated-pages> <clean-docs-worktree>
```

**Checkpoint:** The committed `docs` tree and scanned generated candidate have
identical regular-file membership and bytes. The projection manifest names the
accepted `main` revision.

**Recovery and stop:** A stale or dirty `docs` worktree, remote divergence,
unexpected undeclared file, manifest mismatch, or byte difference returns to
the builder or branch owner. Preserve the current remote `docs` tip while the
candidate is repaired.

### Phase 4 — Publish the projection and receive the Pages build

**Action mode:** `implementation_authorized` only when the task grants the
`docs` push. Human or repository-administrator authority continues to own
Pages, domain, DNS, and certificate setting changes.

Refresh `origin/docs` immediately before push and confirm that the candidate's
parent is still the current remote tip. Push the single projection commit:

```sh
git fetch origin docs
git push origin docs
```

Observe GitHub's latest Pages build through the repository API. Require its
commit to equal the new `docs` SHA, its status to become `built`, and its error
message to remain empty.

**Checkpoint:** GitHub Pages accepted the exact promoted `docs` commit. Public
response bytes remain open until Phase 5.

**Recovery and stop:** A remote divergence returns to a fresh clean `docs`
assembly. A failed Pages build returns its normalized failure class to the
repository-administrator receiver while the previous public projection remains
the known delivery coordinate. Configuration changes begin through a separate
grant.

### Phase 5 — Observe every addressable public file

**Action mode:** `observation_only` after the Pages build names the promoted
commit. Repair, republish, and configuration changes receive a fresh grant.

From the accepted `main` worktree whose `.artifacts/pages/` produced the
promoted tree, run:

```sh
npm run observe:pages
```

The observer reads the canonical origin and source revision from the generated
manifest. It requests every manifest-listed path except `.nojekyll`, then adds
`projection-manifest.json` itself. It requires `200`, the exact final canonical
URL, byte count, and SHA-256 equality. Its output carries only the normalized
file count, content-type counts, manifest digest, and bounded detail for the
manifest and durable delivery records.

**Checkpoint:** A passing result establishes current ordinary-domain status
and byte equality for every addressable file in the promoted projection at one
observation time. Future responses, other origins, certificate lifecycle,
cache variance, crawler behavior, and semantic media-type interpretation stay
with their named observations.

**Recovery and stop:** A status, redirect, path, byte, or digest mismatch
pauses settlement. Return the affected public-safe path and normalized failure
class to the builder, Pages, or domain owner. Keep raw response material local.

### Phase 6 — Return one sufficient transition receipt

**Action mode:** `repair_authorized` when the task grants updates to the active
Issue or pull-request surface. Issue closure remains a human decision.

Update the current receiving Issue with:

- accepted `main` SHA and reviewed pull request;
- promoted `docs` SHA and projection-manifest digest;
- normalized `npm test` result and file count;
- scanner engine, configuration identity, canary result, and clean artifact
  disposition;
- Pages build result;
- normalized signed-out status and complete byte-parity result;
- evidence boundary, recovery owner, and next receiver.

Use one sufficient public-safe surface. A durable response record forms only
when the active delivery Issue calls for a new decision-changing observation;
ordinary publication does not rewrite an earlier record's time or coordinates.

**Checkpoint:** The source, projection, delivery result, coverage boundary,
and next receiver are available in one current collaboration surface.

**Recovery and stop:** A receiver that still needs source acceptance,
publication authority, or a distinct live observation keeps that condition
open. The completed phases rest at their accepted coordinates.

## Bounded support lane

A neighboring AI collaborator receives one named phase with an explicit action
mode, exact starting revision, granted files or commands, expected observation,
and stopping event. It returns one `pass`, `friction`, or `blocker`; branch,
push, Issue, Pages, and domain actions remain with the packet that grants them.

## Public-safe handback

```text
Disposition: pass | friction | blocker
Accepted source: main@<full-sha>
Projection: docs@<full-sha>; manifest sha256:<digest>; <count> files
Validation: repository command → normalized result
Artifact boundary: engine/configuration/canary/clean disposition
Hosted observation: <count> addressable files → normalized parity result
Establishes: affirmative evidence state
Coverage boundary: adjacent claim still open
Next receiver: Issue and re-entry event
```

Raw logs, scanner reports, candidate values, response bodies, complete headers,
credentials, query-bearing URLs, private routes, and user-specific paths stay
with their existing controlled receiver.

## Release and re-entry

The runbook releases when one accepted source coordinate has a deterministic
and scanned projection, an exact promoted `docs` commit, a completed Pages
build, a passing complete ordinary-domain byte observation, and one sufficient
Issue handback. A builder, projection-format, secret-boundary, Pages, domain,
or observation-contract change reopens the matching phase. A new accepted
artifact can begin again at Phase 1 while prior exact-version paths and durable
observations retain their own coordinates.
