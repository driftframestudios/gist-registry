# React Aria visual-contract receiver — 0.1.0

## Practical value

A token pipeline becomes useful when receiving controls preserve both the
visual intent and the interaction contract. This exemplar sends one bounded
web token coordinate into two routes:

- a native HTML select whose label, keyboard behavior, and fallback reading
  come from browser semantics; and
- a React Aria Components select backed by a React Stately collection with
  stable product IDs.

Both routes use the same framework-neutral state machine. Draft choice,
asynchronous request, accepted state, and released receipt keep separate names.
An AbortSignal cancels superseded or unmounted work, generation checks reject
responses that still arrive late, terminal settlement replays preserve the
accepted or rejected authority, and repeated release remains safe to inspect.

## Start here

Requires Node.js 22, 24, or 26. The checked lock resolves in Node.js `26.11.0`;
some development-only transitive packages require a current Node 22, 24, or 26
maintenance release.

```sh
npm --prefix snippets/react-aria-visual-contract-receiver/0.1.0 ci --ignore-scripts
npm --prefix snippets/react-aria-visual-contract-receiver/0.1.0 test
npm --prefix snippets/react-aria-visual-contract-receiver/0.1.0 run dev
```

The test command runs pure model tests, jsdom component interaction tests, and
two isolated Vite production builds. Each build carries the interactive,
native, and semantic routes with relative asset links. The build verifier
requires matching byte manifests, inventories output inside explicit entry and
directory-depth limits, and reads or hashes descriptor-owned regular files
inside explicit byte limits. It checks every measured dimension against a
review threshold and writes the local observation to the ignored
`.artifacts/react-aria-visual-contract-receiver/last-receipt.json` route. The
development command prints the local URL for the interactive comparison.

## Read the package by responsibility

| Responsibility | Source | Decision it owns |
| --- | --- | --- |
| Stable domain identities and transitions | [`src/model.mjs`](src/model.mjs) | Draft, generation-gated request settlement, acceptance, and idempotent release |
| Subscription boundary | [`src/controller.mjs`](src/controller.mjs) | Framework-neutral state ownership and change notification |
| React receiver | [`src/app.jsx`](src/app.jsx) | React Aria behavior, React Stately collection data, focus return, and live status |
| Native receiver | [`source/native-receiver.html`](source/native-receiver.html) | A browser-semantic comparison route with a native select, disclosure, and direct navigation to the interactive receiver |
| Semantic companion | [`source/semantic-reading.html`](source/semantic-reading.html) | Script-independent explanation of state and rendering responsibilities |
| Accepted token dependency | [`source/token-coordinate.json`](source/token-coordinate.json) | Exact generated artifact plus deterministic bounded-projection identity |
| Token projection | [`tools/token-projection.mjs`](tools/token-projection.mjs) | Named selection, rename, and exact value-normalization adapter |
| Visual conditions | [`src/styles.css`](src/styles.css) | Labels, caret inset, logical layout, reflow, forced colors, motion, and print |
| Build and budget contract | [`config/build-budgets.json`](config/build-budgets.json), [`expected/build-budget-contract.json`](expected/build-budget-contract.json) | Authored-source, dependency, state, runtime, source-map, and complete-build review thresholds |
| Bounded file operations | [`tools/bounded-files.mjs`](tools/bounded-files.mjs) | Directory entry and depth admission, regular-file identity, descriptor-owned reads, streaming hashes, and byte envelopes |
| Reproducibility verifier | [`tools/verify-build.mjs`](tools/verify-build.mjs) | Two isolated builds, bounded byte manifests, compressed size, measured values, and an environment-bound observation receipt |

## State and authority

```text
stable specimen ID
  → draft choice
  → request generation
  → AbortSignal cancellation of superseded work
  → current-generation settlement
  → accepted coordinate
  → idempotent release receipt
```

| State | Owner | Durable meaning |
| --- | --- | --- |
| Draft | Visitor interaction | The specimen ID currently selected in either receiver |
| Request | Domain controller | The draft captured with one monotonic generation and settlement state |
| Accepted | Settlement transition | The current generation that passed the preview decision |
| Released | Release transition | One stable receipt bound to the accepted generation and specimen ID |

A later request takes settlement authority by aborting pending work and advancing
the generation. A response that escapes cancellation returns `stale` and leaves
current state intact. Once the matching request settles, a repeated matching
outcome returns `settlement_replayed`; a different outcome returns
`settlement_conflict`. Both paths preserve the accepted or rejected authority
and any release receipt. A rejected current request keeps the earlier accepted
coordinate available. Releasing the same accepted coordinate again returns the
same receipt.

The controller admits listener functions before subscription. A transition
commits its frozen domain state, captures the current subscriber set, and gives
every listener in that snapshot one delivery attempt. Subscription changes made
inside a callback take effect on the next transition. When callbacks throw, the
controller completes the snapshot and raises `ReceiverNotificationError`. Its
owned aggregate records listener positions and the exact committed state while
caller-thrown values stay at the caller boundary. Recovery can therefore read
`error.committedState`, repair the subscriber, and render the state that already
holds authority.

## Accepted token coordinate

[`source/accepted-token-fixture.css`](source/accepted-token-fixture.css) is a
bounded projection of the `style-dictionary-dtcg-pipeline@0.1.0`
`acme / light` coordinate. It carries only the roles this receiver uses:
color, spacing, border, focus, logical caret inset, and state-change duration.
`receiver-css-token-projection-v1` defines this semantic subset by selecting
the declarations the receiver uses, shortening the five `layout-*` /
`motion-*` receiver names, and exactly normalizing `0.12s` to `120ms`.

[`source/token-coordinate.json`](source/token-coordinate.json) records the
source family, version, coordinate, canonical path, fixture digest, and one
explicit re-entry action. It binds both the exact Issue 61 candidate
generated-output manifest digest
`cbf95d97e2ecf981dfb195d013b5f3412e93513d49568086af348aa1e6a03b79`
and its `acme-light/tokens.css` artifact digest
`7a5d1503f28c80f671fc27a6fbe879fbc532a55879d0f82db1c871158f29a632`.
The model lane hashes a byte-exact upstream test fixture, applies the recorded
selection, rename, and normalization map, then compares every projected
declaration with the receiver fixture. Issue 61 still owns human source
acceptance; integration confirms both upstream digests and advances
`manifestStanding` when the source coordinate settles.

## Interaction and reading contracts

### Labels and controls

- Each visible label sits immediately above its control.
- Native and React Aria controls share the label “Specimen state” and stable
  option IDs.
- The select caret sits `12px` from the logical end edge, so right-to-left
  layout receives the same spacing intent.
- Focus indication uses a high-contrast token and remains visible in forced
  colors.

### Keyboard, focus, and status

- The native route keeps native select, link, and disclosure keyboard behavior.
- React Aria supplies select, popover, listbox, option, and press behavior.
- Acceptance returns focus to the button that initiated the preview.
- One polite, atomic status region announces draft, pending, accepted,
  rejected, release-ready, and released outcomes.

### Alternate rendering conditions

- Flexible grids and logical properties support narrow reflow and right-to-left
  documents.
- Forced-colors styles preserve boundaries, focus, and selected state.
- Reduced-motion styles settle transitions immediately.
- Print styles remove interaction controls and preserve readable state and
  semantic content.

The standalone native and semantic documents remain fully readable from their
authored HTML. The React route adds interaction richness while the underlying
operating contract stays available to script-independent readers.

## Evidence map

| Command | Establishes |
| --- | --- |
| `npm run test:model` | Separate state ownership, generation gating, stale settlement, terminal replay and conflict authority, rejection preservation, idempotent release, listener admission, notify-all snapshot delivery, committed-state notification recovery, bounded file admission, dependency pins, exact upstream artifact and projection mapping, fixture digest, static semantics, and CSS condition contracts |
| `npm run test:dom` | Rendered labels, label-before-control order, native interaction, superseded-work and unmount cancellation, focus return, live status, accepted coordinate, and stable release receipt in jsdom |
| `npm run build` | React, React Aria Components, React Stately, CSS imports, and source modules form a browser-loadable production bundle whose interactive, native, and semantic routes resolve together |
| `npm run verify:build` | Two isolated builds produce the same bounded file inventory and digests; deterministic measurements match their baseline; profile-sensitive gzip measurement carries its Node/zlib/platform coordinate; every dimension stays within its review threshold |

The DOM suite supplies component evidence in jsdom. A receiving release adds
its complete browser and assistive-technology matrix across Chromium, Firefox,
and WebKit at narrow and wide viewports, 200% zoom,
right-to-left direction, forced colors, reduced motion, keyboard-only use, and
its supported screen-reader combinations.

## Complexity and allocation

Let `S` be the number of stable specimens, `L` the number of controller
subscribers, `E` the admitted build entries, and `B` the admitted build bytes.

- collection indexing costs `O(S)` time and space once;
- each state transition and specimen lookup costs expected `O(1)` time;
- subscriber notification costs `O(L)` time and snapshot space; an owned failure
  aggregate retains `O(F)` summaries for the `F <= L` callbacks that threw;
- rendering the closed select costs `O(1)` plus framework work; opening the
  listbox renders `O(S)` options; and
- each accepted or released state retains bounded `O(1)` domain data;
- build inventory costs `O(E)` time and path space within the configured entry
  and depth envelope; and
- build hashing costs `O(B)` time with a fixed-size chunk, while a requested
  content read allocates only after its descriptor size passes the byte limit.

For long or remote collections, a receiver should add an explicitly measured
virtualization and loading contract while stable IDs and domain settlement stay
outside view positions.

## Transfer boundary

This package establishes the local state machine, AbortSignal ownership, component semantics, exact
dependency graph, provenance-bound token projection, DOM interaction behavior, and browser
bundle in the resolved environment. A receiving product retains authority for
its token-manifest acceptance, content, locale, browser and assistive-technology
support matrix, preview service, authorization, persistence, analytics,
performance budget, security posture, and release decision.

## Measured build and review budgets

The reviewed Node.js `26.11.0`, zlib `1.2.12`, Vite `8.3.5`, macOS ARM64
coordinate produced the following baseline. Authored and emitted byte counts,
dependency counts, specimens, transitions, and the build manifest remain exact
across the supported Node lanes. Gzip size belongs to its Node, zlib, platform,
architecture, format, and level coordinate because compression implementations
can produce distinct valid byte streams. Every profile must remain within the
declared threshold; a matching profile must also match its exact reviewed
observation.

| Dimension | Measured | Review threshold |
| --- | ---: | ---: |
| Authored receiver source | 69,425 bytes | 70,000 bytes |
| Direct runtime and development dependencies | 9 | 12 |
| Lock-resolved package entries | 128 | 150 |
| Stable specimens | 3 | 25 |
| Domain transition operations | 4 | 6 |
| Runtime JavaScript | 407,769 bytes | 430,000 bytes |
| Runtime JavaScript, gzip level 9 (reviewed profile) | 126,142 bytes | 135,000 bytes |
| HTML, CSS, and JavaScript runtime assets | 424,204 bytes | 440,000 bytes |
| Source map | 2,215,942 bytes | 2,300,000 bytes |
| Complete production build | 2,640,146 bytes | 2,700,000 bytes |

The two-build manifest digest is
`4a3a1dc6534a17288dd6ae09c416009415e52c2bdb400dfca39b4f9916bb95c8`.
The receipt records the active gzip coordinate, elapsed time, and peak resident
memory as environment-bound observations beside the byte-exact build manifest.

## Local evidence publication boundary

The build verifier writes `last-receipt.json` through an invocation-owned
temporary file, rechecks the captured owner chain and leaf identity, and then
uses one atomic rename for process-visible replacement. Portable Node.js
addresses the final verification and rename by pathname. A process with the
same filesystem credentials can race that interval when it writes outside this
ownership protocol. A deployment with mutually untrusted local writers routes
the evidence write through one service identity or a platform adapter with
directory-descriptor-relative mutation and a no-replace/CAS primitive.

Atomic replacement describes process-level visibility. Power-loss durability
also requires filesystem- and platform-specific directory synchronization and
a restart policy; the receiving deployment owns that guarantee.
