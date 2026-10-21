# Cross-browser visual-contract observer 0.1.0

## Practical question

Which browser evidence answers a visual-contract decision directly, and how
can a team prove that evidence detects the intended fault while the last
accepted receipt remains available?

This executable uses one compact specimen-review receiver. Five decisions map
to five fitting evidence classes:

| Decision | Primary signal | Controlled fault |
| --- | --- | --- |
| Identify the specimen-family input | Accessible name, visible label bounds, and label geometry | Break the label/control association |
| Preserve accepted state during a late preview | Keyboard focus, generation, and live status | Apply the late response and move focus |
| Read the workflow at narrow width and enlarged text | Viewport, card order and containment, content fit, and every select/button hit target | Overlap the accepted card with the candidate |
| Apply the reviewed Acme-light action token | Computed semantic custom property (`#2546f5`) | Substitute a local gray value |
| Keep the flow connector behind both cards | Changed pixels in a bounded workflow bitmap | Paint the connector above the cards |

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
npm run install:visual-contracts:browsers
npm run test:visual-contracts:observer:browsers:0.1.0
```

The repository command installs the observer, its bound Issue #62 receiver,
and the artifact compiler that shares the exact browser set. The browser
command then builds that receiver package, recomputes the same sorted
production-file manifest used by that package, and requires an
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
and settlement directly. Focused geometry answers clipping, overflow, and both
dimensions of each hit target. Computed style answers accepted token
application. The connector painter-order oracle compares the visible workflow
crop with the same crop while the connector is hidden. At least one changed
pixel establishes that the connector is visible; zero changed pixels inside
the card regions establishes that the cards paint above it. The controlled
fault moves the connector above the cards and must produce changed card pixels.

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
Every exported inventory, matrix, selection, observation, and receipt boundary
copies enumerable own JSON data before decision logic runs. A Proxy value
returns typed `INVALID_CONTRACT` friction before prototype, key, or descriptor
reflection, keeping its traps outside observation. Typed descriptor failures
cross the capture boundary as newly constructed `ObserverError` values whose
code, message, and details came from admitted own data.

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
destination is rejected while the earlier pointer remains available. That
integrity failure returns `accepted_coordinate_recovery`, its digest-safe
`acceptedCoordinate`, and the `inspect_or_quarantine` action so recovery starts
at the accepted coordinate; candidate rebuilding resumes after that coordinate
is resolved.
Reservation release participates in that acceptance boundary. A replaced or
nonempty reservation stops pointer movement and returns the accepted digest for
inspection. When release fails beside another publication error, the primary
outcome retains authority and carries one bounded `cleanupFailure` record.
The exported publication boundary reconstructs each admitted typed failure from
bounded own plain data. The returned `ObserverError` owns its code, message,
and recovery details; bounded fields summarize the originating failure for
diagnostic inspection.
The caller either provisions the directly addressed publication root or passes
the stable `ownerRoot` from which the publisher creates and captures every
descendant directory. Each publication recheck includes that full identity
chain before it advances the private candidate, accepted directory, or pointer
transition. A missing or redirected direct root returns typed
`publication_root` recovery before candidate allocation.

Cooperating publishers capture the prior pointer state, acquire one
pointer-wide exclusive reservation, and compare that captured state before the
atomic pointer rename. Identical replay remains idempotent; overlapping
different-digest publishers return `PUBLICATION_POINTER_CONFLICT` to the
publisher whose captured state became stale. Portable Node.js still addresses
the final verification and `rename` by pathname. A process with the same
filesystem credentials can race those two operations when it acts outside the
reservation protocol. Deployments with mutually untrusted local writers route
publication through one service identity or a platform adapter that provides
directory-descriptor-relative mutation and a no-replace/CAS primitive.

Here, atomic describes what cooperating processes observe at the pointer
rename. Power-loss durability additionally requires filesystem- and
platform-specific directory synchronization plus a recovery policy; this
portable example leaves that guarantee to its deployment adapter.
After an ungraceful process stop, an operator confirms the owning publisher has
stopped and removes the empty digest or pointer reservation before retrying
publication.
Receipt admission allows up to 32 artifacts, 16 MiB per artifact, and 64 MiB
in aggregate. A bounded iterative walk checks normalized observation depth,
node count, and UTF-8 string bytes before publication clones or digests the
receipt. JSON inputs carry a 2 MiB ceiling. Artifact publication opens each
directly addressed regular source through one descriptor, confirms its file
identity and actual byte count, and reads within the declared envelope. Capture
rechecks descriptor device, inode, size, modification time, and change time,
then confirms the final addressed path still names that regular file with the
same bounded metadata. Sparse, oversize, replaced, and symbolic-link sources
return to the candidate boundary before artifact publication.
Failure admission rejects over-limit strings by code-unit length before UTF-8
measurement, so recovery reporting stays within the same bounded-work posture.

## Focused evidence

The package-local model lane establishes the declared behaviors, including exact direct
dependency and lock coordinates, plus distinct
source-manifest, receiver-build, and observed-fixture coordinates, five matched
fault-oracle pairs, closed and bounded inventory/matrix admission, executable
case planning, bounded JSON and artifact-source admission, typed recovery from
descriptor-read failure, unique contained
artifacts, exact artifact-byte totals, concurrent candidate isolation, replay
integrity, and two promotion interruptions. The browser lane exercises the complete declared matrix across
Chromium, Firefox, and WebKit: a digest-bound smoke of the actual Issue #62
production build, exact browser coordinates, every applicable target/scenario
case, every controlled fault, applied matrix rendering/input state, and
script-independent reading. Bitmap receipts retain the visible and
connector-hidden digests plus the total, changed, card-region, and changed-card
pixel counts that determine the verdict.

Playwright WebKit is an upstream WebKit build with Playwright patches. Branded
Safari receives its own observation coordinate. Browser and bitmap claims
remain bound to the recorded engine, operating system, font, scale, and tool
coordinate. Playwright
`1.64.0`/`1.64.1` Linux WebKit revision `2370` also has a documented
`backdrop-filter` performance fault on constrained two-CPU runners. A receiving
harness that uses that CSS feature should classify the matching timeout as an
environment-coordinate exception. WebKit r2373 and later restore the reported
non-overlapping case, while overlapping elements still compound paint time in
r2376. Exercise the receiver's exact overlap composition and retain Playwright
1.63 or another independently validated stable coordinate until a released
successor passes that case.

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
