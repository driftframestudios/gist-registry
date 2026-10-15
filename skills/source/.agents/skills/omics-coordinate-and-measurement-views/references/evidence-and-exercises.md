# Evidence and exercises

This package is a research-informed instruction contract. The source review was
performed on 2026-10-15. Primary research, author guidance, implementation
documentation, local mathematical derivations, and synthetic exercises retain
distinct evidence roles. A cited mechanism can inform a rule while its
cross-context effectiveness remains an open receiving question.

## Source → design → proof

| Source and inspected scope | Design consequence | Suggested receiver proof and transfer boundary |
| --- | --- | --- |
| [DESeq2 vignette](https://bioconductor.org/packages/release/bioc/vignettes/DESeq2/inst/doc/DESeq2.html), official author documentation, 1.52.0; input, transform, sample-order and visualization sections | Keep sample metadata aligned; separate count-model input from VST/rlog exploration; transformed values still retain batch variation. | Permute metadata and matrix independently; require identity restoration. Display transform metadata. No reimplementation or validation of DESeq2 is implied. |
| [UCSC BED specification](https://genome.ucsc.edu/FAQ/FAQformat.html#format1), official format documentation; required fields and blocks | Bind half-open interval meaning and chromosome/reference; handle insertion and block features explicitly. | First base, adjacent intervals, one-base span, zero-length insertion, split blocks. The simple interval conversion applies only to ordinary nonempty intervals. |
| [GFF3 specification](https://github.com/The-Sequence-Ontology/Specifications/blob/master/gff3.md), format-owner specification; coordinates, strand, insertion/circular rules | A one-based feature's type and reference context matter; strand does not turn every interval into reversed endpoints. | Exact converted ordinary feature plus held circular/insertion examples. An adapter declares the subset it admits. |
| [VCF 4.5](https://samtools.github.io/hts-specs/VCFv4.5.pdf), format-owner specification; position/reference/SV record semantics | Treat allelic variants, padded indels, structural intervals, and breakends through their format semantics. | Synthetic SNV and padded indel distinguish anchor from affected bases. Full VCF admission remains a mature parser's job. |
| [ComplexHeatmap reference](https://jokergoo.github.io/ComplexHeatmap-reference/book/a-single-heatmap.html), author documentation; clustering/reordering/partition sections | Persist the realized ordering and clustering parameters; annotations follow identities through reorder. | Shuffle input and reverse rows/columns; verify each displayed annotation and cell retains its identity. A visually stable cluster needs a separate stability analysis. |
| [Luecken et al., 2022](https://www.nature.com/articles/s41592-021-01336-8), primary benchmark; abstract and introduction inspected | Evaluate technical integration and retained biological variation as separate goals. | Synthetic batch-condition counterexample and paired color views. No method winner is transferred from a benchmark to a new assay. |
| [Zimmerman et al., 2021](https://www.nature.com/articles/s41467-021-21038-1), primary study; abstract and experimental-unit discussion | Cells share donor structure; count cells and independent units separately. | Unequal per-donor cell counts produce different cell-weighted and donor-weighted summaries. The fixture demonstrates weighting, not a best differential-expression estimator. |
| [Krutkin et al., 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC11969646/), primary metabolomics study; abstract, missingness and imputation scope | Preserve the origin and imputed status of absent measurements; inspect sensitivity of exploratory structure. | Distinct synthetic zero, below-limit, missing, and imputed states survive a heatmap/export. Two studied datasets do not justify one imputation policy for all assays. |

The table proposes fitting receiver observations. The runnable exercise below
lists the subset it actually checks; other cases remain candidate observations.
Living documentation retains its own current version. The exercise uses its own
explicit mathematics and fixed synthetic records, with no external package
installation or validation claim.

## Alternatives and method lineage

Compare a source-preserving annotated matrix, a standardized pattern heatmap, a genomic track/detail view, a replicate summary, and an effect/interval display. Each resolves a different reading; assay identity and support determine which route is useful.

The [HASE Visualization Fidelity Atlas](https://github.com/driftframestudios/human-ai-systems-exemplars/blob/4eebab07a37fe2be46659fbeee1dc7085a25a678/context-canvas-project-surface/context-canvas/visualization-fidelity-atlas.html)
and its visualization foundations/web/PDF guidance supplied the reader-operation,
source-contract, separate-proof, and final-size method. HASE's F0–F3 ladder
names production commitment; it leaves scientific evidence standing unchanged.
The Registry package carries the operative method and complete local references.
The upstream link records lineage and can be consulted as optional background.
Local Atlas scoring, manufacturing data, CSS, and private workspace context
retain their original owners.

The receiving contract is a synthesis: a compact portable core plus conditional
domain/transform/composition context. One omnibus skill, one skill per plot,
one per library, and one per output medium would duplicate responsibilities.
Real use can justify a later split when it exposes a distinct result or failure
boundary. The current role router owns reader-job selection.

## Runnable synthetic exercise

Run with Python 3.12 or newer from this package directory:

```sh
python3 exercises/verify.py
exercise_dir=$(mktemp -d)
python3 exercises/verify.py --output-dir "$exercise_dir/figures"
```

The first command checks ordinary interval conversion; assembly/feature admission; sample-identity joins and duplicate/missing metadata; realized annotation order; cell versus donor weighting; proportional-row z-scores and constant-row state; batch-condition confounding; preserved measurement statuses.
The second runs the same assertions and writes deterministic CSV/SVG companions
to a fresh output directory. It prints a compact result; it reads no external
data, makes no network calls, and uses only the Python standard library.
Fictional feature/sample names and authored values carry `synthetic` standing.

[The exercise source](../exercises/verify.py) contains the exact cases and
independent expected results. Tests raise on failure even when Python runs with
optimization. A receiver should perturb the decisive value/identity/domain
assertion when adapting the example, then restore source before acceptance.

The fixed-size exercise has bounded cost. Its linear traversals cover a small
number of records; it performs no all-pairs clustering or assay fitting.
Generation proves arithmetic and output structure. Render the SVGs at their
declared size to observe label placement and readability. Real dataset scale,
biological inference, audience comprehension, accessibility, and production
performance remain separate receiving observations.
