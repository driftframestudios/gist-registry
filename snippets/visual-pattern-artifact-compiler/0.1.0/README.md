# Visual pattern artifact compiler 0.1.0

## Practical question

How can one source-owned visual contract produce responsive image bytes,
accessible reading companions, and a recoverable publication receipt while
each representation keeps the same meaning?

This exemplar answers with a realistic synthetic operating diagram. The source
contract names its owner, dimensions, alternative text, caption, reading
order, rights standing, output type, metadata policy, font coordinate, and
three derivative widths. The compiler admits a static, self-contained SVG and
gallery-shell subset, validates the SVG instance graph and painter order,
applies explicit resource ceilings, creates responsive WebPs, writes an
accessible gallery and semantic JSON companion, inspects embedded metadata,
and records every output digest.

## Run the package

From the repository root:

```sh
npm --prefix snippets/visual-pattern-artifact-compiler/0.1.0 ci --ignore-scripts
npm --prefix snippets/visual-pattern-artifact-compiler/0.1.0 test
npm --prefix snippets/visual-pattern-artifact-compiler/0.1.0 run install:browsers
npm --prefix snippets/visual-pattern-artifact-compiler/0.1.0 run test:browser
npm --prefix snippets/visual-pattern-artifact-compiler/0.1.0 run example
```

The example writes an ignored `.artifacts/example/` family and prints its
manifest summary. The source package remains unchanged.

## Representation chain

```text
pattern-contract.json + pattern.svg + gallery-shell.html
  → bounded contract, SVG, and gallery-shell admission
  → 640 / 1280 / 1600 WebP candidates
  → accessible gallery + semantic companion
  → metadata and digest manifest
  → candidate verification
  → one accepted pointer
```

The accessible gallery provides intrinsic dimensions, `srcset`, `sizes`,
concise alternative text, a distinct caption, and a semantic table that stays
useful when the image is unavailable. The SVG source gives every definition a
unique instance identity, resolves local references, and places connectors
before cards so arrow lines remain behind the panels in painter order.

## Source admission and resource envelope

The admitted source coordinate is static and self-contained. SVG and gallery
shells may use in-document fragment references such as `url(#vf-grid)` and
`href="#vf-card"`. The compiler returns a typed rejection for executable
elements, event-handler attributes, external resource attributes, stylesheet
imports, network or file locators, machine-private paths, XML externalization,
SVG animation elements, and `foreignObject`. The gallery shell also returns a
typed rejection for document refresh, embedded browsing contexts, forms, and
other active document elements.

These defaults bound work before Sharp receives SVG bytes:

| Resource | Default ceiling | Admission point |
| --- | ---: | --- |
| Contract source | 64 KiB | File stat and post-read length |
| SVG source | 1 MiB | File stat and post-read length |
| Gallery shell | 256 KiB | File stat and post-read length |
| Combined source | 1.25 MiB | Before contract parsing and source admission |
| Semantic states | 64 | Contract admission |
| Derivative widths | 8 | Contract admission |
| Intrinsic pixels | 32 million | Contract admission |
| Combined derivative pixels | 64 million | Contract admission |
| Complete output family | 16 MiB | Static preflight and cumulative emitted-byte checks |
| Source resource references | 64 | SVG and gallery source admission |

Callers may provide a stricter `limits` object to `compileArtifactFamily()` or
`publishArtifactFamily()`. The compiler accepts only the named limit fields and
requires a positive safe integer for each override. A
`resource_limit_exceeded` result identifies the resource, observation,
ceiling, and restart boundary. Source admission and static-output preflight
complete before the candidate directory is created; cumulative output-byte
checks continue as each encoded derivative joins the family.
The manifest records the applied admission standing and complete resource
envelope so a receiving reviewer can reproduce the same boundary.

The admitted stylesheet subset accepts layout, typography, color, media
queries, and `url(#semantic-id)` references. A CSS `image-set()` declaration
belongs to a separately admitted source coordinate with its own candidate and
descriptor rules. Gallery `srcset` candidates share the source-reference
ceiling and resolve only to admitted in-document fragments; the compiler
generates published derivative URLs after source admission.

## Focused evidence

The package-local tests establish:

- three declared WebP widths and aspect-ratio agreement;
- an inspected-clean metadata standing for EXIF, ICC, IPTC, and XMP fields;
- byte-identical output across two builds at one Node, Sharp, and libvips
  coordinate;
- locale-independent ordinal manifest ordering across mixed-case and non-ASCII
  path specimens;
- unique SVG IDs, complete local references, and connector painter order;
- typed rejection of script-bearing, event-bearing, externally referenced,
  machine-private, externally declared, animated, or foreign-object sources;
- source-byte, semantic-state, width-count, pixel-count, and output-byte
  ceilings applied before rendering begins;
- typed rejection of missing alternative text and escaped output names;
- typed rejection of invalid dimensions, media and metadata-policy mismatches,
  derivative collisions, missing rights, and a missing semantic companion;
- candidate cleanup after an interrupted render;
- atomic ownership of each fresh candidate output directory when compilers
  start concurrently;
- private-candidate boundary and leaf identity checks around every output
  write, with changed coordinates retained for operator inspection;
- digest-scoped destination reservations that serialize cooperative promotion
  while preserving any existing accepted coordinate;
- integrity verification when a content-addressed accepted directory already
  exists;
- accepted-pointer continuity through an injected stop after accepted bytes
  are verified and before pointer promotion;
- accepted-directory and leaf identity plus content verification immediately
  before pointer commit, together with temporary-pointer identity checks;
- immutable accepted bytes through a concurrent reuse-and-promote interleaving,
  even when the publisher that created those bytes stops before pointer
  promotion; and
- launched Chromium, Firefox, and WebKit observations for unavailable-image
  meaning, 320 CSS-pixel reflow at 200% text, forced colors, print, and SVG
  data-layer bounds.

Once an accepted digest directory reaches its atomic name, publishers treat
that directory as shared immutable state. A publisher interruption cleans its
private candidate and temporary pointer while leaving accepted bytes available
for a concurrent or resumed publisher. A separate retention policy can collect
accepted digests that remain unreferenced after a bounded recovery window.

The portable publisher assumes one trusted writer domain honors its
digest-scoped reservation. Node's cross-platform filesystem API supplies
exclusive leaf creation and atomic rename, while directory-relative
`openat`/`renameat2(RENAME_NOREPLACE)` transactions require a platform-specific
adapter. A deployment that admits mutually untrusted local writers should use
such an adapter or give one service identity sole write authority over the
publication root. After an ungraceful process stop, an operator confirms the
owning publisher has stopped and removes the empty reservation directory before
retrying that digest.

The manifest records the exact Node, Sharp, and libvips versions used for the
observation. Another runtime coordinate receives its own build and comparison
receipt. The example summary also records input bytes, output bytes, elapsed
time, peak resident memory, source-family count, and derivative-width count.

## Complexity and allocation

For `F` source families and `W` widths, derivative work is `O(F × W)` plus one
SVG admission pass and one gallery/semantic-companion pass per family. The
compiler holds each source document and one encoded derivative in memory at a
time. The example observation records input/output bytes, elapsed time, and
peak resident memory. A receiving performance exercise adds explicit
thresholds for its deployment coordinate.

## Technical judgment

**TARGET:** one accepted source contract yields pixels, structured data,
readable prose, and a digest-addressed publication coordinate with matching
meaning.

**CONTRAST:** an image-only export leaves dimensions, rights, reading order,
semantic state, metadata standing, and recovery distributed across informal
knowledge.

**GUARD:** closed source fields, SVG identity and reference checks, contained
output names, script-independent source admission, explicit resource ceilings,
metadata inspection, exact runtime coordinates, accepted-directory integrity
verification, candidate verification, and one pointer promotion keep the
family reviewable.

## Source, evidence, and transfer boundary

The code, names, SVG, prose, and fixtures are independently authored synthetic
material under Apache-2.0. The checks establish source-to-derivative behavior
for the included contract and the exact resolved runtime. The separate browser
lane records the lock-resolved Playwright and engine revisions for its bounded
observations. Other engine revisions, font sets, CDN behavior, product art
direction, production rights, content authority, cache policy, and release
acceptance remain receiving decisions with their own observations.

Sharp removes metadata by default for this derivative route. The package
inspects the emitted EXIF, ICC, IPTC, and XMP fields and records that bounded
observation. A receiving security process can add its approved embedded-data
and secret-material scanner for formats and metadata namespaces within scope.

## Official sources and version scope

- [Sharp installation and runtime coordinates](https://sharp.pixelplumbing.com/install/)
  describe platform-dependent binaries and the resolved libvips runtime.
- [Sharp WebP output](https://sharp.pixelplumbing.com/api-output/#webp) documents
  the encoder options fixed by this package.
- [Sharp metadata inspection](https://sharp.pixelplumbing.com/api-input/#metadata)
  defines the header-level observation used after encoding.
- [Playwright emulation](https://playwright.dev/docs/emulation) defines the
  forced-colors and media observations used by the browser lane.

The exact lock resolves Sharp 0.35.5 and Playwright 1.64.1. The manifest records
Node, operating system, architecture, libc family, Sharp, libvips, each source-file digest,
and a labeled aggregate source digest. The aggregate is SHA-256 over the
canonical, LF-terminated JSON object of those three labeled source digests.
Byte comparisons belong to that source, runtime, and encoder coordinate.
Another renderer, font stack, or platform receives a separate receipt.

The output family is suitable for a responsive browser route and for an AI or
assistive-technology reader that prefers the semantic companion. A receiving
repository should preserve both routes and bind them to its own accepted
version coordinate.
