# Roles, alternatives, and evidence

Inspected 2026-10-15. These role labels are a local organizing vocabulary;
sources support the underlying distinctions. Each inference below states its
observable receiving consequence.

| Data meaning | Statistical operation | Visual channel | Reader task |
| --- | --- | --- | --- |
| Timestamp for the same measured unit | Order within identity; retain elapsed intervals | Actual-time position and optional segments | Follow individual change |
| Year and recurring month | Partition by year; retain within-year support | Year traces over month | Compare recurring patterns |
| Annual population membership | Condition on year; declare any aggregation | Separate year panels of two measures | Compare associations within years |
| Observation coverage by period | Count eligible observations or exposure | Complementary aligned strip/table | Judge support beside another relationship |
| Region identity | Select/group; admit geographic support if needed | Category, panel, or map location | Rank regions or locate spatial pattern |

Conditioning a graphic means showing a subset. A causal adjustment needs its
own model and assumptions. A statistical summary needs its own estimand: row,
unit, event, and exposure weighting answer different questions.

## Four design routes

1. **One omnibus foundation:** low routing cost; specialist identity and support decisions can become hard to find.
2. **One skill per chart:** familiar discovery; repeats admission and can encourage form-first selection.
3. **A numeric chart-fit recommender:** fast suggestions; weights and scoring require evidence and a declared target population.
4. **Question router with distinct semantic owners:** selected here. It ends with one view contract and invokes deeper time/spatial/measurement work only when that decision changes the result.

For one actual view, compare fitting alternatives again. For two observed states
with stable identity, paired dots retain change; independent distributions fit
different populations; a summary plus raw values fits a group question; a table
fits exact lookup. A matching mean alone cannot select among those data shapes.

## Source → rule → observation

- [Brehmer and Munzner, 2013, multi-level task typology](https://www.cs.ubc.ca/labs/imager/tr/2013/MultiLevelTaskTypology/) separates why, what, and how. **Supported inference:** specify operation and target before encoding. **Observation:** several questions on the same records yield distinct, explicit contracts. This descriptive framework supplies no universal scored chart selector.
- Official [lattice `xyplot`](https://search.r-project.org/CRAN/refmans/lattice/html/xyplot.html) distinguishes primary and conditioning variables; [panel superposition](https://search.r-project.org/CRAN/refmans/lattice/html/panel.superpose.html) supplies within-panel grouping. **Rule:** name panel subsets separately from groups. **Observation:** the exercise's year condition changes eligible rows; its highlight preserves them. The portable rule is a design translation of verified library behavior.
- [Hyndman and Athanasopoulos, time-series graphics](https://otexts.com/fpp3/graphics.html) explains seasonal overlays and subseries. **Rule:** a year group can expose recurring patterns while a chronological companion preserves progression. **Observation:** incomplete years retain explicit coverage; missing months stay unavailable. Meaningful periodicity and calendar comparability are inputs.
- The HASE [Visualization Fidelity Atlas](https://github.com/driftframestudios/human-ai-systems-exemplars/blob/main/context-canvas-project-surface/context-canvas/visualization-fidelity-atlas.html) and [foundation](https://github.com/driftframestudios/human-ai-systems-exemplars/blob/main/.agents/skills/data-visualization-foundations/SKILL.md) supplied the question/data/conditions/companion route. This package adapts that reasoning into a complete local contract. F0–F3 describes production commitment; source and method establish evidence standing.

## Counterexamples and recovery

An identifier sorted numerically can resemble time while carrying no chronology.
Year panels can show different people and therefore establish group change,
while individual change needs matched identity. A population highlight and a
population filter can look similar yet imply different denominators. Preserve
the admitted records and return the missing definition to its owner; an exact
table remains a useful interim result.
