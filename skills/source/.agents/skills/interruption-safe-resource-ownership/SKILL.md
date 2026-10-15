---
name: interruption-safe-resource-ownership
description: Maps acquisition, transfer, release attempts, and failure precedence across an owned operation. Applies when partial construction, interruption, nested cleanup, or publication can leave a resource or recovery state ambiguous.
---

# Interruption-safe resource ownership

## Contract

- **What:** A bounded lifecycle in which every acquired resource has one current owner, every transfer changes that ownership, and every remaining release receives its declared attempt.
- **When:** A cursor, connection, file descriptor, stream, staging directory, lease, or similar resource survives across several operations or error translations.
- **Boundaries:** The platform owns actual resource semantics. The caller owns transaction, publication, retry, and interruption policy. A cleanup attempt establishes an attempted release; successful release or reconciliation requires its own observation. Current task authority governs execution.
- **Result:** A small ownership map and source-and-test change that preserve the operation's primary outcome, control interruption, secondary diagnostics, and actionable retained state.

## Fit and attention

Useful for partial acquisition, nested context managers, cancellation, failed
commit/rollback/close, or a visible effect followed by failed teardown. A
single framework owner with an already complete tested contract can remain
unchanged. The smallest useful dose is one resource pair, one transfer point,
and one composed failure that changes the caller's recovery decision.

This skill owns release lifecycle. [Transaction boundary evidence mapping](https://kindlight.io/skills/transaction-boundary-evidence-mapping/)
owns accepted effects and replay; [typed error contracts](https://kindlight.io/skills/typed-error-recovery-contracts/)
own catchable feedback and diagnostic audiences. Share a helper when its
acquisition, transfer, and error policy actually agree across callers.

## Rules

### Rule: Acquisition and transfer name the owner

Record ownership only after acquisition succeeds. Use explicit absence rather
than resource truthiness: descriptor zero is acquired state. Distinguish an
acquired raw descriptor from a wrapper whose construction may fail. When a
rename, commit, or handoff transfers a resource, clear the previous owner's
claim at the observed transfer point. A retained path name is a locator, not
proof that the resource still belongs to that owner.

### Rule: Cleanup attempts every remaining owned release

Choose the dependency order deliberately. A failed cursor close can leave a
connection release necessary; a failed stream close can leave raw-descriptor
release necessary. Snapshot and clear an owned release action before invoking
it so a later path follows an explicit retry policy rather than accidentally
repeating it. Platform-specific retry safety remains part of the resource
contract, especially when descriptor reuse can change identity.

### Rule: Failure policy is a caller decision

Map primary operation failure, primary control interruption, cleanup failure,
and cleanup control interruption independently. Name which event propagates,
which cause/context and metadata remain inspectable, and which remaining
releases still run. Python `BaseException` containment can be appropriate
inside the tiny release owner to finish teardown; the outer boundary then
restores the selected control signal. The policy is local, rather than a
universal instruction to catch every exception throughout an application.

### Rule: Public feedback follows completed teardown

Translate after the owner has collected all required cleanup observations.
An early conversion can discard a later interruption or report an obsolete
publication phase. Public messages carry fixed categories and safe state;
raw failures remain available only to the diagnostic audience allowed by the
receiving application. Exception-group selection preserves relevant metadata
and order under the declared runtime contract.

### Rule: Recovery state describes observed effects

Distinguish unpublished, published, reused, and uncertain results when the
protocol needs them. A completed rename followed by failed parent sync has a
different recovery meaning from failed rename. Name whether temporary state
is absent, still owned, or awaiting reconciliation. A durability claim needs
the platform and environment observation that establishes it.

### Rule: Composition earns the regression

Seed earlier accepted state, then inject failures at acquisition, wrapper
construction, write/read, verification, transfer, and teardown. Include a
primary ordinary error plus secondary control signal, successful transfer
plus failed cleanup, descriptor zero, and an interrupted earlier release that
still permits a later one. Assert exact public exception identity, visible
accepted bytes, remaining resource state, and release-attempt order. Deliberate
mutations of ownership transfer and error precedence must fail distinct
oracles when both guarantees are claimed.

### Rule: Complexity follows owned resources and observations

State is O(R + F) for R acquired release actions and F retained failures in a
bounded operation. File traversal and database work retain their separate
costs. A general lifecycle framework earns its complexity through several
compatible protocols; a small explicit owner often gives clearer authority.

## Operating sequence

1. Name the operation, resource identities, original accepted state, and effect boundary.
2. Draw acquisition, partial construction, transfer, release, and reconciliation states.
3. Assign one owner and release policy to each acquired resource.
4. Specify primary/control/secondary precedence and safe diagnostic projection.
5. Move final error translation after required teardown.
6. Exercise composed failures and perturb the decisive ownership and precedence rules.
7. Return exact source, normalized observations, remaining state, and recovery owner.

## Conditional context

Read [mechanisms and receiving evidence](references/mechanisms-and-evidence.md)
for Python streams, transaction owners, source lineage, and competing designs.
The [bounded lifecycle exercise](exercises/exercise.py) and its
[guide](exercises/README.md) expose the two independent failure controls.

## Completion and re-entry

The contract is ready when a caller can recover each resource's owner and
observed state after success, failure, and interruption, and the promised
precedence survives a composed fault. Reopen it when acquisition, wrapper,
runtime, publication primitive, or caller policy changes. The accepted source
and evidence retain their own coordinate throughout that revision.
