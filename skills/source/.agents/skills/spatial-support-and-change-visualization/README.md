# Spatial support and change visualization

Use this skill to make spatial comparisons faithful to the geographic support,
measurement process, denominator, and time basis behind each value. It helps
separate repeated observations of the same region from changing boundaries,
changing membership, and unmatched populations.

## Fastest start

1. Read the [skill contract](SKILL.md).
2. Supply the comparison question, region identity, support geometry,
   denominator, value units, time basis, and meaningful missing states.
3. Classify each comparison as stable support, crosswalked support, boundary
   change, or unmatched scope before selecting a visual form.
4. Keep map, table, annotations, and exact-value companion on one admitted
   comparison state.
5. From this skill directory, run `python3 exercises/exercise.py --check` and
   open `exercises/example.html` to inspect the included carriers.

Example request:

> Use `$spatial-support-and-change-visualization` to compare these regional
> rates across two years. Identify boundary changes, retain denominators and
> unavailable values, and provide an exact-value table beside the map.

## Success example

Two annual rates share stable region boundaries and compatible denominators.
The map uses one declared scale, the table preserves exact values and counts,
and annotations identify the measurement period. A separate comparison marks
crosswalked regions and describes the crosswalk's standing.

## Recovery example

A boundary revision splits one earlier region into three later regions. The
team retains both source geometries, withdraws the direct change encoding for
that unit, and presents the supported annual distributions while the source
owner supplies an accepted crosswalk. Re-entry begins at support admission,
then refreshes calculations and carriers from the same admitted state.

## Package map

- [Skill contract](SKILL.md): support classes, visualization rules, and
  completion.
- [Support and evidence](references/support-and-evidence.md): geography,
  crosswalks, denominators, uncertainty, and evidence limits.
- [Exercise guide](exercises/README.md): inputs, commands, assertions, and
  interpretation.
- [`exercise.py`](exercises/exercise.py): generates and checks the synthetic
  comparison.
- [`regions.csv`](exercises/regions.csv), [`values.csv`](exercises/values.csv),
  and [`comparisons.json`](exercises/comparisons.json): admitted exercise data.
- [`example.svg`](exercises/example.svg) and
  [`example.html`](exercises/example.html): vector and browser carriers.

## Maturity and transfer boundary

This package is a research-informed spatial contract with authored synthetic
data and runnable assertions. The exercise establishes its declared identities,
support classifications, and carrier agreement. Geographic provenance,
crosswalk validity, domain inference, reader comprehension, accessibility, and
publication acceptance retain their own evidence and owners.
