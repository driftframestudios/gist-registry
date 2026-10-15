---
name: spatial-support-and-change-visualization
description: Preserves spatial support, geography identity, denominators, and temporal comparability when selecting maps and coordinated views. Applies to year panels, sparse trajectories, regional change, and space-time comparisons whose geometry can alter interpretation.
---

# Spatial support and change visualization

## Contract

- **What:** A spatial-temporal view contract linking what a value describes to geometry, time, comparison basis, and exact evidence.
- **When:** Location, adjacency, movement, regional pattern, or changing geography materially affects a reader's question.
- **Boundaries:** Domain/source owners establish geographic support, reference system, exposure, and valid crosswalks. Models own interpolation and spatial inference. A map's geometry establishes representation rather than measured travel or individual behavior inside a region.
- **Result:** One supported spatial/change comparison with consistent units, scale, geography vintage, and recoverable values.

## Fit and attention

- **Useful when:** A region's denominator, boundary vintage, or sampled trajectory can change the story.
- **Poor fit when:** A few region names are merely categories in an exact ranking; an ordered table or dot comparison can complete that job.
- **Smallest useful dose:** One support definition, a comparison question, a fitting map or ordinary chart, and its data companion.
- **Interactions:** Question routing sets spatial/temporal granularity; longitudinal observation owns unit histories; transform and scientific composition receive the admitted spatial contract.

## Inputs, defaults and output

Supply the geographic support and identity/vintage, time window, quantity and
units, coordinate reference when geometry is used, and any numerator/denominator
needed by the comparison. Name the join keys between records and geometry.
When location serves only as a category, begin with an ordinary chart or table.
When support is unresolved, retain each source's labeled values and hold the
cross-support calculation. The output binds the selected comparison to its
admitted geography, measure, missing states, and recoverable values.

## Rules

### Rule: Spatial support precedes geometry

Name whether records describe points, areas, grids, trajectories, or modeled
surfaces. Identify units, reference system, precision, vintage, and observation
window. A filled region represents an area summary; its interior supplies no
individual-level observation. Counts and rates answer distinct questions.
Choose the domain's exposure denominator for comparable rates and preserve both
numerator and denominator. An empty denominator yields an unavailable rate.

### Rule: Change preserves comparable support

Year panels share the units, geographic extent, projection, and value-to-color
mapping needed for comparison. A changing boundary, population, measure, or
classification can change the reading while an ID stays the same. Admit a
source-owned common geography/crosswalk, or label the changing support and hold
the precise comparison. Show missing, suppressed, and observed-zero areas
distinctly. A period-specific quantile color describes local rank and needs that
explicit basis; a fixed-magnitude comparison uses a shared mapping.

### Rule: Time and space receive complementary work

Choose year maps for across-location pattern, location histories for within-place
change, or a location-by-time matrix when precise temporal comparison leads.
Linked views share selection, population, units, and exact values. Animation and
space-time cubes earn their interaction cost through a specific tracking or
pattern task and a fitting reader observation; static values and selected-time
recovery remain available.

### Rule: A trajectory preserves observations and interpolation meaning

Group by tracked identity and order by admitted time. Mark sampled positions,
gaps, direction, and dates. A connecting line represents the declared relation
between samples; route, speed, and distance need their own justified method.
Keep timestamp fields explicit. For geographic exchange, validate coordinate
order and reference-system semantics; handle antimeridian and projection
discontinuities before interpreting a long visible segment.

### Rule: One derivation supplies comparison and companion

Join by explicit keys and inspect unmatched units. Derive rates and classifications
once for panels, table, and export. Preparation is O(n) for keyed records plus
O(g·t) only when a complete location-time grid is needed; sparse views can retain
O(n) records with explicit absence. Geometry work scales with visible vertices
and panels. Simplification, sampling, and aggregation retain named meaning and
an original-value route.

## Operating sequence

1. **Frame:** Name spatial and temporal granularity and the reader operation.
2. **Admit:** Establish support, identity/vintage, coordinates, window, measurement, and denominator.
3. **Compare:** Consider year maps, linked location histories, a time matrix, identity paths, and animation/space-time views.
4. **Prepare:** Reconcile geography and missingness; derive the selected measure and shared comparison mapping.
5. **Compose:** Preserve source, period, units, support, legend, and exact values with the figure.
6. **Observe:** Check a support-changing counterexample and the rendered legend/panels; separate numerical, geospatial, and reader-effectiveness evidence.

## Decisive scenario

### Scenario: A stable region ID carries a changed boundary

- Given two periods reuse a region ID while the region's polygon and population support change
- When the proposed view calculates their precise regional change
- Then period-specific values remain available with their respective vintages and the change calculation stays held
- And the geographic source owner supplies a justified common support or crosswalk before that comparison resumes

## Conditional context

Load [support and evidence](references/support-and-evidence.md) for spatial
denominators, trajectories, year panels, alternatives, and task-specific research.
The [receiving exercise](exercises/README.md) produces a deterministic schematic
SVG/CSV with independently specified rates and held comparisons.

## Recovery and re-entry

Preserve source geometries, their vintages, and original numerators/denominators.
Use separately labeled period views or a table while a crosswalk, exposure, or
reference-system decision rests. The geographic or domain owner resolves that
meaning; the renderer then renews joins, shared scales, and exact companions.

## Completion

The receiver can identify what each spatial value describes, compare the named
times on an admitted basis, recover values, and locate unresolved geographic or
statistical decisions. Preserve source records while a crosswalk or model is
pending. Changed geography, exposure, task, or demonstrated misreading reopens
the affected comparison.
