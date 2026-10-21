---
name: semantic-visual-receiver-contracts
description: Carries one visual contract into native HTML or component frameworks while domain state, interaction behavior, presentation, asynchronous settlement, and accessible reading remain separately owned and observable.
---

# Semantic visual receiver contracts

## Contract

- **What:** A receiver architecture that preserves token meaning and named UI
  states while each runtime layer retains its responsibility.
- **When:** Native HTML, React Aria, React Stately, Spectrum, or another
  component system receives semantic tokens and asynchronous domain behavior.
- **Boundaries:** Domain owners accept business state; interaction libraries
  supply documented behavior; CSS owns presentation; release owners accept the
  complete receiver coordinate.
- **Result:** Equivalent named states across receivers, stable identity,
  accessible controls, reconciled asynchronous work, and a recovery receipt.

## Responsibility map

| Layer | Owns |
| --- | --- |
| Domain model | Accepted records, business invariants, release and rollback coordinates |
| Controller | Request generation, cancellation, stale-result classification, idempotent promotion |
| State library | Reusable collection, selection, and local interaction state |
| Interaction library | Keyboard, focus, pointer, touch, labeling, locale, and accessibility behavior |
| CSS/token adapter | Semantic token consumption, visual states, layout, media behavior |
| Receiver shell | Reading order, script-independent meaning, status and recovery placement |

## Rules

### Named states form the shared contract

Declare default, focus-visible, pressed, selected, invalid, disabled, pending,
success, warning, and any domain-specific states. Native and framework routes
use the same semantic names even when their DOM or API shapes differ.

### Local intent and accepted state remain distinct

Keep current selection, draft input, active request, candidate response, and
accepted domain state separately observable. A pending or rejected candidate
leaves the accepted coordinate available.

### Stable identity governs asynchronous settlement

Use stable item IDs plus a monotonically increasing request generation. Abort
superseded work where the API supports it. Classify a late response by identity
and generation before applying it. Release actions carry a stable intent key so
retry and duplicate activation converge on one accepted outcome.

### Labels and controls scan together

Place visible labels above their controls where vertical scanning is the
primary layout, and retain native or ARIA programmatic association. Keep help,
constraints, error text, and status connected through documented semantics.
Treat the visual placement as a design contract and the association as a
runtime invariant.

### Native affordances receive logical spacing

For a custom-styled native select, reserve a comfortable logical-end region for
the caret; approximately 12 CSS pixels provides a useful starting coordinate.
Inspect LTR, RTL, zoom, touch size, forced colors, and the actual browser
rendering before accepting the exact inset.

### Focus and status return to the initiating context

Announce material pending, success, warning, and invalid transitions through a
fitting status region. After a drawer, dialog, or transient flow closes, return
focus to the initiating control or the nearest stable successor. Preserve a
usable route when script or an optional image is unavailable.

### Collection work follows identity

Prefer indexed lookup for reconciliation and immutable item replacement for
collection updates. An `N`-item display can traverse in `O(N)`; reconciliation
by stable ID targets `O(1)` lookup after one `O(N)` index pass. Record bundle,
runtime, collection, transition, time, and memory measurements at the tested
coordinate.

### Observations protect decisions

Exercise names, descriptions, order, keyboard, focus, pointer, touch, reflow,
RTL, forced colors, reduced motion, print, script-independent reading, pending
cleanup, stale settlement, and accepted-state recovery in proportion to the
receiver's claims.

## Operating sequence

1. Name domain authority, semantic states, token coordinate, and receivers.
2. Separate accepted domain state, local intent, request state, and visual
   presentation.
3. Establish stable IDs, request generations, cancellation, and idempotent
   promotion.
4. Build the native reading route first or alongside the component route.
5. Bind visible and programmatic labels, descriptions, status, and focus.
6. Apply semantic tokens through the receiver's supported styling inlet.
7. Exercise equivalent states and recovery across each declared receiver.
8. Record exact dependencies, runtime, state inventory, measurements, accepted
   coordinate, and restart point.

## Conditional context

Read [framework and receiving boundaries](references/framework-and-receiving-boundaries.md)
when React Aria, React Stately, Spectrum, collection scale, or browser media
states affect the implementation. Run the [stale-settlement exercise](exercises/README.md)
for one compact native/React contract.

## Completion

The receiver is ready when a reader can identify its current accepted state,
operate it with the declared input routes, recover status and focus, and obtain
the same practical meaning through native, framework, and script-independent
paths. A changed domain invariant, library generation, state name, token
coordinate, or observed browser behavior reopens the matching boundary.
