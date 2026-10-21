# Scientific figure composition

Use this skill to turn a correct plot into a coherent paper, report, slide,
poster, or web figure. It connects the reader's question to panel geometry,
type hierarchy, semantic color, exact-value recovery, and inspection at the
actual receiving size.

## Fastest start

1. Read the [skill contract](SKILL.md).
2. Supply the admitted values, primary reading, units, interval meaning,
   destination, placed size, and longest or densest states.
3. Choose a reading sequence and assign each panel a specific role.
4. Render from one admitted value source and inspect the real destination size.
5. Run `python3 exercises/verify.py` for the synthetic package proof.

Example request:

> Use `$scientific-figure-composition` to compose this estimate-and-interval
> figure for a 90 mm report column. Preserve exact values in a companion table
> and inspect the longest labels at placed size.

## Success example

A four-panel result uses shared scales only for quantities that support direct
comparison. The main finding appears first, uncertainty remains visible, and
the dense panel receives enough area for its labels. The raster and vector
deliveries derive from the same admitted values, while a table preserves exact
numbers for recovery.

## Recovery example

A figure that read clearly at 180 mm becomes crowded at its 90 mm placement.
The composition owner retains the admitted values and accepted source, revises
panel arrangement and type hierarchy, then inspects the new render at 90 mm.
Scientific derivation stays with its source owner; destination geometry returns
to the composition step.

## Package map

- [Skill contract](SKILL.md): composition rules, sequence, and evidence
  boundary.
- [Panel, type, color, and emphasis](references/panel-type-color-and-emphasis.md):
  hierarchy, palette, annotation, and counterexamples.
- [Delivery and inspection](references/delivery-and-inspection.md): final-size,
  carrier, export, and accessibility checks.
- [Evidence and exercises](references/evidence-and-exercises.md): sources,
  alternatives, synthetic proof, and exercise interpretation.
- [`exercises/verify.py`](exercises/verify.py): runnable checks for the included
  synthetic figure decisions.

## Maturity and transfer boundary

This is a research-informed instruction contract with authored synthetic
checks. Those checks establish their named geometry and semantic assertions.
Independent scientific review, audience comprehension, assay suitability,
accessibility, and destination acceptance retain their own observations and
owners.
