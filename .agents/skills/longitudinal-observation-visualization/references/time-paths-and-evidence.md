# Time, paths, and evidence

Sources inspected 2026-10-15. Official mechanics, experimental findings, and
local design translations retain distinct standing.

## Four routes and the deciding fact

| Route | Use when | Consequence |
| --- | --- | --- |
| Actual-time points | Observed support is the primary claim | Sparse values remain explicit; following one unit may need identity labels. |
| Points with scoped segments or steps | Endpoint relation or held state matters | Connection and interpolation semantics need an owner. |
| Unit/year panels or seasonal overlays | Individual histories or recurring phases need comparison | Shared scales, phase definition, and partial coverage travel with each panel. |
| Summary/distribution with raw support | Many units make an overview useful | Estimand, membership, observation frequency, and uncertainty need explicit definitions. |

The selected starting point is visible observations at admitted times. Add only
the relation needed by the question. With time as a condition, annual panels can
instead show x–y associations; the question router owns that decision. With time
ordering a connected scatter, retain temporal direction even when x decreases.

## Source → rule → observable proof

- [ONS line guidance](https://service-manual.ons.gov.uk/data-visualisation/chart-types/line-chart) specifies irregular-time markers, missing-period gaps, and held-state steps. **Rule:** the observation process selects connection semantics. **Proof:** the exercise retains a zero and a singleton and splits an expected missing visit. This official practice does not grant a new domain an interpolation model.
- [D3 line mechanics](https://d3js.org/d3-shape/line#line_defined) split at represented undefined values; a singleton can require a separate visible mark. **Rule:** segmentation precedes dropping missing records. **Proof:** literal expected segment membership and SVG circles agree. Filtering absence first is the distinguishing failure.
- [ggplot2 paths](https://ggplot2.tidyverse.org/reference/geom_path.html) distinguish row-order paths from x-ordered lines; [grouping](https://ggplot2.tidyverse.org/reference/aes_group_order.html) documents accidental cross-unit edges. **Rule:** declare identity and order explicitly. **Proof:** shuffled input produces the same chronological segments and returning x values preserve date order.
- [Haroz, Kosara and Franconeri, 2016](https://visxvision.com/wp-content/uploads/2017/08/harozkosara2016scatterplot.pdf) studied low-complexity connected scatterplots and identified direction and overlap difficulties. **Supported inference:** retain direction/date cues and a chronological companion when duration matters. **Proof:** the exercise's returning path keeps all dated pairs. Dense multi-trace effectiveness and universal reader comprehension remain outside that study's warrant.
- [Song and Szafir, VIS 2018](https://cmci.colorado.edu/visualab/papers/song_VIS_2018.pdf) measured missing-data display effects on interpretation, confidence, and perceived quality. **Rule:** distinguish observed and imputed support. **Proof:** missing observations acquire no numeric point in the exercised raw view. A truthful gap is not a numerical uncertainty estimate; smooth presentation can change confidence independently of truth.
- [Hyndman and Athanasopoulos, time-series graphics](https://otexts.com/fpp3/graphics.html) distinguishes seasonal and chronological readings. **Rule:** calendar grouping carries a declared period and partial coverage. **Proof:** a last-year partial period remains labeled. Civil-time daylight changes and unequal periods need source-aware treatment; a fixed count of hours is an assumption.

## Counterexamples and recovery

A unit observed ten times can dominate a row-weighted average relative to a unit
observed once. The exercise makes this distinction numerical; the analyst chooses
the estimand. An event-aligned mean can combine different calendar conditions.
A line across an unobserved year can imply supported continuity. A returning
connected scatter sorted by x changes history. Preserve original records,
choose points/table where support is unsettled, and route model or cadence
decisions to the accountable source owner.

This package adapts the HASE [foundation and sparse-time reference](https://github.com/driftframestudios/human-ai-systems-exemplars/blob/main/.agents/skills/data-visualization-foundations/references/sparse-time-scales-and-form-boundaries.md)
into an independent unit/alignment contract. Its runnable exercise establishes
the named synthetic semantics, not a general forecasting or inference method.
