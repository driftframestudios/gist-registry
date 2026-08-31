# Document evidence extraction

Accepted baseline: [`0.1.0`](0.1.0/README.md).

Accepted successor: [`0.1.1`](0.1.1/README.md). Its exact manifest records
`candidate` maturity, separately from source acceptance and the immutable tag.

This artifact reconstructs a four-stage 2018–2019 workflow from a
participant-account-supported description using realistic synthetic material.
It is a portable implementation example, not recovered production source.

Earlier accepted versions will remain at their exact versioned paths. The
registry record identifies the current accepted coordinate after human review.

## Why this family matters

This is the first concrete collaboration that made the registry's purpose
legible. A useful implementation became a stable accepted coordinate; bounded
architectural vantages then clarified its operating model, current guarantee,
test architecture, and successor questions. Both accepted forms stay available
at immutable coordinates. The [compact companion
family](../document-evidence-core-patterns/README.md) keeps exact excerpts
available at the `0.1.0` and `0.1.1` evidence boundaries.

The `0.1.0` tests establish deterministic evidence analysis and one injected
`OSError` restoration case for staged promotion under cooperative single-writer
use. The accepted `0.1.1` successor carries the declared writer model, one
shared directory/file transition, Python-event interruption and dual-failure
recovery, and the focused tests that bound those guarantees.
Descriptor-bound verification, participating-writer coordination, restart
durability, and platform-specific hardening retain distinct future probes.
Source acceptance, manifest maturity, immutable tagging, and publication remain
separately legible.

## Continuation

- **Standing:** `settled`
- **Current form:** [`document-evidence-extraction@0.1.1`](0.1.1/)
- **Present use:** The accepted successor supplies the complete runnable source
  and focused evidence for trusted-parent, cooperative-writer promotion across
  file and directory carriers. Broader writer, durability, descriptor, reader,
  and platform models retain their named probes.
