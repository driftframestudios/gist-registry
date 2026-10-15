# Assay matrices and inference

Load this branch when samples, cells, donors, features, batches, or analytical
results meet in one figure. The aim is a faithful comparison with clear support.

## Identity precedes order

Keep stable row/column identities separate from labels. Join metadata by key,
check the expected one-to-one or explicitly admitted one-to-many relation, and
reorder annotations with the realized matrix order. Duplicate gene symbols can
remain labels; unique feature identifiers retain the joining role. Combined
assays need a declared sample intersection/union and visible unavailable cells.

Normalization, filtering, variance stabilization, feature selection, row
standardization, clustering, and rendering each have a place in the pipeline.
Record their order and fitted population. A row z-score answers relative
within-feature deviation; two proportional abundance profiles can have identical
z-scores. A constant row has undefined z-scores under the usual standard-deviation
formula and receives a named state. The colorbar states the displayed statistic.

Clustering distance/linkage, row/column scaling, missing-data policy, feature
subset, stochastic seed where applicable, and realized order affect a heatmap.
Persist the displayed order for reproducible annotations and export. A small
change in order can be a dendrogram rotation rather than new evidence of a
biological relationship. A stable ordering assertion and a biological cluster
stability claim require different observations.

## Experimental support and uncertainty

Count cells, specimens, donors, runs, and independent experimental units
separately. For a donor-level question, collecting more cells from one donor
increases subsampling while leaving donor count unchanged. Unequal cell counts
can change a cell-weighted mean relative to a donor-weighted mean. Name the
estimand and any pairing/hierarchy before selecting a summary or interval.

An uncertainty display identifies its target, interval type, model/resampling
unit, level, and multiplicity policy where inference applies. Measured spread,
estimate precision, posterior uncertainty, prediction, and sensitivity answer
different questions. A volcano or MA plot carries effect definition, adjustment
method, tested family, filtering, and undefined/untested states. Plotting a
threshold supplies a visual comparison; the analysis supplies its scientific
meaning. Extreme or rounded p-values retain their bound/precision status.

## Batch and missingness remain observable

Show technical and biological labels in compatible pre/post views. Integration
may produce a corrected feature matrix, neighborhood graph, or embedding; each
supports different downstream operations. Evaluate technical mixing alongside
retention of biological variation and relevant support. A mixed UMAP is useful
exploration, while correction validity needs fitting quantitative/domain checks.

If every control comes from batch A and every treatment from batch B, the
condition and batch design columns coincide. Those data leave their separate
effects unidentified under that design. Descriptive views can expose the gap;
visual polish or relabeling cannot supply the missing comparison.

Proteomics/metabolomics intensities, concentration measurements, counts, and
compositional proportions keep their units and calibration. Below-limit,
undetected, absent, filtered, imputed, and observed-zero values retain distinct
statuses. Preserve a declared imputation method and uncertainty/sensitivity
when it changes a pattern. Avoid inferring the missingness mechanism from the
blank cells alone; use assay and acquisition evidence with the analysis owner.

## Alternatives and acceptance

Compare a raw/normalized matrix with annotations, a standardized pattern
heatmap, a sample/donor summary, an effect-and-interval display, and an embedding
with separate label views. Choose the form that preserves the actual question.
A large heatmap is not a mandatory outcome of omics data.

For small matrices, exact cell/annotation assertions and a visual check are
proportionate. At larger scale, distinguish O(features*samples) traversal from
all-pairs sample distances and hierarchical clustering; the latter can require
quadratic storage. Feature selection, aggregation, or sampling carries its
selection rule and a recoverable detail route. Benchmark only the receiving
pipeline and size, including parsing, transformation, clustering, rendering,
and export when those stages matter.
