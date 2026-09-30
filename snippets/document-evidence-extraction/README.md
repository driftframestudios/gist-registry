# Document evidence extraction

This artifact reconstructs a four-stage 2018–2019 workflow from a
participant-account-supported description using realistic synthetic material.
It is a portable implementation example, not recovered production source.

## Current state

| Axis | Standing | Meaning |
| --- | --- | --- |
| Registry acceptance | `0.1.0` and `0.1.1` accepted | Both exact versions are registered; their immutable tags preserve the reviewed coordinates |
| Manifest maturity | `candidate` | Each exact `snippet.json` records the evidence maturity of its own version |
| Continuation | `settled` | `0.1.1` supplies the current runnable form at its stated writer and recovery boundary |
| Publication | Pages projected | Both accepted versions are publicly retrievable; optional Gist creation remains a separate human-held action |

**Current coordinate:**
[`document-evidence-extraction@0.1.1`](0.1.1/README.md). The
[`0.1.0` baseline](0.1.0/README.md) remains available at its exact accepted
coordinate.

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

## Next evidence-bearing route

The accepted successor supplies complete runnable source and focused evidence
for trusted-parent, cooperative-writer promotion across file and directory
carriers. Broader writer, durability, descriptor, reader, and platform models
retain their named probes and can form a successor when one of those models
changes the demonstrated guarantee.
