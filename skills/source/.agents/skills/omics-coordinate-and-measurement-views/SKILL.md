---
name: omics-coordinate-and-measurement-views
description: Prepares omics matrices and genomic tracks whose feature/sample identity, reference coordinates, assay quantities, replicate support, and uncertainty remain recoverable. Applies when omics figures join metadata, combine genomic tracks, compare samples or cell groups, or display assay effects.
---

# Omics coordinate and measurement views

## Contract

- **What:** Prepares omics matrices, genomic tracks, and associated figures
whose feature/sample identity, coordinate frame, assay quantity, replicate
support, and uncertainty remain recoverable.

- **When:** A figure joins an assay matrix to metadata, combines genomic tracks,
compares samples or cell groups, colors an embedding, or presents omics effects.

- **Result:** A small source/measurement contract, selected view, exact
value/identity companion, and proof of the consequential joins or conversions.
Assay analysis and biological interpretation retain their scientific owners.

- **Boundaries:** This contract does not become a BAM/VCF parser, an alignment
or variant-calling workflow, a batch-correction recommendation engine, a
biomarker validation route, or a biological inference authority. A receiver can
narrow to a static matrix and stop after the applicable identity/value checks.
- **Interactions:** A settled reader question and view contract supply the input.
  `visualization-question-routing` can help select that contract; direct
  reasoning is sufficient when it is already clear. The domain, scale, and
  composition skills each own their named result and can be used separately.

## Fit and recovery

Use the smallest branch that changes the receiving figure. Existing source,
analysis, rendering, and document owners retain their roles. Supply the figure's
question, source/quantity, relevant parameters, and delivery target in ordinary
prose; a new manifest is optional. A missing identity, unit, model assumption,
or publication grant becomes a named held decision with a useful descriptive
view or narrower admitted subset where fitting. Resume when that owner supplies
the missing input.

## Rules

- Identify observation unit and independent experimental unit separately:
  reads/fragments, cells, specimens, donors, technical runs, and biological
  replicates serve different counts. Carry pairing and nested identities into
  summaries. Show support at the level used by the estimate/interval.
- Join sample metadata and matrix columns by admitted stable identities, with
  cardinality and missing/duplicate policy. Preserve feature identifiers and
  annotation version; a displayed gene symbol is a label, and may be ambiguous.
- Name the assay quantity: raw or estimated count, normalized abundance,
  fragment coverage, intensity, concentration, ratio, residual, fold change, or
  detection fraction. A shared numeric matrix shape supplies no unit agreement.
- Preserve measured zero, undetected, below a stated limit, missing, filtered,
  imputed, and structurally inapplicable states. Choose imputation or censoring
  models through the analysis owner; the renderer carries that decision visibly.
- Genomic views bind assembly/reference identity, sequence identifiers, interval
  convention, strand, and feature type. Ordinary nonempty BED intervals `[s,e)`
  convert to one-based closed `[s+1,e]`; insertion sites, breakends, circular
  references, and liftover require their own semantics. Negative strand changes
  orientation and feature interpretation; it does not universally reverse stored
  start/end order. Restrict overlays to an admitted common reference or show the
  mapping result and unmapped/ambiguous features explicitly.
- Tracks name coverage/score meaning, normalization, bin width, aggregation, and
  y-domain. Compare absolute amplitude under a common y-domain; allow independent
  domains for within-track shape when each domain is visible. A zoomed overview
  may aggregate features; detail/export retains the declared resolution and
  identity boundary.
- Heatmaps carry row/column meaning, selected feature rule, transformation order,
  color scale, clustering distance/linkage, missing policy, and realized order.
  A row z-score shows within-feature deviation: equal colors across rows do not
  establish equal abundance. Constant rows receive an explicit undefined-scale
  treatment. Multi-omics panels share admitted sample identity while preserving
  assay-specific scales. Annotation rows follow the realized column permutation.
- Batch views preserve batch and biological labels before/after integration.
  Evaluate technical mixing and retained biological distinctions separately.
  Perfect batch/condition confounding yields an identifiability gap for that
  contrast, with descriptive views still available. Attractive embedding overlap
  cannot establish correction validity; analysis-ready matrices and embeddings
  have distinct downstream roles.
- Effect/significance views retain effect definition, estimate/shrinkage method,
  uncertainty, tested family, adjustment method, excluded/untested features, and
  threshold owner. A threshold-colored volcano plot is a reading aid; the
  analysis supplies the inferential claim. Rounded or underflowed zero p-values
  need a named bound/clipping representation rather than fabricated precision.

## Conditional context

- [Genomic coordinates and tracks](references/genomic-coordinates-and-tracks.md) supplies the detailed decisions and counterexamples for that branch.
- [Assay matrices and inference](references/assay-matrices-and-inference.md) supplies the detailed decisions and counterexamples for that branch.
- [Evidence and exercises](references/evidence-and-exercises.md) names primary
  sources, alternatives, method lineage, and the runnable synthetic proof.

## Completion and evidence

The receiving figure and companion agree on the admitted meaning. The changed
boundaries have proportionate semantic checks and, for an actual figure, a
rendered observation at its receiving size. Return the choice, relevant source,
observed behavior, coverage boundary, and any remaining scientific or delivery
decision in the existing work record.

This package is a research-informed instruction contract with authored synthetic
exercises. Running an exercise establishes its explicit assertions and outputs;
independent review, audience comprehension, assay suitability, accessibility,
and cross-context effectiveness retain their own observations.
