# Delivery and inspection

Load for an actual paper, report, slide, poster, or web figure. The receiving
medium determines the final geometry and the observation that can establish fit.

## Fit the actual carrier

For a document, establish final placed width/height and its text/stroke needs.
An 11-point label authored at 180 mm and placed at 90 mm becomes 5.5 points.
Design at intended placement rather than relying on later shrinkage. Preserve
font/glyph fidelity and inspect the exported figure inside the document when
that document exists. Journal or organization requirements retain their owner.

For a slide or poster, viewing distance and available attention change label
sizes, contrast, and detail. Build a deliberate variant from the same values;
a reduced screenshot of the paper figure seldom supplies an adequate reading
from a distance. A short live presentation can place more detail in a companion.

For web, use the real container, native controls when needed, keyboard-visible
focus, and a readable table or longer description. Dense tracks and matrices
can use local scrolling plus a full-size route instead of shrinking labels.
Keep essential source/uncertainty context visible while progressive disclosure
holds details. The current selected state drives figure, caption, table, and
export together. Static figures need no new application state framework.

## Preserve numerical and delivery meaning

A source/derivation owner supplies admitted values and semantic metadata to
each renderer. Pure render functions can produce different layouts while
preserving identity, units, ranges, and uncertainty. A named SVG with a title
and description supplies useful structure; complete accessibility also depends
on embedding, alternative text, navigation, and the receiving document/page.

Use vector marks for modest plots. If dense layers create a measured time/file
size burden, rasterize those layers at the resolution required by final size
and retain labels/axes as vector when the chosen backend supports it. A large
DPI value improves raster sampling; it cannot repair tiny type or a poor layout.
Export format, font embedding, searchable text, PDF tagging, and reading order
remain separate delivery decisions. Choose a suitable accessible companion
while the receiving document owner handles its conformance requirements.

## Three-layer acceptance

| Layer | Observation | Establishes |
| --- | --- | --- |
| Source/semantics | Independent fixtures or exact admitted values, unit/identity checks, derivation review | The numbers and their stated meaning agree. |
| Rendered artifact | Actual-size viewing; longest labels, dense panels, scale/legend/interval inspection | The exercised output remains legible and visually coherent. |
| Receiving carrier | Real webpage/document/slide inspection and relevant interaction/accessibility checks | The embedding and use case preserve the required reading. |

A generated SVG/XML parse is an output-structure observation. It leaves pixel
legibility open until the SVG is rendered. A rendered picture leaves statistical
inference and the source population with their analysis owners. Stop once the
changed reading is supported; reopen when the source, scientific claim, output
size, renderer, or interaction changes.

## Synthetic composition exercise

The exercise creates a 180 mm-wide print SVG and a 1280 by 720 slide SVG from
one small, fictional effect-and-interval dataset. It compares signal estimates
in an arbitrary unit and a separate observed-support panel. Intervals are
explicitly authored ranges, with no sampling or confidence interpretation.
The fixed sample makes values, scale labels, glyphs, and annotation alignment
easy to inspect. It supplies neither real biology nor an audience experiment.

Inspect both at their intended size: the print version's caption and fine
interval endpoints; the slide version's title, labels and support panel from a
normal presentation distance. Verify that the SVG/CSV carry identical values
and descriptions. A peer can perturb one exported value or remove a required
unit to confirm that semantic acceptance changes, then inspect pixels separately.
