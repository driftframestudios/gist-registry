---
name: visual-artifact-family-publication
description: Compiles a source-owned visual contract into responsive image derivatives, accessible semantic companions, deterministic manifests, and a recoverable accepted family. Use when SVG, raster, HTML, or data views need coordinated public delivery.
---

# Visual artifact family publication

## Contract

- **What:** A source-to-publication method for coordinated visual pixels,
  structure, descriptions, dimensions, metadata standing, and digests.
- **When:** One diagram, screenshot, data view, or illustration needs responsive
  derivatives plus useful reading routes for image-unavailable, assistive-
  technology, AI, print, or low-bandwidth contexts.
- **Boundaries:** Content and rights owners approve the source and descriptions;
  renderers and encoders own their exact bytes; receiving applications own
  placement, cache, and release acceptance.
- **Result:** One verified, versioned artifact family with an accepted pointer
  and exact recovery coordinate.

## Source contract

Before rendering, name:

- stable family and version identity;
- source type and source digest;
- owner, license, rights, and synthetic/public-source standing;
- intrinsic dimensions and aspect ratio;
- concise alternative text and distinct caption;
- longer prose or table companion where the image carries complex meaning;
- reading order, focus and interaction behavior where applicable;
- intended widths, media types, quality, and encoder options;
- metadata policy;
- browser, fonts, runtime, renderer, encoder, and platform coordinate; and
- publication owner plus rollback coordinate.

## Rules

### Source meaning precedes derivatives

Keep an authored SVG, HTML/data view, or high-quality raster plus its semantic
contract as the family authority. Derivatives inherit that meaning and their
declared delivery intent.

### SVG identity and painter order are behavior

Use unique IDs, resolve every local `url(#...)`, `href`, mask, clip, gradient,
and marker reference, and place connectors behind the panels they connect when
that relationship is intended. Preserve a responsive `viewBox`, accessible
title/description, and a prose or table companion.

### Responsive derivatives name their use

Generate only widths the receiving layout can select. Record intrinsic width
and height, aspect ratio, media type, encoder options, byte size, digest, and
the intended `srcset`/`sizes` relationship. Use cacheable versioned names.

### Pixels and semantic companions agree

Alternative text states the image's purpose concisely. A caption explains why
the figure appears in context. A longer description or structured table
preserves relationships, labels, states, and sequence for readers who inspect
meaning outside the pixels.

### Metadata policy becomes an observed disposition

Choose strip, retain, or replace based on provenance and delivery needs. Inspect
the encoded output for EXIF, ICC, IPTC, and XMP standing. Metadata inspection
answers the fields it parses; a bounded secret-material scanner owns broader
content and byte inspection.

### Byte identity belongs to the runtime coordinate

Record Node, renderer/browser, OS, architecture, fonts, Sharp, libvips, source,
and encoder options. Require repeated byte identity inside one declared
coordinate when deterministic output is a goal. Classify another coordinate as
a separate observation.

### Publication moves one accepted pointer

Validate source and rights, render candidates, inspect dimensions and metadata,
verify companions, compute digests, and compare the accepted coordinate. Move
one pointer after the complete family passes. A failed or interrupted candidate
preserves accepted bytes and cleans its owned partial boundary.

### Complexity follows families and widths

For `F` source families and `W` widths, derivative work is `O(F × W)` plus one
bounded source, companion, and manifest pass per family. Record source/output
bytes, files, elapsed time, and peak memory at the runtime coordinate.

## Operating sequence

1. Admit source, ownership, rights, dimensions, descriptions, reading order,
   metadata policy, and target family.
2. Validate SVG identity/references/painter order or the corresponding HTML and
   raster source invariants.
3. Render inside the declared browser/font or vector coordinate.
4. Encode each declared width with explicit options.
5. Inspect media type, dimensions, names, containment, and metadata.
6. Build the accessible gallery and semantic companion.
7. Compute the manifest and compare repeated output at one coordinate.
8. Promote the complete family or return the exact durable checkpoint.

## Conditional context

Read [renderer, SVG, and metadata boundaries](references/renderer-svg-and-metadata-boundaries.md)
when Sharp/libvips, browser rendering, SVG definitions, or embedded metadata
affect the decision. Run the [family admission exercise](exercises/README.md)
for one synthetic source and three derivatives.

## Completion

The family is ready when the source, pixels, descriptions, semantic companion,
metadata disposition, responsive delivery, digests, runtime coordinate, and
accepted pointer describe the same meaning. A changed source, rights standing,
description, renderer, font, encoder, target width, cache policy, or receiving
layout opens a new observation or version.
