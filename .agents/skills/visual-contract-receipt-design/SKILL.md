---
name: visual-contract-receipt-design
description: Selects semantic, interaction, geometry, computed-style, and bitmap evidence for a visual-contract decision, proves each oracle with a controlled fault, and publishes recoverable candidate and accepted receipts.
---

# Visual contract receipt design

## Contract

- **What:** A decision-led evidence plan and versioned receipt for visual and
  interaction behavior.
- **When:** A browser, component, SVG, responsive layout, token application, or
  visual regression needs evidence stronger than a broad screenshot diff.
- **Boundaries:** Each oracle establishes its named behavior at one exact
  environment coordinate. Product meaning and release acceptance remain with
  their owners.
- **Result:** Every material assertion names its decision, plausible fault,
  strongest fitting oracle, consequence, environment, and recovery action.

## Evidence selection

Prefer the most direct signal:

| Decision | Leading evidence |
| --- | --- |
| Name, relationship, order, disclosure, state | DOM and accessibility assertions |
| Focus, keyboard, pointer, touch, async settlement | Interaction assertions |
| Overlap, clipping, hit target, seam, painter order | Focused geometry assertions |
| Semantic token applied to a state | Computed-style assertion |
| Texture, rendering relationship, or bounded appearance | Cropped bitmap comparison |

Combine signals when a consequence crosses boundaries. A bitmap can provide a
useful visual receipt while semantic and geometry assertions retain direct
diagnostic ownership.

## Rules

### Decision, fault, oracle, and consequence travel together

For every assertion record the protected decision, behavior, plausible defect,
selected oracle, user or system consequence, exact environment, and restart or
promotion move. This makes removal, replacement, and failure interpretation
reviewable.

### Controlled faults prove the oracle

Introduce one bounded mutation that should fail for the intended reason. Use a
missing label, stale state, clipped bound, changed computed token, or shifted
bitmap region according to the evidence class. Restore accepted source after
the test.

### Environment coordinates bound visual claims

Record browser engine and binary, operating system, architecture, fonts,
viewport, device scale, media features, runtime, Playwright coordinate, and
source/receiver digests. Treat cross-coordinate pixel differences as a new
observation until classified.

### Variance receives a named class

Classify a difference as contract change, deterministic implementation change,
declared engine/platform variance, environmental drift, harness fault, or
unresolved bounded follow-up. Record the signal supporting that class.

### Candidate receipts preserve accepted evidence

Build into a candidate directory. Verify schema, completeness, containment,
artifact digests, and human companion before moving one accepted pointer. A
failed or interrupted candidate leaves the accepted receipt serviceable and
returns its durable checkpoint.

### Coverage follows changed boundaries

Maintain three finite tiers:

- smoke checks the critical route and harness health;
- changed-boundary checks every decision touched by the diff; and
- full acceptance checks the declared release matrix.

Record the signal and inventory that selected the tier. Expected work is the
finite product of targets, states, browsers, media variants, and selected
oracles.

## Operating sequence

1. Inventory decisions and consequences.
2. Map one plausible fault and strongest direct oracle to each decision.
3. Declare targets, states, browser/media coordinates, artifacts, and budgets.
4. Run the selected tier and capture normalized results.
5. Exercise one controlled fault per material evidence class.
6. Classify differences and route repairs to the nearest owner.
7. Verify candidate receipt and human companion.
8. Promote one accepted pointer or return the durable checkpoint.

## Conditional context

Read [browser evidence and variance](references/browser-evidence-and-variance.md)
when Playwright, WebKit, bitmap baselines, fonts, or matrix tiers affect the
decision. Use the [decision-to-oracle exercise](exercises/README.md) to test one
complete evidence inventory.

## Completion

The receipt is ready when each assertion protects a named decision, its fault
fails the intended oracle, the environment is exact, artifacts are contained
and digest-bound, and accepted evidence survives candidate failure. A changed
decision, engine, OS, font, scale, tool version, or unresolved variance opens a
new coordinate.
