# Intervals, colors, and density

Load this branch when a nonlinear map changes more than point positions.

## Intervals retain their statistical owner

For a monotone increasing display function f, place an estimate m at f(m),
and supplied bounds [l,u] at [f(l),f(u)]. Calculate the two rendered error lengths
from those transformed endpoints. Transforming a symmetric raw error length
alone generally gives the wrong endpoints. For decreasing maps, preserve the
bound order after mapping. A model may instead estimate in transformed space;
name that estimand and back-transformation explicitly.

A confidence interval, credible interval, prediction interval, observation range,
and sensitivity envelope have different targets. State method, level, units,
independent support, and multiplicity when relevant. The geometry preserves
supplied uncertainty; statistical validity remains with its analysis and design.

## Color is its own scale

Sequential color supports magnitude, divergence supports a meaningful reference,
and cyclic color supports periodic quantities. A shared color domain enables
cross-panel numerical comparison. Independent domains can reveal local pattern
when legends disclose them. Use a dedicated missing state and visible over/under
or clipping policy; clipping an outlier changes the visible variation.

Row normalization changes the quantity before color mapping. A z-score legend
therefore describes within-row deviation, with original values recoverable.
Two identical colors across independently normalized rows establish the same
normalized score, not the same original amount. Show a zero-variance row as the
chosen undefined-scale state rather than silently giving it a made-up score.

## Histogram mass and density

A bin with mass p and width w has density p/w in that coordinate's unit. Equal
mass in unequal widths gives unequal heights. For a positive variable x and
`y=log_b(x)`, a continuous density obeys
`p_y(y)=p_x(b**y)*ln(b)*b**y`. An axis change alone does not calculate a new
probability density. Name whether a chart shows counts, mass per bin, density
per raw unit, or density per transformed unit, and keep bin edges recoverable.

Compare these routes: raw bins on a linear axis, raw bins on a transformed axis
with their original count/density meaning, transformed-coordinate bins with
recomputed widths, and an empirical cumulative distribution. Select from the
reader's operation and the model assumptions. A smoother curve is an estimated
representation with a bandwidth and support boundary; a histogram remains
sensitive to its bins.

## Failure and recovery examples

- A zero sent to a log map returns an explicit domain decision; its source status
  stays intact while a suitable alternate panel or scale receives it.
- A transformed interval that crosses an invalid domain returns to the interval
  and quantity owner; clipping requires a visible bound and reason.
- A color-domain change updates the colorbar, caption, companion, and export in
  the same state change.
- A density relabeled from raw to logarithmic units receives a width/Jacobian
  recalculation before its area supports a probability reading.

The exercise checks finite arithmetic and exact supplied intervals/densities.
It does not fit a probability model, estimate uncertainty, or establish coverage.
