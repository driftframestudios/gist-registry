# Framework and receiving boundaries

## React Aria and React Stately

React Aria Components supplies high-level unstyled components with interaction
and accessibility behavior exposed through DOM attributes, class names, render
props, and component contracts. React Stately supplies reusable state and
collection models where state ownership benefits from separation.

Use stable globally unique collection IDs. Dynamic collection memoization
follows item object identity, so replace the affected item immutably. A broad
dependency can invalidate a complete collection; prefer the smallest affected
item set. When `useAsyncList` supplies an `AbortSignal`, pass it to the
underlying request and retain a generation check for settlement.

Official sources:

- [React Aria getting started](https://react-aria.adobe.com/getting-started)
- [React Spectrum collections](https://react-spectrum.adobe.com/collections)
- [React Spectrum v3 collections](https://react-spectrum.adobe.com/v3/collections.html)

## Spectrum generations

Spectrum 2 and React Spectrum v3 have distinct package families, provider
contracts, styling systems, and bundler behavior. One executable receiver uses
one coherent generation. A comparison route uses explicit adapters and
fixtures. When generations coexist, place the Spectrum 2 Provider innermost as
Adobe documents.

Spectrum 2's style macro emits atomic CSS at build time. Extract, minify, and
deduplicate through one shared styles bundle. Place an intentional reset in a
lower cascade layer ahead of Spectrum 2's own layer. A custom visual system can
use React Aria Components directly when it owns presentation.

## Observation matrix

At minimum, select the states and conditions that can change the receiving
decision:

| Dimension | Useful observations |
| --- | --- |
| Meaning | accessible name, description, status, order, current accepted coordinate |
| Input | keyboard, pointer, touch, focus-visible, focus return |
| State | pending, accepted, warning, invalid, disabled, stale, interrupted |
| Layout | 320 CSS pixels, 200% and 400% text, LTR, RTL |
| Media | forced colors, reduced motion, print, script-independent reading |
| Performance | source/build/runtime bytes, `N`, transitions, elapsed time, peak memory |

Bind each browser observation to the exact runtime, engine, viewport, media
features, fonts, scale, and dependency lock.
