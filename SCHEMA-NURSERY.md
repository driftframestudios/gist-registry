# Schema nursery

## Most effective first model

The registry schema is a shared envelope around materially different technical
artifacts. The envelope carries what a reader or tool needs to identify,
inspect, execute, verify, project, and recover an artifact. A kind name and
bounded extension block preserve differences among code samples, Practitioner
Probes, prototypes, domain exemplars, experiments, runbooks, loop-bearing
members, and harness material.

This first attempt is informed by the private Practitioner Probe family. Its
workspace locators and house annotations remain with their authorized owner,
while the family contributes
several durable ideas:

- one practical question and the changed ability it seeks;
- answer ranges or levels when they materially change a receiving decision,
  with depth attached to the artifact or answer;
- technical core, review surfaces, and an instruction yield;
- technical-veracity standing adjacent to claims;
- `TARGET`, `CONTRAST`, and `GUARD` as text-only semantic markers;
- probability-of-what kept separate from any estimate;
- code-exemplar granularity, complexity, and allocation as explicit technical
  judgments;
- references attached to the claims they support; and
- handoff, failure, recovery, and settlement standing.

The first schema keeps Practitioner Probe fields optional. It exposes reusable
`practice` fields and lets later kind-specific
profiles become schemas only after real instances demonstrate their shape.

## Layers

1. **Identity** — semantic ID, version, kind, title, standing, canonical path.
2. **Use** — practical question, changed ability, readers, and capabilities.
3. **Authority** — provenance class, temporal scope, source keys, license, and
   technical-veracity standing.
4. **Representations** — path, role, and declared media type for each carried
   file.
5. **Execution** — runtime, declared and locked dependencies, commands,
   fixtures, expected results, and environment notes when the artifact runs.
6. **Practice** — review questions, decision rules, semantic markers,
   instruction yields, and complexity or granularity determinations when they
   help inspect the artifact.
7. **Boundaries and recovery** — evidence, trust, transfer, failure modes, and
   recovery moves.
8. **Relationships** — receivers, projections, dependencies, variants, and
   other named routes.
9. **Delivery observations** — the separate appendable
   [`delivery-observation` family](observations/delivery/README.md) keys a
   hosted status, raw and normalized media type, digest, and named source and
   projection coordinates to the subject that was actually requested. The
   first exercised subject is a schema. A later artifact-representation profile
   can earn its own schema version when a real request supplies that pressure.
10. **Extensions** — an experimental field can serve a real artifact before it
    is promoted into the shared envelope.

## Version movement

The current experiment is
[`schemas/0.1.0/registry-artifact.schema.json`](schemas/0.1.0/registry-artifact.schema.json).
It is an authored draft identity exercised by the registered versions across
`code_sample`, `code_excerpt`, and `domain_exemplar`. The Pages builder carries
its exact bytes at the canonical
`kindlight.io` path and at the repository-relative path needed by the
byte-identical manifest. The first signed-out HTTPS observation records the
successful canonical-schema response against the exact accepted source and
`docs` revisions. The local build continues to establish projection parity.

This `0.1.0` publication exercises retrieval while the envelope remains an
experiment. The independent domain exemplar now establishes useful cross-kind
fit. A stable exact-version contract and immutable schema tag can follow when
a shared reader or check demonstrates which reusable fields it depends on.

An artifact may add information through a bounded extension first.
When two materially different artifacts use the same extension and a reader or
check depends on it, that observation is evidence for promotion. This keeps the
schema responsive to how coding and collaboration actually change.

## Second artifact observation

`document-evidence-core-patterns@0.1.0` exercises the envelope as a compact
`code_excerpt` whose runnable evidence belongs to a related comprehensive
artifact. The current shape accommodates that difference through the open
`artifactKind`, optional `execution`, source-supported technical standing,
and a `derived_from` relationship.

Its ordered Gist candidate stays in `extensions.gistCandidate`. One real use
is enough to make the publication handoff inspectable and remains modest
evidence for a shared field. A later materially different companion can reveal
whether Gist selection belongs in a kind-specific profile, an appendable
projection record, or the existing relationship family.

## Third artifact observation

`specimen-custody-outbox@0.1.0` is the first runnable `domain_exemplar`. It
reuses the shared identity, use, provenance, representation, execution,
practice, boundary, recovery, and relationship layers while its tenant,
command, replay, reconciliation, event, and outbox behavior remains local to
the artifact and focused tests.

This artifact supplies a second, materially different
`extensions.gistCandidate` use. The compact excerpt companions carry
Gist-owned Markdown representations; the domain exemplar maps canonical
README, source, test, fixture, and expected-result files to proposed
publication names. Both make a human-held publication selection inspectable.
The extension remains experimental while a shared publisher or other reader
has yet to demonstrate dependence on one common shape.

The manifest records `verified` technical standing for the demonstrated
in-memory unit of work. Durable SQL execution has a separate receiver for
database isolation, persistence, process interruption, and cross-process
concurrency. This separation keeps schema standing responsive to observed use
while each technical claim stays with its fitting evidence owner.

## Fourth artifact observation

`instrument-ingress-integrity@0.1.0` is the second runnable
`domain_exemplar`. Delivery identity, acquisition identity, raw-byte content
addressing, strict scientific mapping, and quarantine evidence remain
artifact-local while the shared identity, representation, execution,
practice, boundary, recovery, and relationship layers retain their jobs.

This artifact supplies a third materially different
`extensions.gistCandidate` use and adds bounded source-coordinate detail under
`extensions.sourceCoordinates`. Both extensions remain experiments. The
repository has several authored examples and still has no shared publisher or
reader whose behavior depends on one common Gist-candidate or source-coordinate
shape. A future consumer can establish the useful fields and their ownership
before a schema version promotes them.

The manifest records `verified` standing for the process-local conformance
model. Governed raw-object storage, durable inbox alignment, restart behavior,
cross-process concurrency, configured instrument identity, scientific mapping
qualification, and accountable acceptance retain separate receivers.

## Fifth artifact observation

`migration-reconciliation-cutover@0.1.0` is the third runnable
`domain_exemplar`. Strict Python-value admission, structured migration
identities, epoch compare-and-set staging, lifetime generation-ID consistency,
complete reconciliation, supplied restore comparison, exact request and
original-approval replay, and a single process-local activation remain
artifact-local. The shared identity,
representation, execution, practice, boundary, recovery, and relationship
layers continue to describe the artifact without absorbing its transaction
model.

This artifact supplies a fourth materially different
`extensions.gistCandidate` use and a second bounded source-coordinate record.
Those repetitions make the experimental shapes easier to compare. Promotion
still follows a shared publisher or reader that demonstrates which fields it
uses and which owner maintains them.

The manifest records `verified` standing for the process-local conformance
model after its focused source and test evidence passes. Authenticated identity,
accountable authorization, observed clean restore, durable database execution,
cross-process coordination, production authority transfer, and operational
rollback retain their named receiving systems and evidence owners.

## Sixth artifact observation

`typed-absence-and-wire-shape@0.1.0` is the first independently authored
TypeScript `code_sample`. Its field-level presence meanings, compile-time
optional-property distinction, descriptor snapshot, JSON-ready output, and
exact-byte example remain artifact-local. The shared identity, provenance,
representation, execution, practice, boundary, recovery, and relationship
layers describe it without absorbing language- or runtime-specific behavior.

This artifact supplies a fifth materially different
`extensions.gistCandidate` use: a README, TypeScript source, runtime and type
tests, fixture, and expected result with proposed publication names. It also
exercises an npm dependency lock beside the existing `uv` locks. The shared
execution envelope accommodates both because each manifest names its runtime,
artifact-relative lock, commands, fixtures, and expected results.

The manifest records `verified` standing for passive same-realm record
projection in the resolved Node.js and TypeScript environment. API schema,
generated-client behavior, transport, persistence, executable proxies,
cross-realm objects, authorization, and downstream acceptance retain their
receiving systems and evidence owners.

## Seventh artifact observation

`lims-eln-enterprise-implementation@0.3.2` is the first
`repository_exemplar`. It carries one complete Python file from an accepted
external repository release and a compact machine-readable coordinate for the
annotated tag, commit, tree, archive digest, release observation, source and
test blobs, license, attribution, and explicit public projection boundary.

The open `artifactKind`, optional `execution`, ordinary representation list,
and bounded `extensions.repositoryRelease` record accommodate this use. The
represented `release-coordinate.json` owns the detailed external identity;
the extension gives a manifest reader the shortest route to that carrier and
selected file. A later, materially different repository exemplar or shared
consumer can show which external-release fields deserve a common schema
contract. The current envelope therefore remains at `0.1.0`.
