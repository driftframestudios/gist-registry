# Document evidence core patterns 0.1.1

This compact companion makes the accepted recovery architecture easy to
inspect: semantic filesystem operations are classified by observed coordinate
state, and callers preserve staged material when promotion transfers cleanup
authority to recovery.

## Reading order

1. [`gist/00-README.md`](gist/00-README.md) names the operating model and
   evidence boundary.
2. [`gist/10-observed-effect-reconciliation.md`](gist/10-observed-effect-reconciliation.md)
   maps ambiguous rename events to observed state, original-event propagation,
   and typed re-entry state.
3. [`gist/20-caller-retained-recovery.md`](gist/20-caller-retained-recovery.md)
   shows directory and file callers preserving staged successors after dual
   failure.

The [complete versioned artifact](../../document-evidence-extraction/0.1.1/)
owns the runnable transition, carrier adapters, dependency lock, fixtures, and
full focused suite. The prior
[`document-evidence-core-patterns@0.1.0`](../0.1.0/) remains the compact source
for the unchanged same-byte capture pattern. This successor selects only the
material recovery change.

## Source and evidence map

| Companion | Complete source | Focused evidence |
| --- | --- | --- |
| Observed-effect reconciliation | `src/filesystem_promotion.py::PromotionOperation`, `PromotionState`, `PromotionRecoveryError`, observation and event-retention helpers, `_reconcile_activation_event`, `promote_staged` | `test_activation_post_effect_event_reverses_successor_before_restoration`, `test_dual_failure_retains_both_causes_and_generations` |
| Caller-retained recovery | cleanup branches inside `src/document_evidence.py::analyze_capture`, `collect_ocr` | `test_analysis_dual_failure_retains_both_generations_for_reentry`, `test_collection_dual_failure_retains_both_generations_for_reentry` |

The focused tests establish pre-effect and post-effect Python-event recovery
on real temporary filesystems in the resolved environment. The operating
model contains one cooperative writer and a trusted parent directory. Broader
writer coordination, restart and power-loss durability, descriptor hardening,
same-authority resistance, concurrent-reader old-or-new visibility, and
Windows handle parity retain separate probes.

Static symbolic-link and ownership checks provide momentary observations
inside that trusted-parent model; they are not TOCTOU protection.
Descriptor-relative opens, no-follow semantics, and opened-object verification
remain the fitting Unix hardening probe.

## Gist publication boundary

The three ordered files in `gist/` are the complete optional Gist candidate.
Human review retains the publication decision. After publication, an exact
Gist revision and content digests can identify that convenience projection;
this versioned repository package continues to own its meaning.
