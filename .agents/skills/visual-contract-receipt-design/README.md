# Visual contract receipt design

This skill helps a team choose evidence that directly answers a visual or
interaction question, then keep the result usable across candidate failure and
review.

## Start here

1. Read the [skill contract](SKILL.md).
2. Write the decision and consequence before choosing a screenshot.
3. Run the [decision-to-oracle exercise](exercises/README.md).
4. Read [browser evidence and variance](references/browser-evidence-and-variance.md)
   for Playwright and bitmap work.

## Success example

A select label must remain associated and visible at 320 CSS pixels. A DOM
association assertion protects the accessible name, a geometry assertion
protects clipping, and a bounded screenshot records the relationship for human
review. Controlled missing-label and clipped-bound faults fail their direct
oracles.

## Recovery example

A WebKit bitmap differs while semantics and geometry remain stable. The receipt
classifies an environment variance, keeps the accepted baseline, and routes a
bounded follow-up at the exact browser, OS, font, and scale coordinate.

## Maturity

`exercised`: token compilation, accessible receivers, and deterministic visual
derivatives have produced typed candidate/accepted receipts with direct
oracles, controlled faults, exact coordinates, and recovery points.
