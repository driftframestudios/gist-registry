# Branch and release topology

| Branch or ref | Role | Update path |
| --- | --- | --- |
| `main` | Accepted authored artifacts, schemas, tests, manifests, documentation, and builders | Short-lived Issue branch through review |
| `docs` | Builder-owned GitHub Pages projection for `kindlight.io` | Deterministic build from one accepted `main` revision |
| `res` | Shared, high-variance research whose experiments benefit from durable branch history | Named freshness checkpoints from `main`; selected results return through a fresh Issue branch |
| `codex/<issue>-<slug>` and other short-lived branches | One bounded implementation or repair | Pull request to `main`, then deletion after merge |
| `snippet/<semantic-id>/v<version>` | Immutable accepted artifact coordinate | Tag at the accepted `main` revision |
| `schema/v<version>` | Immutable accepted schema coordinate | Tag at the accepted `main` revision |

`docs` is a projection rather than a second authoring line.
[`tools/build-pages.mjs`](tools/build-pages.mjs) identifies the `main`
revision, selects registered representation bytes, supplies progressively
deeper discovery pages, and records the complete output inventory and SHA-256
values. The builder changes local generated output only; Git ref changes remain
an explicit receiving action after review.

## Publication movement

The first publication follows one source coordinate through distinct
observations:

1. accept the source change on `main`;
2. run `npm run check:pages` to compare two isolated builds;
3. run `npm run build:pages` to assemble `.artifacts/pages/`;
4. observe the named generated artifact at the public boundary;
5. commit that complete allowlisted tree to `docs` as one projection of the
   accepted `main` revision;
6. activate GitHub Pages from the `docs` branch root; and
7. record signed-out status, returned bytes, digest, media type, and
   cross-origin standing.

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
