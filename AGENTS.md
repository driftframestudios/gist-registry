# Registry collaboration ground

Gist Registry gives durable technical artifacts a canonical, versioned source
and lets optional Gists or visitor surfaces project accepted versions. Favor a
small real artifact over an abstract inventory.

## Begin with current truth

- Confirm the branch, clean state, current Issue, nearest README, and accepted
  registry revision before acting.
- Treat versioned runnable source and focused tests as behavior authority.
- Treat `registry.json` as the discovery projection and the artifact's
  `snippet.json` as its local contract.
- Treat `planning/` as prospective terrain and GitHub Issues as current work
  state.
- Preserve unrelated work already present.

## Let the schema learn from artifacts

- Read [`SCHEMA-NURSERY.md`](SCHEMA-NURSERY.md) before changing the artifact
  envelope or a kind-specific profile.
- Keep `artifactKind` and relationship names extensible. Add a shared required
  field only when a real reader, builder, check, or projection uses it.
- Distinguish declared media type from a media type observed at a hosted route.
- Keep hosted observations in an appendable record keyed to the immutable
  artifact version, representation path, manifest digest, and source revision.
- Keep exact-version schema identity, authored bytes, generated projection, and
  hosted observation as separate roles.
- Use `extensions` for a bounded experiment; promote a field after another
  artifact demonstrates shared use.

## Keep examples useful and public-safe

- Use realistic synthetic or public-source-derived fixtures.
- Name provenance class, technical-veracity standing, evidence reach, transfer
  boundary, material failure modes, and recovery behavior.
- Keep code comments behavioral. `TARGET`, `CONTRAST`, and `GUARD` may mark a
  desired path, diagnostic comparison, and protective check when those markers
  improve future inspection.
- Keep private locators, participant data, credentials, operational endpoints,
  and house annotations with their authorized owners.
- A Gist is public material when created, including an unlisted Gist. Human
  review retains the publication decision.
- Before a source or publication handoff, prove the pinned secret-material
  reader with a fresh canary and observe the exact tree, index, history, or
  generated artifact in scope. Keep findings in private local triage.

## Use registry skills when their trigger fits

Registry-specific skills live in [`.agents/skills/`](.agents/skills/):

- `architecture-convergence-vantages` coordinates bounded technical vantages
  when plausible changes create materially different guarantees;
- `probe-bearing-exemplar-formation` carries one source-grounded technical
  question into a public-safe first registry coordinate with focused evidence;
- `secret-boundary-inspection` produces a canary-proven, scope-explicit
  secret-material receipt or a private finding route; and
- `versioned-exemplar-successor` carries a material strengthening into new
  runnable source and exact derived teaching surfaces while accepted versions
  remain immutable.

These skills are instruction-only affordance surfaces. Natural receiving
work supplies revision evidence, and direct reasoning remains the fitting route
when one source reading or scoped repair answers the question.

## Keep continuation lightweight

An artifact-family README may carry one informational continuation block:

- `seeded` means a useful first form exists and is available for collaboration;
- `interstitial` means the current form is purposefully between collaboration
  cycles and names one concrete re-entry move; and
- `settled` means the current coordinate supports its declared use within its
  stated evidence boundary and can reopen when new evidence changes the job.

Always name the current form. Add one `Re-entry` sentence for `interstitial`.
These reversible annotations describe how work can continue. Versioned source,
tests, boundaries, and `technicalVeracity` retain behavior and evidence
standing; the publication route retains inclusion and authority; branches and
pull requests show active collaboration. Keep exact-version manifests
unchanged. Material behavior advances form a successor coordinate while the
mutable family README points to the current form.

An optional Gist may project the continuation block in its orientation file.
The exact Gist revision preserves that snapshot; repository source retains
meaning authority, and a later Gist edit binds to its own source version and
revision.

Every continuation standing remains available for forks, derivatives, and
successors. A registered continuation uses the existing relationship surface
to name the coordinate it extends.

## Work and return proportionately

Use a short-lived Issue branch from `main`. Run the nearest artifact test plus
`npm test` and `git diff --check`. A handoff names the scope, changed files,
exact command and result, risk or environment difference, and next receiver.

Optimize for collaborator re-entry. A dependency earns its place when it
protects a named contract or turns a repeated multi-step diagnosis into one
documented command. Pin direct dependencies, commit the resolved lock, keep
generated environments out of Git, and prefer one repository command that
returns the failing owner and recovery move.

The `res` line may carry high-variance research that benefits from shared
history. Keep its claims experimental, merge `main` into it at named
checkpoints, and move an accepted result through a fresh Issue branch from
`main`. The receiving pull request carries the selected files and evidence;
`res` is never merged wholesale into `main`.

`main` owns authored source. The `docs` branch is builder-owned GitHub Pages
output for `kindlight.io`; this repository has no cPanel or Cloudflare WAF
path. Run `npm run check:pages` for two-build byte comparison and
`npm run build:pages` for the ignored local projection. Hosted observations
retain their own delivery evidence.

Versioned operational runbooks live in [`.agents/runbooks/`](.agents/runbooks/).
Use the Pages publication runbook after a reviewed source change reaches
`main` and the current task grants the fitting projection actions. The runbook
orders source binding, deterministic build, artifact observation, `docs`
assembly, Pages reception, live parity, and handback while each existing owner
retains its decision.
