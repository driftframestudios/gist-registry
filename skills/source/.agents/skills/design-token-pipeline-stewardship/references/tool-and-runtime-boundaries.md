# Tool and runtime boundaries

Read this reference when current vendor behavior or package generations affect
a token-pipeline decision. Bind every observation to the installed package,
runtime, and date; vendor documentation can advance independently.

## Current official coordinates observed 2026-10-21

| Boundary | Current coordinate used by the executable family | Material rule |
| --- | --- | --- |
| DTCG | Format Module 2025.10 | First stable Final Community Group Report; its community-group status remains distinct from the W3C Standards Track |
| Style Dictionary | 5.7.0, ESM, Node.js 22+ | Await build APIs; use exact compiler/runtime/lock coordinates |
| React Aria Components | 1.22.1 observed | High-level unstyled behavior and accessible composition |
| React Stately | 3.51.0 observed | Reusable state and collection ownership |
| Spectrum 2 | 1.8.1 package observed | Distinct generation and provider/styling contract |
| React Spectrum v3 | 3.47.7 observed | Distinct package family and provider/theming contract |
| Figma Variables REST | Documentation observed 2026-10-21 | Enterprise access, request-scoped atomicity, separately owned cross-request reconciliation |

Confirm these coordinates during implementation. Package patches and vendor
limits can change after this observation.

## DTCG intake

The Format Module defines token/group structure, explicit or inherited `$type`,
curly-brace aliases, JSON Pointer references, and `$extensions`. A token object
carries `$value`; a group carries children. Group names supply organization;
explicit or inherited `$type` carries type, and token identities carry meaning.
Treat unresolved, circular, and invalid target references as errors. Use
`application/design-tokens+json` and a
`.tokens` or `.tokens.json` extension where media identity matters.

Describe an implementation as “the DTCG Format Module 2025.10 subset used by
this executable.” A complete-coverage claim requires a separate normative test
matrix. The Resolver module has its own version and profile.

Official sources:

- [DTCG technical reports](https://www.designtokens.org/technical-reports/)
- [Format Module 2025.10](https://www.designtokens.org/TR/2025.10/format/)
- [DTCG FAQ](https://www.designtokens.org/faq/)

## Style Dictionary boundary

Style Dictionary 5 is ESM and its build methods are asynchronous. Await
`buildAllPlatforms()`. `formatAllPlatforms()` can produce candidates ahead of
filesystem publication. Set or verify `usesDtcg` for DTCG-shaped input. Keep a
fresh instance per finite coordinate as a repository isolation policy when
build state and plugin registration could otherwise cross coordinates.

Formats, transforms, filters, parsers, preprocessors, actions, JavaScript token
modules, and configuration are executable code. Review their dependencies and
grant a contained candidate path plus the smallest required environment,
network, filesystem, and subprocess authority. Validate writable destinations
before execution.

Official sources:

- [Installation](https://styledictionary.com/getting-started/installation/)
- [API](https://styledictionary.com/reference/api/)
- [Configuration](https://styledictionary.com/reference/config/)
- [DTCG utilities](https://styledictionary.com/reference/utils/dtcg/)
- [Style Dictionary 5.7.0 package](https://github.com/style-dictionary/style-dictionary/blob/v5.7.0/package.json)

## Adobe React boundaries

React Stately owns reusable state and collection models. Stable globally unique
item IDs and immutable item replacement keep identity and memoization legible.
React Aria owns keyboard, focus, pointer, labeling, locale, and assistive-
technology behavior. State attributes and render props provide styling inlets.

Spectrum 2 and React Spectrum v3 are distinct generations. Use explicit
adapters and comparison fixtures. When generations coexist, Adobe places the
Spectrum 2 Provider innermost. Spectrum 2's build-time style macro produces
atomic CSS; extraction, minification, deduplication, and a shared styles bundle
keep delivery coherent. Place an intentional reset in a lower cascade layer
ahead of Spectrum 2's layer.

Official sources:

- [React Aria getting started](https://react-aria.adobe.com/getting-started)
- [Spectrum 2 collections](https://react-spectrum.adobe.com/collections)
- [React Spectrum v3 collections](https://react-spectrum.adobe.com/v3/collections.html)
- [Spectrum 2 releases](https://react-spectrum.adobe.com/releases/index.html)

## Figma Variables mutation boundary

Local and published GET routes carry different fields; the published route
omits modes. POST applies collection, mode, variable, then mode-value arrays in
order and supplies request-scoped atomicity. A request can carry up to 4 MB,
with documented collection and mode limits. Temporary IDs belong to one
request. A multi-request synchronization needs a participating-writer lease,
rolling checkpoint, stable intent IDs, durable temp-to-real mapping, and a
read/reconcile step after an unknown outcome.

The Variables REST route currently belongs to Figma's Enterprise offering.
Read access requires the documented membership, file access, and
`file_variables:read` scope; mutation requires a Full seat or admin, edit
access, and `file_variables:write`. Published-variable `subscribed_id` changes
after modify-and-publish while `id` and `key` remain stable, so reconciliation
uses the stable identities. Figma also documents a 400 response when a string
variable bound to text uses a shared organization font; surface that as a
typed compatibility result.

Figma documents request atomicity and supplies `Retry-After` for rate limiting.
Checkpoint and replay design remain application policy. A resolved type stays
fixed after creation; create a successor identity and rewire aliases for a type
change. REST mutation and shared-library publication are separate operations.
Record the observed plan tier and rate-limit headers because published limits
can change after this reference date.

Official sources:

- [Variables API](https://developers.figma.com/docs/rest-api/variables/)
- [Variables endpoints](https://developers.figma.com/docs/rest-api/variables-endpoints/)
- [Rate limits](https://developers.figma.com/docs/rest-api/rate-limits/)
- [REST errors](https://developers.figma.com/docs/rest-api/errors/)

## Complexity and receipt

For `n` tokens and `e` references, indexed admission and graph traversal target
`O(n + e)` time and space. For `p` platforms, `t` constant-cost transforms,
and `f` full-dictionary formatters, compilation is approximately
`O(p(tn + fn) + z)` for `z` generated bytes. A transform that scans all tokens
for each token approaches `O(n²)` and merits an indexed replacement.

Record source/config/lock digests, exact compiler and runtime, limits and
maxima, graph counts, variant matrix, artifact digests, grammar checks,
semantic changes, receiving checks, accepted pointer, and restart point.
