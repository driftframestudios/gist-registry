---
name: scientific-scale-and-transform-fidelity
description: Selects and verifies scientific numeric display transformations while preserving domain, parameters, units, values, and uncertainty. Applies when wide dynamic range, signed values, zeros, normalization, transformed axes or colors, and interval geometry can change a reading.
---

# Scientific scale and transform fidelity

## Contract

- **What:** Selects and proves a numeric display transformation while keeping
its domain, parameters, units, values, and uncertainty interpretable.

- **When:** Wide dynamic range, signed values, zeros, pseudocounts, normalized
heatmaps, transformed axes/color, or transformed intervals can change a reading.

- **Result:** A named transform pipeline and a rendered scale whose
values, ticks, colorbar, companion, and disclosure agree.

- **Boundaries:** A mathematically smooth scale supplies no assurance of
correct normalization, valid inference, or audience comprehension. A neutral
linear view can remain the best fit. No universal pseudocount, asinh cofactor,
symlog threshold, imputation, or batch correction follows from this skill.
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

- Keep raw acquisition, normalization/model transformation, and display mapping
  as named stages. Transformation order is consequential; store original and
  derived units. An axis transform changes geometry; transforming the array
  changes the values supplied to subsequent operations. Apply the intended
  transformation once and verify the labels correspond to that stage.
- Linear supports additive reading. A log base greater than one supports ratio
  reading on positive values. `log_b(x+c)` changes low-value ratios and depends
  on the chosen offset's unit; a pseudocount is an analysis choice with a named
  reason and sensitivity check. Preserve zero/missing/censoring distinctions
  through a fitting representation rather than replacing them for convenience.
- For signed dynamic range, consider linear, facets/separate panels, symlog,
  asinh, and a domain-specific transform. Declare the selected mathematical
  function, linear/transition parameter, base where applicable, and its units.
  Symlog is piecewise and implementation-dependent; its threshold and central
  visual width affect interpretation. Asinh provides a smooth transition, with
  a declared cofactor or linear-width parameter.
- Distinguish `asinh(x/c)` (dimensionless transformed value) from Matplotlib's
  axis transform `c*asinh(x/c)` (raw-value tick labeling). Their coordinates are
  proportional at a fixed c; exported values and shared transformed domains
  differ. Matplotlib's asinh `base` rounds tick locations rather than choosing
  a new logarithm in the mapping. Record installed API/version when relevant.
- A compensated fluorescence value can legitimately be negative. A suitable
  signed transform preserves those measurements; logicle, biexponential, and
  asinh are distinct methods. Name the chosen domain method and parameters.
- Separate position scales from color normalization. Use a common color domain
  for cross-panel magnitude comparison; a meaningful reference supplies a
  diverging midpoint. Preserve clipped over/under states and missing status.
- Transform interval endpoints through the same monotone mapping as their
  estimate. State whether the interval is observation spread, a confidence,
  credible, prediction, bootstrap, or sensitivity interval. The transform
  preserves endpoints; it supplies neither a new inferential model nor symmetric
  error lengths in transformed space. Report the independent-unit support.
- Specify the measure of histogram/density height: count, probability mass, or
  density per raw/transformed unit. Changing bin coordinates changes widths and
  density meaning; exact bin mass remains recoverable. Recompute density under
  the intended measure instead of relabeling an old ordinate.
- Verify domain admission, finite arithmetic, monotonicity, forward/inverse
  agreement, important anchors, boundary values, and representation agreement.
  State numerical tolerance and finite test domain; production-scale overflow
  or performance claims need the receiving implementation's own evidence.

## Conditional context

- [Signed and logarithmic transforms](references/signed-and-logarithmic-transforms.md) supplies the detailed decisions and counterexamples for that branch.
- [Intervals colors and density](references/intervals-colors-and-density.md) supplies the detailed decisions and counterexamples for that branch.
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
