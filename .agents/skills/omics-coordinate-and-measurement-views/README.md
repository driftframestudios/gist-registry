# Omics coordinate and measurement views

Use this skill to prepare omics matrices and genomic tracks whose sample and
feature identities, coordinate frame, assay quantities, replicate support,
missing states, and uncertainty remain recoverable from the figure.

## Fastest start

1. Read the [skill contract](SKILL.md).
2. Name the assay question, observation unit, independent experimental unit,
   stable identities, quantity, and reference coordinate where applicable.
3. Run the [synthetic verification](exercises/verify.py) with Python 3.12 or
   newer.
4. Use [evidence and exercises](references/evidence-and-exercises.md) to select
   the relevant source-backed checks.
5. Open the [track](references/genomic-coordinates-and-tracks.md) or
   [matrix and inference](references/assay-matrices-and-inference.md) branch only
   when the receiving figure needs it.

## Success example

A heatmap receives matrix columns and reversed metadata records. Stable sample
identities restore the intended order, donor and batch labels follow the
realized columns, raw values remain available, proportional rows reveal equal
row z-score patterns at tenfold different amounts, and a constant row receives
an explicit undefined-scale state. The SVG and CSV companions preserve those
relationships.

## Recovery example

Two genomic tracks use different assemblies. Each retains its original
assembly, interval convention, and unmapped state while the shared overlay stays
held. The reference owner supplies an admitted mapping with ambiguous and
unmapped outcomes; the receiver repeats endpoint, identity, and companion
checks before composing the overlay.

## Package map

- [Skill contract](SKILL.md): shared admission and composition sequence.
- [Synthetic verification](exercises/verify.py): ordinary interval endpoints,
  sample joins, weighting, row scaling, confounding, and measurement states.
- [Evidence and exercises](references/evidence-and-exercises.md): primary
  sources, exact exercised scope, and method lineage.
- [Genomic coordinates and tracks](references/genomic-coordinates-and-tracks.md):
  assemblies, interval semantics, variants, and track scale.
- [Assay matrices and inference](references/assay-matrices-and-inference.md):
  joins, normalization, support, missingness, batch, and effect views.

## Evidence maturity and transfer boundary

`research-informed and synthetically exercised`: the included verifier
establishes its authored identities, arithmetic, ordinary interval subset, and
output structure. Assay suitability, mature format parsing, biological
inference, mapping policy, thresholds, production scale, audience comprehension,
and release authority remain with their scientific, platform, and receiving
owners.
