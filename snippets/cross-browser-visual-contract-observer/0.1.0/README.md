# Cross-browser visual-contract observer 0.1.0

## Practical question

Which browser evidence answers a visual-contract decision directly, and how
can a team prove that evidence detects the intended fault while the last
accepted receipt remains available?

This executable uses one compact specimen-review receiver. Five decisions map
to five fitting evidence classes:

| Decision | Primary signal | Controlled fault |
| --- | --- | --- |
| Identify the specimen-family input | Accessible name and label geometry | Break the label/control association |
| Preserve accepted state during a late preview | Keyboard focus, generation, and live status | Apply the late response and move focus |
| Read the workflow at narrow width and enlarged text | Viewport, scroll, and hit-target geometry | Give the workflow a fixed wide inline size |
| Apply the reviewed Acme-light action token | Computed semantic custom property (`#2546f5`) | Substitute a local gray value |
| Keep the flow connector behind both cards | Bounded workflow bitmap plus layer reading | Paint the connector above the cards |

The visible labels sit above their controls, retain programmatic association,
and remain visible through narrow and enlarged-text observations. The native
select caret uses a logical-end inset anchored at 12–17 CSS pixels, with
separate LTR and RTL positions.

## Run the package

From the repository root:

```sh
npm --prefix snippets/cross-browser-visual-contract-observer/0.1.0 ci --ignore-scripts
npm --prefix snippets/cross-browser-visual-contract-observer/0.1.0 test
npm --prefix snippets/cross-browser-visual-contract-observer/0.1.0 run example
```

The example uses an explicitly named `model_fixture` environment and promotes
one typed receipt per applicable smoke observation case. Its output also shows
the complete smoke case plan. Launched-browser receipts carry the separate
`browser_runtime` environment kind.

Install and exercise the exact browser binaries when the receiving environment
owns browser execution:

```sh
npm --prefix snippets/react-aria-visual-contract-receiver/0.1.0 ci --ignore-scripts
npm --prefix snippets/cross-browser-visual-contract-observer/0.1.0 run install:browsers
npm --prefix snippets/cross-browser-visual-contract-observer/0.1.0 run test:browser
```

The browser command first builds the bound Issue #62 package, recomputes the
same sorted production-file manifest used by that package, and requires an
exact receiver-coordinate digest before case-plan execution. It then
serves those production bytes locally for one focused interactive smoke in
each engine. The independent faultable fixture remains the subject of the
decision-oracle receipts, which observe the exact `source/receiver.html`
fixture bytes. The focused production smoke supplies Issue #62 runtime evidence.

Playwright `1.64.1` resolves Chromium `156.0.8078.4` revision `1248`, Firefox
`157.0` revision `1555`, and WebKit `27.2` revision `2370` on this package
line. Runtime receipts also record the launched product version, Node version,
operating system, architecture, font declaration, viewport/media state, and
headless standing.

## Evidence selection contract

Each target in [`inventory/decisions.json`](inventory/decisions.json) names:

1. the decision it protects;
2. the observed behavior;
3. one plausible controlled fault;
4. the strongest fitting oracle;
5. the scenarios in which that oracle directly answers the decision;
6. the scenario that carries its controlled fault;
7. the consequence of failure; and
8. the source boundary that receives repair.

Semantic and interaction assertions answer names, relationships, state, focus,
and settlement directly. Focused geometry answers clipping, overflow, and hit
targets. Computed style answers accepted token application. A workflow-only
bitmap accompanies the connector painter-order assertion because that visual
relationship exceeds the semantic tree; the layer reading keeps diagnosis
specific.

## Finite matrix and tier choice

[`inventory/matrix.json`](inventory/matrix.json) declares ten scenarios that
cover 320 CSS pixels, 200% and 400% text, LTR, RTL, forced colors, print,
reduced and full motion, missing image, missing font, keyboard, pointer, touch,
pending, accepted, success, warning, invalid, stale, and script-independent
reading.

Three tiers report why they ran:

- `smoke` selects six executable cases: two baseline observations, their two
  controlled faults, baseline state coverage, and script-independent reading;
- `changed_boundary` selects named targets across four representative
  scenarios; the documented two-target example produces twelve cases; and
- `full` selects all five targets and ten scenarios, then executes 57 cases per
  browser: 42 applicable observations, five controlled faults, and ten
  scenario-contract checks.

The selector forms an explicit applicability join before Playwright opens a
browser context. Each emitted case names its target and scenario, or names one
scenario-contract check. For targets `T`, selected scenarios `S`, emitted cases
`C`, and browsers `B`, `C ≤ T × S + T + S` and executed work is `O(C × B)`.
`expectedWork` equals the emitted case count rather than an unevaluated
Cartesian estimate. Inventory and selection use indexed identifiers and linear
passes outside the bounded join. Admission closes the inventory and matrix
field sets and caps each at 64 entries, identifiers at 256 UTF-8 bytes, prose
fields at 16 KiB, and viewport dimensions at 8192 CSS pixels per axis. The
receipt records the exact case ID, assertion count, elapsed milliseconds,
emitted bytes, and peak resident memory so another receiver can set its own
budget.

## Receipts and recovery

[`schema/receipt.schema.json`](schema/receipt.schema.json) requires case,
target, and decision identity, an Issue #61 `generated_output_manifest`, an Issue #62
`production_build_manifest`, the exact synthetic fixture bytes actually
observed, browser/runtime coordinates, every selected matrix dimension,
observation type, normalized result, contained artifact references,
measurements, standing, variability classification, and restart point. The
JSON receipt travels with a compact Markdown reading that repeats these three
distinct identities. Separately, the actual-build smoke binds and exercises
Issue #62's production bytes; the synthetic subject receipts establish the
harness's controlled-fault/oracle behavior at its named fixture coordinate.

Each publication invocation writes its already-verified artifact bytes into a
UUID-owned candidate directory. Concurrent identical publishers converge on
one digest-addressed accepted directory and one atomic pointer value. Replay
rechecks the complete accepted inventory, metadata companions, and artifact
digests before moving the pointer. The focused tests inject interruption after
candidate writing and after accepted bytes are verified; both paths preserve
the earlier pointer and return a named restart checkpoint. A corrupted existing
destination is rejected while the earlier pointer remains available.
Receipt admission allows up to 32 artifacts, 16 MiB per artifact, and 64 MiB
in aggregate. A bounded iterative walk checks normalized observation depth,
node count, and UTF-8 string bytes before publication clones or digests the
receipt. JSON inputs carry a 2 MiB ceiling. Artifact publication opens each
directly addressed regular source through one descriptor, confirms its file
identity and actual byte count, and reads within the declared envelope. Sparse
oversize files and symbolic-link sources return to the candidate boundary
before body capture.

## Focused evidence

The package-local model lane establishes 38 behaviors, including exact direct
dependency and lock coordinates, plus distinct
source-manifest, receiver-build, and observed-fixture coordinates, five matched
fault-oracle pairs, closed and bounded inventory/matrix admission, executable
case planning, bounded JSON and artifact-source admission, typed recovery from
descriptor-read failure, unique contained
artifacts, exact artifact-byte totals, concurrent candidate isolation, replay
integrity, and two promotion interruptions. The browser lane exercises 177 checks across
Chromium, Firefox, and WebKit: a digest-bound smoke of the actual Issue #62
production build, exact browser coordinates, every applicable target/scenario
case, every controlled fault, applied matrix rendering/input state, and
script-independent reading.

Playwright WebKit is an upstream WebKit build with Playwright patches. Branded
Safari receives its own observation coordinate. Browser and bitmap claims
remain bound to the recorded engine, operating system, font, scale, and tool
coordinate. Playwright
`1.64.0`/`1.64.1` Linux WebKit revision `2370` also has a documented
`backdrop-filter` performance fault on constrained two-CPU runners. A receiving
harness that uses that CSS feature should classify the matching timeout as an
environment-coordinate exception and move to a validated released coordinate
that contains the later WebKit roll.

## Adaptation route

1. Advance the bound candidate generated-output and production-build digests
   to accepted coordinates while retaining the observed subject digest.
2. Name the receiver decisions and plausible faults before adding assertions.
3. Keep one primary oracle per decision; add a companion only when it improves
   diagnosis.
4. Choose smoke, changed-boundary, or full coverage from the changed decision
   boundary.
5. Run the controlled faults before accepting the oracle.
6. Promote one complete receipt set and preserve its rollback pointer.

## Source, evidence, and transfer boundary

The receiver, observations, faults, identifiers, and fixtures are synthetic
Apache-2.0 material. The checks establish the declared behavior for Playwright
`1.64.1`, its lock-resolved browser revisions, and the exercised macOS ARM64
environment. The Issue #62 smoke establishes its named production-build digest
and focused interactive behavior. The fault-oracle receipts separately
contain the local synthetic fixture they actually observed. A product receiver
supplies its own design intent, source and receiver digests, exact observed
subject, browser/assistive-technology matrix, fonts, bitmap tolerance,
performance budget, and release decision.
