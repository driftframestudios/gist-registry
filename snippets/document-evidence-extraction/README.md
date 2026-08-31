# Document evidence extraction

Accepted baseline: [`0.1.0`](0.1.0/README.md).

Registry successor with `candidate` maturity:
[`0.1.1`](0.1.1/README.md).

This artifact reconstructs a four-stage 2018–2019 workflow from a
participant-account-supported description using realistic synthetic material.
It is a portable implementation example, not recovered production source.

Earlier accepted versions will remain at their exact versioned paths. The
registry record identifies the current accepted coordinate after human review.

## Why this family matters

This is the first concrete collaboration that made the registry's purpose
legible. A useful implementation became a stable accepted coordinate; bounded
architectural vantages then clarified its operating model, current guarantee,
test architecture, and successor questions. The accepted form stays available
while Issue #2 carries the materially stronger path through `0.1.1`. The
accepted [compact companion](../document-evidence-core-patterns/README.md)
keeps exact excerpts available at the `0.1.0` evidence boundary.

The `0.1.0` tests establish deterministic evidence analysis and one
injected `OSError` restoration case for staged promotion under cooperative
single-writer use. The `0.1.1` candidate receives the declared writer model,
one shared directory/file transition, Python-event interruption and
dual-failure recovery, and the focused tests that bound those guarantees.
Descriptor-bound verification, participating-writer coordination, restart
durability, and platform-specific hardening retain distinct future probes.
Source acceptance and the manifest's candidate maturity remain separately
legible as the Issue advances.

## Continuation

- **Standing:** `interstitial`
- **Accepted baseline:**
  [`document-evidence-extraction@0.1.0`](0.1.0/)
- **Registry successor:** [`document-evidence-extraction@0.1.1`](0.1.1/), with
  `candidate` maturity recorded in its manifest
- **Re-entry:** Use Issue #2 to settle source reception and maturity. The
  matching compact companion derives from an accepted successor source.
