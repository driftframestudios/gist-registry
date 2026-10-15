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

## Inputs, defaults and output

Supply the quantity and raw units, observed domain (including signed, zero,
missing, and censored states), prior acquisition/normalization stages, proposed
parameters, and intended comparison. Include the estimate/interval method when
uncertainty is drawn. Begin with a linear view until the reading supplies a
reason for another mapping. An unresolved unit, domain, or analysis transform
holds that stage; retain the admitted values and label the narrower view. The
output names the function, inverse, domain, parameter units, ticks, color policy,
and one derivation shared by the figure and companion.

## Rules

### Rule: Stages retain their meaning and order

Keep raw acquisition, normalization/model transformation, and display mapping
as named stages. Transformation order is consequential; store original and
derived units. An axis transform changes geometry; transforming the array
changes the values supplied to subsequent operations. Apply the intended
transformation once and verify the labels correspond to that stage.

### Rule: Logarithmic reading preserves the positive domain

Linear supports additive reading. A log base greater than one supports ratio
reading on positive values. `log_b(x+c)` changes low-value ratios and depends
on the chosen offset's unit; a pseudocount is an analysis choice with a named
reason and sensitivity check. Preserve zero/missing/censoring distinctions
through a fitting representation rather than replacing them for convenience.

### Rule: Signed values receive an explicit transform

For signed dynamic range, consider linear, facets/separate panels, symlog,
asinh, and a domain-specific transform. Declare the selected mathematical
function, linear/transition parameter, base where applicable, and its units.
Symlog is piecewise and implementation-dependent; its threshold and central
visual width affect interpretation. Asinh provides a smooth transition, with
a declared cofactor or linear-width parameter.

### Rule: Asinh conventions retain their parameters

Distinguish `asinh(x/c)` (dimensionless transformed value) from Matplotlib's
axis transform `c*asinh(x/c)` (raw-value tick labeling). Their coordinates are
proportional at a fixed c; exported values and shared transformed domains
differ. Matplotlib's asinh `base` rounds tick locations rather than choosing
a new logarithm in the mapping. Record installed API/version when relevant.

### Rule: Assay semantics govern negative values

A compensated fluorescence value can legitimately be negative. A suitable
signed transform preserves those measurements; logicle, biexponential, and
asinh are distinct methods. Name the chosen domain method and parameters.

### Rule: Position and color have distinct mappings

Separate position scales from color normalization. Use a common color domain
for cross-panel magnitude comparison; a meaningful reference supplies a
diverging midpoint. Preserve clipped over/under states and missing status.

### Rule: Intervals preserve endpoints and inferential meaning

Transform interval endpoints through the same monotone mapping as their
estimate. State whether the interval is observation spread, a confidence,
credible, prediction, bootstrap, or sensitivity interval. The transform
preserves endpoints; it supplies neither a new inferential model nor symmetric
error lengths in transformed space. Report the independent-unit support.

### Rule: Density names its measure

Specify the measure of histogram/density height: count, probability mass, or
density per raw/transformed unit. Changing bin coordinates changes widths and
density meaning; exact bin mass remains recoverable. Recompute density under
the intended measure instead of relabeling an old ordinate.

### Rule: Numerical proof names its finite domain

Verify domain admission, finite arithmetic, monotonicity, forward/inverse
agreement, important anchors, boundary values, and representation agreement.
State numerical tolerance and finite test domain; production-scale overflow
or performance claims need the receiving implementation's own evidence.

## Operating sequence

1. **Admit:** Establish quantity, units, domain states, prior stages, and the receiving question.
2. **Compare:** Consider three to five fitting mappings or separate views; name the fact that selects one.
3. **Specify:** Record function, inverse, parameters, valid domain, units, interval meaning, and tick/color rules.
4. **Derive:** Prepare one admitted value/transform path for marks, companion, and export.
5. **Challenge:** Verify anchors, sign/zero boundaries, monotonicity, inverse agreement, and interval endpoints within a stated numerical domain.
6. **Observe:** Inspect the scale at receiving size and return its evidence plus the remaining scientific decision.

## Decisive scenarios

### Scenario: A signed quantity changes unit

- Given a figure uses `asinh(x/c)` with x and c in the same unit
- When the source converts x to another unit
- Then the scale owner converts c consistently before recomputing the mapping
- And the semantic check confirms unchanged dimensionless coordinates for the same measurements

### Scenario: An interval crosses the logarithm's domain boundary

- Given an estimate's admitted interval includes zero or a negative endpoint
- When a positive log view is proposed
- Then a supported linear or signed view retains the interval and its scientific meaning
- And any censoring or alternate model returns to the analysis owner before the figure changes that claim

## Conditional context

- [Signed and logarithmic transforms](references/signed-and-logarithmic-transforms.md) supplies the detailed decisions and counterexamples for that branch.
- [Intervals colors and density](references/intervals-colors-and-density.md) supplies the detailed decisions and counterexamples for that branch.
- [Evidence and exercises](references/evidence-and-exercises.md) names primary
  sources, alternatives, method lineage, and the runnable synthetic proof.

## Recovery and re-entry

Preserve raw values, prior stage definitions, and the last accepted figure.
A domain or unit conflict returns to its measurement/analysis owner; a finite
arithmetic failure returns to the transform implementation with the failing
boundary and declared tolerance. Keep a supported linear or separated view
while that decision rests. Renew the numerical checks and all carriers after
parameters or stage order change.

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
