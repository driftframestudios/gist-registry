# Document evidence: recovery state worth carrying forward

A filesystem event can arrive before or after its rename effect. This compact
companion shows how one cooperative writer observes the staged, target, and
prior coordinates, reconciles the state it actually finds, and preserves both
generations when recovery needs re-entry.

The two adjacent excerpts carry distinct parts of that relationship:

1. the transition classifies ambiguous operation events, restores a safe
   state when it can, propagates the original event, and reports typed state
   when recovery stops; and
2. directory and file callers respect the transition's staged-cleanup
   ownership so outer exception handling preserves recovery material.

The complete runnable artifact carries the surrounding carrier adapters,
ownership validation, full recovery helpers, dependency lock, fixtures, and
focused suite:

- [Complete document-evidence artifact](https://kindlight.io/snippets/document-evidence-extraction/0.1.1/)
- [Compact companion manifest](https://kindlight.io/snippets/document-evidence-core-patterns/0.1.1/snippet.json)
- [Earlier same-byte capture pattern](https://kindlight.io/snippets/document-evidence-core-patterns/0.1.0/)

## Operating model and evidence

The selected source assumes one cooperative writer in a trusted parent
directory. Focused tests inject Python events before and after semantic move
effects on real temporary filesystems. They establish restoration, identical
original-event propagation, typed dual-failure reporting, and retained file
and directory stages in the resolved environment.

Static symbolic-link and ownership checks provide momentary observations in
this trusted-parent model; they are not TOCTOU protection. Descriptor-relative
opens, no-follow semantics, and opened-object verification remain the fitting
Unix hardening probe.

Participating writers, process or power-loss durability, descriptor-relative
hardening, same-authority interference, concurrent-reader old-or-new
visibility, and Windows handle parity each call for a separate mechanism and
observation.

## Suggested review

- Which coordinate state shows that an operation took effect before raising?
- Which event remains primary after successful reconciliation?
- Which material stays available when restoration also stops?
- Which layer owns staged cleanup at each return path?

These files form an optional Gist candidate. Human review retains publication
authority; the versioned repository package remains the meaning owner.
