# Branch and release topology

| Branch or ref | Role | Update path |
| --- | --- | --- |
| `main` | Accepted authored artifacts, schemas, tests, manifests, documentation, and builders | Short-lived Issue branch through review |
| `docs` | Builder-owned GitHub Pages projection for `kindlight.io` | Deterministic build from one accepted `main` revision |
| `res` | Shared, high-variance research whose experiments benefit from durable branch history | Named freshness checkpoints from `main`; selected results return through a fresh Issue branch |
| `codex/<issue>-<slug>` and other short-lived branches | One bounded implementation or repair | Pull request to `main`, then deletion after merge |
| `snippet/<semantic-id>/v<version>` | Immutable accepted artifact coordinate | Tag at the accepted `main` revision |
| `site/v<version>` | Immutable accepted source for one Pages release | Annotated tag at accepted `main`, before `docs` promotion; release receipt binds the generated manifest and delivery |
| `schema/v<version>` | Immutable accepted schema coordinate | Tag at the accepted `main` revision |

`docs` is a projection rather than a second authoring line.
[`tools/build-pages.mjs`](tools/build-pages.mjs) identifies the `main`
revision, selects registered representation bytes, supplies progressively
deeper discovery pages, and records the complete output inventory and SHA-256
values. The builder changes local generated output only; Git ref changes remain
an explicit receiving action after review.

## Publication movement

Each site release follows one source coordinate through distinct observations:

1. Accept reviewed source on `main` and refresh `origin/main`.
2. Run `npm test` and `npm run build:pages`; the checks include two isolated builds.
3. Create an annotated immutable `site/vMAJOR.MINOR.PATCH` tag at that source and push the tag. Artifact and schema tags keep their own coordinate systems.
4. Run `npm run check:site-release -- --tag site/vMAJOR.MINOR.PATCH`. The gate requires a clean source equal to fetched `origin/main`, the annotated tag, accepted manifest identity, complete inventory equality, and equality with a fresh source build.
5. Observe the generated artifact's secret boundary; assemble the exact tree in a clean `docs` worktree and record the previous `docs` SHA.
6. Refresh the remote refs, rerun the release gate, confirm the published tag target and current `docs` parent, then push the single projection commit.
7. Require a completed Pages build for that exact `docs` SHA and signed-out byte parity for every addressable route.
8. Publish the GitHub release at the existing site tag. Its one receiving receipt binds source tag/SHA, `docs` SHA, manifest digest, checks, hosted observation, scope and recovery coordinate.

Candidate builds remain available before source acceptance and tagging; they
become promotion-ready only after the gate passes. The release receipt lives
outside the generated tree, so the manifest has no self-referential digest.
The gate observes local refs after the operator fetches; the remote tag check
and fast-forward push establish the receiving remote state.

Tags keep their original target. A repaired source receives the next site
version. Recovery can restore a previously recorded complete projection in a
new `docs` commit after its artifact check; the previous release's source tag
and receipt retain their identity. The initial tagged release records the
pre-tag `docs` tip as its recovery coordinate. The publication runbook owns
the exact steps and authorization checks.

The site is served by GitHub Pages directly. cPanel and Cloudflare WAF delivery
belong to Human–AI Systems Exemplars, not this repository. Pages configuration,
custom-domain association, and DNS changes retain their human or repository
administrator receiver.

A new long-lived branch forms only when a distinct receiving system
demonstrates a source, integration, or recovery job that `main`, generated
`docs`, or an immutable tag cannot perform.

`res` is the explicit exception for research that is valuable before its
contract settles. It may carry exploratory dependencies, visualizations,
notebooks, failed attempts, and provisional schemas. Each research cycle names
its question, source `main` revision, observation, and stopping event. A named
checkpoint merges current `main` into `res` and records any behavior change.

Small experiments remain easiest to discover on `main` with
`standing: experiment`. Use `res` when dependency, build, generated-data, or
research churn would materially disrupt the accepted line. `res` is neither a
publication source nor a place for private material; full CI remains available
there through manual dispatch.

Promotion starts again from current `main`: copy or reimplement the smallest
accepted result on an Issue branch, then run its receiving checks. This keeps
experimental history available without asking `main` to inherit the entire
research line. Create the remote `res` branch from an accepted `main` revision
when the first shared experiment has a receiver; the policy does not require
an otherwise empty long-lived branch.
