# Spatial support, alternatives, and evidence

Sources inspected 2026-10-15. Guidance below translates named evidence into
bounded local decisions; source authority and skill authority remain distinct.

## Five routes

| Route | Deciding question | Cost or boundary |
| --- | --- | --- |
| Shared-scale year maps | Where did the spatial pattern change? | Panel space; stable geography and classification. |
| Map plus location histories | How did selected places change? | Coherent selection and time basis across views. |
| Location-time matrix/ordinary panels | Which values, ranks, or histories differ? | Geographic topology becomes a companion. |
| Identity-scoped dated trajectories | Where were tracked units observed? | Connection is distinct from measured route and speed. |
| Animation or space-time cube | Does motion/tracking reveal the target pattern? | Interaction, occlusion, temporal memory, and actual task evidence. |

Select the route from spatial and temporal granularity. A map earns its geometry
through a geographic reading. Complementary views earn space by answering a
different consequential question on the same admitted records.

## Source → rule → observable proof

- Official [ONS choropleth guidance](https://service-manual.ons.gov.uk/data-visualisation/chart-types/choropleth-maps) favors geographic-pattern questions and standardized areal measures; a small category comparison may suit a bar/dot chart. **Rule:** choose support and denominator before color. **Proof:** the exercise maps 10/100 to 10% and 20/1000 to 2% while retaining counts. The domain supplies the appropriate exposure; population is one possibility.
- [Census boundary guidance](https://www.census.gov/programs-surveys/acs/geography-acs/geography-boundaries-by-year.html) and its [geography handbook](https://www.census.gov/content/dam/Census/library/publications/2020/acs/acs_geography_handbook_2020_ch02.pdf) explain geographic vintages and changes. **Supported inference:** matching IDs alone establish insufficient evidence for equal support. **Proof:** the exercise holds a same-ID/different-vintage comparison until its geography owner supplies a common basis. This inference transfers the comparability problem beyond Census data.
- [RFC 7946 §3.1.1](https://www.rfc-editor.org/rfc/rfc7946.html#section-3.1.1) specifies coordinate order and Cartesian line semantics distinct from geodesics; timestamp dimensions beyond the defined coordinate tuple have unspecified meaning. **Rule:** carry time separately and declare trajectory interpolation/projection. **Proof:** the exercise identifies an antimeridian case for a geographic implementation; its schematic map makes no geographic-distance claim. A real geospatial receiver must execute its own projection/discontinuity checks.
- [Peña-Araya, Pietriga and Bezerianos, 2019](https://arxiv.org/html/1907.06399v2) compares spatial/temporal juxtaposition for bivariate geo-temporal correlation tasks. **Rule:** choose panels or local histories according to task granularity. **Proof:** the exercise's two year panels retain one common value mapping. Its scalar rate example does not replicate that correlation experiment.
- [Robertson et al., 2008](https://www.microsoft.com/en-us/research/publication/effectiveness-of-animation-in-trend-visualization/) found advantages for static alternatives in its trend-analysis tasks. [Griffin et al., 2006](https://doi.org/10.1111/j.1467-8306.2006.00514.x) found animation advantages for identifying moving spatial clusters. [Brehmer et al., 2019](https://arxiv.org/abs/1907.03919) found task-dependent mobile accuracy. **Rule:** retain animation as a conditional route and test the actual operation. **Counterexample:** success at moving-cluster tracking does not establish superior exact between-year comparison. The static exercise supplies no empirical animation ranking.

## Counterexamples and recovery

Per-year quantile colors can change even when a region's value stays fixed.
Counts can increase while rates fall. A zero and an empty denominator can share
a color if absence is discarded too early. A same-named area can change shape.
Two distant sampled positions can imply an unobserved route. Retain original
records and use a table, point view, or clearly labeled distinct vintages until
the required classification, interpolation, or common-geography decision exists.

The HASE [Visualization Fidelity Atlas](https://github.com/driftframestudios/human-ai-systems-exemplars/blob/main/context-canvas-project-surface/context-canvas/visualization-fidelity-atlas.html)
supplies the cognitive-move/evidence-companion lineage. This complete local
package adds spatial support and comparison ownership; scientific validity,
map projection correctness, and broad reader effectiveness retain their own
observations.
