# Longitudinal observation visualization

Use this skill to show change through time while keeping each unit, observed
time, missing visit, connection rule, comparison basis, and exact value
recoverable.

## Fastest start

1. Read the [skill contract](SKILL.md).
2. Name the followed unit, stable key, time basis, measurement unit, and reader
   question.
3. Run the [follow-the-support exercise](exercises/README.md).
4. Inspect the generated [HTML](exercises/example.html),
   [SVG](exercises/example.svg), and [exact values](exercises/values.csv)
   together.
5. Read [time, paths, and evidence](references/time-paths-and-evidence.md) when
   alignment, annual panels, connected scatter, or summary weighting matters.

## Success example

Two units have irregular visits; one includes an observed zero, one expected
visit is missing, and the final observation is a singleton. Preparation groups
by unit, orders by admitted date, splits the first unit at the expected gap,
draws every observed point, and supplies a native table plus exact CSV. The
figure preserves actual spacing and makes the connection policy visible.

## Recovery example

Two measurements share an unresolved visit time. The point and table view keep
both source records, while their connection remains held. The source or analysis
owner supplies a replicate or tie policy; preparation then rebuilds one detached
ordered view and checks the SVG, HTML, table, and CSV together.

## Package map

- [Skill contract](SKILL.md): identity, support, connection, comparison, and
  preparation rules.
- [Exercise guide](exercises/README.md): command, counterexamples, and visual
  inspection route.
- [Runnable exercise](exercises/exercise.py): deterministic segmentation and
  carrier generation.
- [Source observations](exercises/observations.csv) and
  [expected segments](exercises/expected-segments.json): the independent
  synthetic inputs and oracle.
- [Time, paths, and evidence](references/time-paths-and-evidence.md): source
  lineage, alternatives, and transfer limits.

## Evidence maturity and transfer boundary

`exercised`: the synthetic package establishes its identity, ordering, gap,
zero, singleton, and exact-carrier assertions. Observation cadence,
interpolation, event alignment, estimands, repeated-measure inference, audience
comprehension, and destination accessibility retain their domain and receiver
owners.
