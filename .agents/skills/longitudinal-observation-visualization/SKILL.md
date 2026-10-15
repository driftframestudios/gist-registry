---
name: longitudinal-observation-visualization
description: Preserves observation identity, timing, support, and comparison meaning in longitudinal views. Applies to sparse or irregular measurements, repeated units, event alignment, annual panels, and time-ordered paths through multiple measures.
---

# Longitudinal observation visualization

## Contract

- **What:** A view of change that keeps unit identity, time basis, actual observations, connections, and summaries interpretable.
- **When:** A reader follows units through time or compares histories, seasons, aligned events, or repeated measurements.
- **Boundaries:** The observation process and domain owner establish cadence, continuity, pairing, and estimand. Interpolation and inference retain named model owners. A rendered trajectory establishes the encoded observations and assumptions.
- **Result:** One supported longitudinal comparison with visible observational support and exact values.

## Fit and attention

- **Useful when:** Missing scheduled visits, irregular sampling, unit turnover, or a path's ordering could change the reading.
- **Poor fit when:** Records carry only identifiers, or the question concerns independent group distributions without a longitudinal claim.
- **Smallest useful dose:** Stable identity, admitted time, points, an explicit connection policy, and a table.
- **Interactions:** Question routing chooses the operation; transform and figure-composition contracts receive the resulting values and support. Destination owners inspect their rendered artifact.

## Inputs, defaults and output

Supply the followed unit and stable key, time/value/status records, measurement
units, observation process, and the reader's comparison. Add cadence, time origin,
time zone, precision, pairing, or estimand when the selected reading needs them.
Default to points at admitted observed times; a missing row becomes a missing
expected visit only when the observation schedule establishes that expectation.
An unclear tie or timestamp holds connection while the source values remain
available. The output names the connection/summary policy and its exact values.

## Rules

### Rule: Identity and time define each history

Name the followed unit and the key that persists across observations. Separate
individual trajectories from changing cohort summaries. Calendar time, elapsed
time since a defined origin, and visit order answer different questions. Event
alignment names the event and handles units without that event explicitly.
Duplicate unit/time records require a replicate or tie policy before connection.

### Rule: Observation support remains visible

Distinguish few observations, uneven times, missing expected visits, and low
exposure. Preserve actual spacing for elapsed-time readings. Keep observed zero,
unavailable values, censoring, and partial periods distinct. Draw isolated
observations even when a line renderer would hide a singleton. A cadence-based
gap threshold requires a declared source/domain rationale.

### Rule: Each connection states a relationship

Partition by unit, order within that unit, and split at admitted gaps before
rendering. A segment relates its observed endpoints; its interior requires an
explicit interpolation interpretation. A step carries a held-state contract.
Imputation and smoothing produce separately identified derived values. Preserve
missing records until segmentation has made their meaning explicit.

For a connected scatter, x and y encode two measures while time orders the path.
Use temporal direction and date cues. A returning x value preserves time order;
identical consecutive positions preserve their times in the companion. Path
length is measured in display/measure space and supplies no elapsed duration.

### Rule: Comparisons preserve their basis

Year panels and seasonal overlays declare the calendar/phase and partial-period
coverage. Use common scales for cross-panel magnitude comparisons. An equal-unit
summary and an observation-weighted summary retain different denominators.
Changing membership, missingness, and dense sampling can change a group curve;
keep support counts and a fitting unit-level companion reachable. Statistical
independence and within-unit uncertainty require an appropriate method.

### Rule: Preparation has one owner

Derive a detached ordered view once for marks, labels, table, and export. Grouping
and sorting cost O(n log n) in the general case; admitted order permits O(n)
segmentation. Retained marks and values scale with observations. A reduced view
names its aggregation/sampling rule and preserves the original-data route.

## Operating sequence

1. **Frame:** Choose individual change, group change, recurring pattern, or paired-measure movement.
2. **Admit:** Establish unit, measurement, timestamp precision/time zone, alignment, absence, and source standing.
3. **Compare:** Consider actual-time points, identity-scoped segments/steps, common-scale panels, and a summary with raw support.
4. **Prepare:** Resolve ties; group/order; segment gaps; compute only the selected summary and its denominator.
5. **Compose:** Keep points, support, direction, units, and exact-value route visible.
6. **Observe:** Check an independently specified sequence/gap fixture and inspect the actual destination at its intended size.

## Decisive scenario

### Scenario: Two records share an unresolved visit time

- Given one unit has two measurements at the same reported time and their replicate meaning is unresolved
- When a connected history is prepared
- Then both records remain recoverable and their connection is held
- And the source or analysis owner supplies a replicate/tie policy before a derived trajectory replaces the admitted points

## Conditional context

Load [time, paths, and evidence](references/time-paths-and-evidence.md) for
alignment, annual panels, connected scatter, alternatives, and research limits.
The [receiving exercise](exercises/README.md) supplies runnable synthetic
counterexamples and a deterministic SVG/CSV companion.

## Recovery and re-entry

Keep the source records and last accepted point/table view while cadence, ties,
alignment, or interpolation remain disputed. Route observation identity and time
to the source owner; route aggregation or model assumptions to the analysis
owner. Rebuild the detached view after that decision, then check segmentation
and every carrier together.

## Completion

The reader can identify whose observations are connected, recover when they
occurred, distinguish supported values from missing/model-derived values, and
perform the named comparison. A disputed cadence, tie, event, or estimand returns
to its owner with source records retained. A changed population or demonstrated
misreading reopens the smallest affected decision.
