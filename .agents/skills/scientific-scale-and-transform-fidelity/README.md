# Scientific scale and transform fidelity

Use this skill when a numeric display transform could change the scientific
reading. It keeps domain, parameters, units, ticks, color, intervals, and exact
values aligned across linear, logarithmic, symlog, asinh, normalized, and
other declared mappings.

## Fastest start

1. Read the [skill contract](SKILL.md).
2. Supply raw units, observed domain, zero/missing/censored states, earlier
   normalization, uncertainty method, and intended comparison.
3. Begin with a linear view and state the reading that motivates any alternate
   transform.
4. Write the forward function, inverse, parameter units, tick policy, and
   exact-value companion before rendering.
5. Run `python3 exercises/verify.py` for the synthetic transform checks.

Example request:

> Use `$scientific-scale-and-transform-fidelity` to compare linear, symlog, and
> asinh routes for these signed values. Declare every parameter and preserve
> zeros, missing values, raw units, and interval meaning.

## Success example

A signed wide-range display uses a declared asinh mapping with a named cofactor
in raw-value units. Tick labels remain in raw units, the colorbar uses the same
domain and function, and a companion table provides original values and
interval endpoints. A focused check exercises the forward/inverse relation and
the rendered tick locations.

## Recovery example

A reviewer discovers that an array was log-transformed before a second
logarithmic axis mapping. The team retains the raw values, removes the duplicate
stage, rebuilds all carriers from the corrected derivation, and repeats the
numeric and rendered observations. The affected transform stage reopens while
the admitted source remains available.

## Package map

- [Skill contract](SKILL.md): transform selection, disclosure, and completion.
- [Signed and logarithmic transforms](references/signed-and-logarithmic-transforms.md):
  formulas, parameters, conventions, and counterexamples.
- [Intervals, colors, and density](references/intervals-colors-and-density.md):
  interval geometry, color domains, normalization, and dense views.
- [Evidence and exercises](references/evidence-and-exercises.md): primary
  sources, limitations, and the synthetic proof.
- [`exercises/verify.py`](exercises/verify.py): runnable assertions for the
  included transform cases.

## Maturity and transfer boundary

This package is a research-informed transform contract with synthetic numeric
checks. Those checks establish their declared functions and example outputs.
Source normalization, model validity, assay interpretation, reader
comprehension, and publication acceptance remain with their named domain and
receiving owners.
