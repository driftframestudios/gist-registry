# Schema nursery

## Most effective first model

The registry schema is a shared envelope around materially different technical
artifacts. The envelope carries what a reader or tool needs to identify,
inspect, execute, verify, project, and recover an artifact. A kind name and
bounded extension block preserve differences among code samples, Practitioner
Probes, prototypes, domain exemplars, experiments, runbooks, loop-bearing
members, and harness material.

This first attempt is informed by the private Practitioner Probe family without
publishing its workspace locators or house annotations. That family contributes
several durable ideas:

- one practical question and the changed ability it seeks;
- a five-level answer or sophistication range when the artifact is a probe;
- technical core, review surfaces, and an instruction yield;
- technical-veracity standing adjacent to claims;
- `TARGET`, `CONTRAST`, and `GUARD` as text-only semantic markers;
- probability-of-what kept separate from any estimate;
- code-exemplar granularity, complexity, and allocation as explicit technical
  judgments;
- references attached to the claims they support; and
- handoff, failure, recovery, and settlement standing.

The first schema does not require every artifact to impersonate a Practitioner
Probe. It exposes reusable `practice` fields and lets later kind-specific
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
9. **Delivery observations** — a separate appendable observation envelope can
   key hosted status, raw and parsed media type, digest, source coordinate, and
   representation path to one immutable artifact-manifest digest. Hosted
   behavior does not mutate a tagged artifact version.
10. **Extensions** — an experimental field can serve a real artifact before it
    is promoted into the shared envelope.

## Version movement

The current experiment is
[`schemas/0.1.0/registry-artifact.schema.json`](schemas/0.1.0/registry-artifact.schema.json).
It is an authored draft identity exercised by the real document-evidence
instance. The Pages builder carries its exact bytes at the canonical
`kindlight.io` path and at the repository-relative path needed by the
byte-identical manifest. A signed-out request will establish hosted delivery;
the local build establishes projection parity.

This `0.1.0` publication exercises retrieval without declaring the envelope
stable. Another materially different artifact can reveal which shared fields
have earned the first stable exact-version contract and immutable schema tag.

An artifact may add information without waiting for a universal schema field.
When two materially different artifacts use the same extension and a reader or
check depends on it, that observation is evidence for promotion. This keeps the
schema responsive to how coding and collaboration actually change.
