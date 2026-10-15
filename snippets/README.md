# Artifact families

This directory is the human-readable catalog for Gist Registry's accepted
source families. Choose a family by the mechanism or decision you need, then
enter its mutable README before selecting an exact version.

[`registry.json`](../registry.json) is the machine-readable exact-version
catalog. Each exact `snippet.json` owns its artifact contract. Family READMEs
own orientation and continuation. Runnable source and focused tests own the
behavior they exercise.

## Choose a family

| Family | Kind | Current coordinate | Continuation | Start here when |
| --- | --- | --- | --- | --- |
| [Document evidence extraction](document-evidence-extraction/README.md) | `code_sample` | `0.1.1` | `settled` | A deterministic OCR-derived evidence analysis or recovery-aware filesystem promotion route is useful |
| [Document evidence core patterns](document-evidence-core-patterns/README.md) | `code_excerpt` | `0.1.1` | `settled` | A compact, exact selection from the complete document-evidence source will support teaching or review |
| [Specimen custody and transactional outbox](specimen-custody-outbox/README.md) | `domain_exemplar` | `0.1.0` | `seeded` | Custody, replay, attributable events, and an outbox must align through one state change |
| [Instrument ingress integrity](instrument-ingress-integrity/README.md) | `domain_exemplar` | `0.1.0` | `seeded` | Raw capture, acquisition identity, scientific mapping, retry, and quarantine require separate evidence roles |
| [Migration reconciliation and approval-bound cutover](migration-reconciliation-cutover/README.md) | `domain_exemplar` | `0.1.0` | `seeded` | Migration comparison, approval, activation, replay, and post-publication recovery need one inspectable boundary |
| [Typed absence and wire shape](typed-absence-and-wire-shape/README.md) | `code_sample` | `0.1.0` | `seeded` | A JSON update contract must preserve omission, `null`, empty values, zero, and false as distinct instructions |
| [LIMS/ELN Enterprise Implementation release exemplar](lims-eln-enterprise-implementation/README.md) | `repository_exemplar` | `0.3.2` | `seeded` | An exact file from an accepted repository release needs portable provenance and upstream-evidence bindings |
| [PostgreSQL pending-outbox query](postgresql-pending-outbox-query/README.md) | `domain_exemplar` | `0.1.0` | `seeded` | A bounded SQL query needs independent row expectations, ordinary-role checks, and equal results before index-plan comparison |

## Read the state axes

- **Registry acceptance** says an exact version is present in accepted
  repository source and discoverable through `registry.json`.
- **Manifest maturity** is the exact version's `snippet.json` standing. Every
  current version records `candidate` while the schema learns from material
  use.
- **Continuation** is mutable family orientation: `seeded`, `interstitial`, or
  `settled`. It names the current form and next useful collaboration.
- **Publication** records whether accepted source has entered the allowlisted
  Pages projection. Optional Gist creation remains a separately reviewed
  publication action.
- **Delivery observation** records what a named signed-out request established
  for one immutable source and projection coordinate.

These axes answer different questions. A registered source version can be
accepted and publicly projected while its exact manifest still records
`candidate` technical maturity and its family remains `seeded` for further
collaboration.

## Evaluate one family

1. Read the family README for its mechanism, current coordinate, state axes,
   and next evidence-bearing route.
2. Read the selected exact-version README and `snippet.json` together.
3. Run the exact version's declared command or the nearest focused test.
4. Treat the observed assertions as the demonstrated boundary and route
   durability, security, scientific, organizational, or production claims to
   their named receivers.

Run the inventory contract from the repository root with:

```sh
npm ci
npm run check:registry
```

The [root README](../README.md) supplies the wider repository route. The
[schema nursery](../SCHEMA-NURSERY.md) explains how repeated artifacts can earn
a shared contract. The [source collaboration cycle](../.agents/runbooks/gist-registry-source-collaboration-cycle.v0.1.md)
carries an authorized addition or successor to review.
