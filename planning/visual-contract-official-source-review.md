# Visual-contract executable source review

Review date: 2026-10-21. Receiving work: Issues #61–#65.

## Purpose

This note binds the visual-contract executables to official upstream sources
and names the claims that belong to an exact dependency or service coordinate.
The executable lockfile and generated receipt carry runtime authority. Rolling
documentation supplies current guidance and prompts a fresh review at the next
dependency upgrade.

## Source and version matrix

| Concern | Official source | Coordinate observed | Implementation boundary |
| --- | --- | --- | --- |
| Design Tokens Community Group | [Format Module 2025.10](https://www.designtokens.org/TR/2025.10/format/), [Resolver Module 2025.10](https://www.designtokens.org/tr/2025.10/resolver/), [technical reports](https://www.designtokens.org/technical-reports/) | Stable Final Community Group Reports, 2025.10 | Describe the implemented Format Module subset and bind Resolver behavior to stable 2025.10. Treat additions from later living drafts as draft-scoped until a successor report stabilizes them. |
| Style Dictionary | [installation](https://styledictionary.com/getting-started/installation/), [API](https://styledictionary.com/reference/api/), [configuration](https://styledictionary.com/reference/config/), [DTCG utilities](https://styledictionary.com/reference/utils/dtcg/), [reference utilities](https://styledictionary.com/reference/utils/references/), [v5 migration](https://styledictionary.com/versions/v5/migration/) | 5.7.0; repository package envelope Node.js 22–26 | Await asynchronous builds, retain the exact lock coordinate, and use `formatAllPlatforms()` when review should precede filesystem writes. |
| React Aria Components and React Stately | [React Aria getting started](https://react-aria.adobe.com/getting-started), [Adobe source](https://github.com/adobe/react-spectrum) | `react-aria-components` 1.22.1; `react-stately` 3.51.0 observed in the package registry | Use React Aria Components as the unstyled compositional receiver. Give React Stately explicit state and collection ownership. Bind package and import claims to the lockfile. |
| React Spectrum | [Spectrum 2 collections](https://react-spectrum.adobe.com/collections), [Spectrum v3 collections](https://react-spectrum.adobe.com/v3/collections.html), [Spectrum 2 releases](https://react-spectrum.adobe.com/releases/index.html), [Spectrum 2 styling](https://react-spectrum.adobe.com/styling) | Spectrum 2 stable since 1.0.0; named release 1.8.0 on 2026-10-08; package patch 1.8.1 observed | Treat Spectrum 2 and React Spectrum v3 as distinct generations. When both operate in one tree, Adobe directs the Spectrum 2 Provider to the innermost position. |
| Playwright | [browser installation](https://playwright.dev/docs/browsers), [test setup](https://playwright.dev/docs/intro), [visual comparisons](https://playwright.dev/docs/test-snapshots), [ARIA snapshots](https://playwright.dev/docs/aria-snapshots) | 1.64.1 observed | Reinstall the matching browser binaries after package upgrades. Bind visual receipts to package, browser revision, OS, fonts and render settings. |
| Sharp and libvips | [installation](https://sharp.pixelplumbing.com/install/), [output API](https://sharp.pixelplumbing.com/api-output/), [input metadata](https://sharp.pixelplumbing.com/api-input/), [releases](https://github.com/lovell/sharp/releases) | Sharp 0.35.5; Node 20.9+; runtime libvips coordinate varies by package and platform | Record Node, OS, architecture, libc, Sharp and runtime libvips. Declare materially relevant WebP options explicitly and verify the output artifact. |
| Figma Variables REST API | [overview](https://developers.figma.com/docs/rest-api/variables/), [endpoints](https://developers.figma.com/docs/rest-api/variables-endpoints/), [rate limits](https://developers.figma.com/docs/rest-api/rate-limits/), [errors](https://developers.figma.com/docs/rest-api/errors/) | Service behavior observed 2026-10-21 | Bind rate numbers and endpoint behavior to the observation date. Reconcile live state before replaying an unknown-outcome write. |

## Material boundaries

### DTCG and Style Dictionary

- A DTCG token is an object with a `$value`; its path supplies its address. A
  token and a group remain distinct objects.
- Group names organize content. `$type` supplies type meaning through an
  explicit, inherited or resolved value.
- `$extensions` carries vendor data and merits preservation during lossless
  transformations.
- Curly references and JSON Pointer references have defined behavior. The
  pipeline reports unresolved references, reference cycles and invalid targets
  as errors.
- Style Dictionary v5 uses asynchronous build methods and ESM. The executable
  awaits each finite build and records the exact dependency coordinate.
- `usesDtcg` can be explicit. DTCG conversion inside a preprocessor should
  account for Style Dictionary's earlier group-type delegation.
- A fresh build instance, candidate-first formatting and receipt design are
  repository decisions that strengthen reproducibility; upstream documentation
  leaves those orchestration choices to the caller.

### React Aria, React Stately and Spectrum

- React Aria Components supplies accessible behavior, default DOM structure
  and inspectable interaction state while leaving the visual contract to the
  product.
- React Stately supplies reusable state and collection ownership where the
  interaction model benefits from separation from rendering.
- Stable, globally unique item identifiers preserve collection identity.
  Immutable replacement of a changed item works with collection memoization.
- `useAsyncList` supplies an `AbortSignal`; forwarding it to network work gives
  the interaction a direct cancellation path.
- Spectrum 2 style macros run at build time. Adobe recommends extracting,
  deduplicating and minifying their atomic CSS in one shared bundle.
- A retained global reset belongs in a lower cascade layer before Spectrum 2's
  `_` layer. Custom visual contracts fit React Aria Components more directly
  than broad `UNSAFE_className` overrides.

### Browser and image receipts

- Playwright versions carry matching browser revisions. `playwright install`
  refreshes that set; `playwright install --with-deps` also provisions common
  CI system dependencies.
- Playwright WebKit represents upstream WebKit with Playwright patches. A macOS
  run gives the closest available automated Safari-family observation, while a
  branded Safari check remains a separate observation.
- Screenshot bytes can vary across OS, browser revision, fonts, graphics stack,
  headless mode and machine settings. The receipt records those coordinates and
  compares within one declared environment.
- Semantic assertions answer state and geometry questions. Screenshot
  comparisons answer visual-pixel questions. ARIA snapshots answer
  accessibility-tree questions.
- Sharp strips metadata by default. A public derivative pairs that behavior
  with an output metadata check. `keepMetadata()` and `withMetadata()` represent
  deliberate retention routes.
- `metadata()` reads image headers efficiently. A dedicated bounded scanner
  examines secret-shaped values in EXIF, XMP and IPTC when that assurance is in
  scope.

#### Playwright 1.64.x WebKit exception

Playwright maintainers reproduced a Linux WebKit r2370 regression in 1.64.0
and 1.64.1 where pages using `backdrop-filter` can render at approximately zero
frames per second on two-CPU runners. WebKit r2373 and later restore the
reported non-overlapping case. A maintainer's follow-up records a partial
repair: overlapping `backdrop-filter` elements still compound paint time
severely in r2376. See the
[official issue](https://github.com/microsoft/playwright/issues/43426).

Treat this as a coordinate- and composition-specific environment exception.
Exercise the receiver's exact overlap composition before advancing the browser
coordinate. A stable harness can retain Playwright 1.63 or another independently
validated coordinate until a released successor passes that case. Publication
examples remain on stable dependencies.

### Figma Variables

- The Variables REST API serves Enterprise files. Read access uses
  `file_variables:read`; writes require a Full seat or administrator, edit
  access and `file_variables:write`.
- Local reads include modes. Published reads omit modes and accept a main file
  key. REST writes update the file; library publication remains a separate
  action.
- A write request applies `variableCollections`, `variableModes`, `variables`
  and `variableModeValues` in that order, including array order within each
  group.
- One request body is atomic. A validation failure returns `400` and persists
  zero changes. The body limit is 4 MB; each collection supports up to 40 modes
  and 5,000 variables.
- Temporary identifiers are unique within one request and the response maps
  them to durable identifiers.
- A variable's resolved type is fixed at creation. Type migration creates a
  successor variable and repoints aliases and bindings.
- Published `id` and `key` remain stable for the variable lifetime;
  `subscribed_id` changes when a variable is modified and published.
- A string variable bound to text that uses a shared organization font can
  yield a `400` during update. The preflight and failure message should name
  that Figma constraint.
- Current rate limiting uses a leaky bucket. Variables reads are Tier 2 and
  writes are Tier 3. The Enterprise table observed on the review date lists
  100 Tier-2 requests per minute and 150 Tier-3 requests per minute for Dev or
  Full seats. A `429` response supplies integer `Retry-After` seconds and Figma
  plan/rate-limit headers.
- Request-level atomicity is an upstream guarantee. Stable intent identifiers,
  durable checkpoints, leases and reconcile-before-replay are application
  design decisions. The documented guarantee ends at one request, so the
  application treats every following request as a separately recoverable
  operation.

## Receipt fields

Each executable can make its claim inspectable with:

1. source-specification or service-observation coordinate;
2. exact dependency lock and runtime versions;
3. operating-system, architecture and browser or native-library coordinate;
4. input and output hashes;
5. explicit transformation, rendering and comparison options;
6. observed outcome, including holds and recoverable failures; and
7. the next actor and re-entry action.

Revisit this note when a dependency, browser binary, Figma rate table or DTCG
report coordinate changes.
