# Compare two years on admitted spatial support

The receiving question is: **how do three synthetic regions' observed event
rates differ across two years, and which changes have a comparable basis?**
Counts, exposure, and geography support travel with each region-year value.
The drawn blocks are schematic teaching shapes with no coordinate, distance,
adjacency, or area measurement claim.

With Python 3.11 or later and its standard library:

```sh
python3 .agents/skills/spatial-support-and-change-visualization/exercises/exercise.py --check
```

The [source CSV](regions.csv), [runnable exercise](exercise.py),
[readable figure and native table](example.html), [standalone SVG](example.svg), [exact values](values.csv), and
[comparison states](comparisons.json) travel together. Omit `--check` to
regenerate, or add `--output DIRECTORY` for an independent copy. Literal expected
rates and comparison states precede exact generated-byte checks.

The exercise distinguishes count from rate; observed zero from zero exposure;
stable from changed geography support; and fixed magnitude classes from a
different panel's classification. West's comparison remains held even if both
years receive numeric observations because its geography differs. A separate
179° to −179° example identifies a discontinuity requiring a geographic owner;
this schematic renderer does not implement map projection or a traveled route.

Inspect the HTML at full size and a narrow reading width. Year labels,
common legend, South's zero, West's hatching/changed-support label, and the held
comparison must remain recoverable. Focusable regions scroll the figure and
table locally at narrow widths while labels retain their authored size. The
native table, exact-value CSV, and full-size SVG provide alternatives. A precise ranking task
can use the same values in an ordered table; a map is a conditional choice.

Issue #52 supplies the actual receiving task. The receiving pull request records
execution, independent review, and rendered inspection. These observations
establish the synthetic comparison and package behavior. Real geographic
harmonization, projection, privacy, spatial inference, accessible-document
conformance, and broad reader effectiveness retain their fitting owners.
