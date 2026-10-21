# Browser evidence and variance

## Coordinate the environment

Bind browser observations to the exact Playwright package and browser binary,
operating system image, architecture, font inventory, headless mode, viewport,
device scale, color scheme, forced colors, motion preference, locale, and
source/receiver digests. Reinstall Playwright browser binaries after a package
upgrade so package and executable remain matched.

`PLAYWRIGHT_BROWSERS_PATH=0` can keep a browser install project-local. Choose
the installation policy that fits the receiving environment and record it.

## Evidence classes

- Use locator, role, accessible-name, description, relationship, and ARIA
  snapshots for semantic contracts.
- Use focus, keyboard, pointer, touch, network, and state assertions for
  interaction contracts.
- Use bounding boxes and computed geometry for clipping, overlap, seams, hit
  targets, and SVG painter-order consequences.
- Use computed styles for semantic-token application.
- Use `toHaveScreenshot()` for bounded appearance relationships under one
  declared environment.

Bitmap output can vary across engines, operating systems, fonts, scale,
hardware, and rendering modes. Keep comparison baselines coordinate-specific.

Official sources:

- [Playwright browsers](https://playwright.dev/docs/browsers)
- [Visual comparisons](https://playwright.dev/docs/test-snapshots)
- [ARIA snapshots](https://playwright.dev/docs/aria-snapshots)

## Current WebKit exception

Playwright 1.64.0 and 1.64.1 pin Linux WebKit r2370. Playwright maintainers
reproduced severe `backdrop-filter` rendering slowdown on constrained two-CPU
runners. WebKit r2373 and later restore the reported non-overlapping case;
overlapping `backdrop-filter` elements still show compounding slowdown in
r2376. Record the browser, resource, and overlap composition as one environment
coordinate. Retain Playwright 1.63 or another independently validated stable
coordinate until a released successor passes the receiving project's exact
composition.

Official issue: [Playwright #43426](https://github.com/microsoft/playwright/issues/43426)

## Tier selection

Let `T` targets, `S` states, `B` browsers, `M` media variants, and `O` selected
oracles define an upper bound of `T × S × B × M × O`. Smoke and changed-boundary
tiers select a documented subset. Record selected and skipped inventory through
affirmative scope statements such as “selected three changed decisions across
all declared engines.”
