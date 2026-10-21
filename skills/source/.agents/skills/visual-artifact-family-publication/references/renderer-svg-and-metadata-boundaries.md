# Renderer, SVG, and metadata boundaries

## Sharp and libvips

Sharp 0.35.5 requires Node.js 20.9 or newer. Its prebuilt dependency coordinate
varies by operating system, CPU, and libc; record the runtime libvips value
for each exercised platform coordinate. Shared npm locks can require
care across platforms, so bind byte receipts to OS, architecture, libc, Node,
Sharp, and libvips.

Make WebP quality, alpha quality, effort, lossless/near-lossless, animation, and
color options explicit where they affect bytes. Sharp strips metadata by
default. `keepMetadata()` and `withMetadata()` deliberately retain or add
metadata; select them only when the source contract calls for that outcome.

`metadata()` reads headers and supplies useful dimensions and metadata fields.
It remains one inspection primitive. A separate bounded scanner owns broader
private-data and secret-shaped byte inspection.

Official sources:

- [Sharp installation](https://sharp.pixelplumbing.com/install/)
- [Sharp output API](https://sharp.pixelplumbing.com/api-output/)
- [Sharp input and metadata API](https://sharp.pixelplumbing.com/api-input/)
- [Sharp releases](https://github.com/lovell/sharp/releases)

## SVG graph checks

Inspect IDs and references as a graph. Require unique instance IDs, resolved
local references, bounded external-resource policy, declared `viewBox`, and a
known relationship between connectors and cards in painter order. Exercise
forced colors and print through focused browser observations when the SVG is a
live document or uses CSS inheritance.

Foreign objects and text layout depend on browser and font behavior. Keep a
semantic companion available and bind a raster receipt to the exact browser or
SVG renderer plus fonts.

## Browser and font coordinate

HTML/SVG screenshots depend on engine, OS, scale, headless mode, font files,
font loading, and rendering settings. Wait for the declared fonts and stable
layout signal. Use geometry assertions to protect bounds and painter-order
consequences before raster capture. Another environment receives a separate
comparison receipt.

## Delivery observations

Verify intrinsic dimensions, `srcset`, `sizes`, versioned names, media types,
image-unavailable reading, alternative-text/caption separation, semantic
companion parity, reflow, forced colors, print, and cache behavior at the
receiving route. The delivery observation owns CDN transformation,
negotiation, and cache-rule evidence; the source compiler owns the artifact
family it generated.
