# Evidence and exercises

This package is a research-informed instruction contract. The source review was
performed on 2026-10-15. Primary research, author guidance, implementation
documentation, local mathematical derivations, and synthetic exercises retain
distinct evidence roles. A cited mechanism can inform a rule while its
cross-context effectiveness remains an open receiving question.

## Source → design → proof

| Source and inspected scope | Design consequence | Suggested receiver proof and transfer boundary |
| --- | --- | --- |
| [Matplotlib symlog](https://matplotlib.org/stable/gallery/scales/symlog_demo.html), official 3.11.2 documentation | Declare linthresh/linscale/base; a gradient transition can itself create visible structure. | Signed anchors and near-threshold samples; compare selected linear/symlog/asinh geometries on identical values. |
| [Matplotlib AsinhScale](https://matplotlib.org/stable/api/scale_api.html#matplotlib.scale.AsinhScale), official 3.11.2 API, explicitly provisional | Name `a0*asinh(x/a0)` and tick-base semantics; keep library version with executable adapters. | Independent mathematical roundtrip and raw-tick/derived-value consistency. A continuous transform does not select a scientifically justified cofactor. |
| [Matplotlib color normalization](https://matplotlib.org/stable/users/explain/colors/colormapnorms.html), official 3.11.2 documentation | Axis mapping and color normalization are different owners; thresholds/midpoints remain explicit. | Exact same value maps to same color under shared domains; distinguish missing/under/over states. |
| [Parks et al., 2006](https://pubmed.ncbi.nlm.nih.gov/16604519/), primary cytometry method paper; abstract inspected | Preserve legitimate compensated negative signals and name the actual transformation. | Signed synthetic sample survives chosen mapping. Abstract inspection supports the signed-value problem; it does not authorize implementing logicle from a name. |

The table proposes fitting receiver observations. The runnable exercise below
lists the subset it actually checks; other cases remain candidate observations.
Living documentation retains its own current version. The exercise uses its own
explicit mathematics and fixed synthetic records, with no external package
installation or validation claim.

## Alternatives and method lineage

Compare linear, positive log, offset log, signed symlog, and smooth asinh (or a domain-owned transform). The admitted domain, additive/ratio question, low-value sensitivity, and parameter meaning decide the mapping. A linear/detail combination can be the strongest choice.

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

The first command checks named finite-domain log/symlog/asinh maps; independent anchors, inverse and monotonicity; unit/cofactor rescaling; invalid parameters/domain; transformed interval endpoints; histogram mass and density; CSV/SVG source agreement.
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
