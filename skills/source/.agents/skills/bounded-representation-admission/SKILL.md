---
name: bounded-representation-admission
description: Places representation budgets and owned-value admission before costly parsing, copying, traversal, and output expansion. Applies when external files or caller-owned values can exceed the receiving computation or produce a report its own receiver rejects.
---

# Bounded representation admission

## Contract

- **What:** A source-owned admission boundary connecting accepted representation shape, computational cost, ownership, and producer–receiver agreement.
- **When:** JSON, structured records, mutable caller values, recursive consumers, or rendered reports cross a bounded computational interface.
- **Boundaries:** Representation admission establishes an affordable supported shape. Domain validity, authorization, scientific meaning, transport deadlines, and operational capacity retain their own owners. A budget is a declared receiving policy with an evidence basis, rather than a universal safe size.
- **Result:** One explicit input envelope, one owned admitted value, separate output capacity, early rejection with preserved state, and tests that distinguish the protected work from a late check.

## Fit and attention

Use this skill when a byte cap leaves nesting or expanded references open,
shape validation sorts before bounding input, mutable aliases split identity
from execution, or a valid producer output fails its consumer. A fixed scalar
API with an existing complete admission contract usually needs direct reading.
The smallest useful dose is one exposed consumer, its expensive first action,
one exact/one-over case, and one timing-of-rejection oracle.

[Typed error contracts](https://kindlight.io/skills/typed-error-recovery-contracts/)
own rejection feedback. [Parity-bound measurement](https://kindlight.io/skills/parity-bound-workload-measurement/)
owns measured alternatives after meaning is preserved. The representation
owner chooses capacities and captures a stable value for the admitted call.

## Inputs, defaults, and output

Bring one exposed consumer, its supported input forms and native types, the
first costly operation, existing capacities, ownership lifetime, and required
producer or saved-output receiver. Read the serializer and numeric runtime
policy when emitted bytes are part of the contract. Each proposed capacity
names units, inclusive edge, evidence basis, and the owner who can revise it.

An unspecified limit stays an open receiving policy. Inspect source and
bounded fixtures first; choose the supported envelope before a costly trial.
Existing admitted internal values retain their trust and avoid repeated full
validation. The result is one admission/ownership design, its distinct input
and output capacities, a typed rejection route, and independent edge evidence.

## Rules

### Rule: Name every dimension that changes the cost

Consider encoded bytes, structural depth, expanded values and member names,
individual and aggregate text bytes, key length, numeric magnitude, graph
cycles, and shared-reference expansion. Select dimensions for actual
consumers. Record units, inclusive limits, normalization, default policy,
evidence, and the receiver that can revise a capacity. Python booleans and
integers, missing values and explicit nulls, and text characters and UTF-8
bytes retain their distinct meanings where consequential.

### Rule: Admission precedes the work it protects

A file reader can use a maximum-plus-one read before decoding. A bounded
structural scan can reject excessive depth before a recursive decoder. Decoded
callers need their own budget before field sorting, hashing, copying, or
rendering. Preserve duplicate-key, Unicode, and nonfinite-number semantics at
the parser that observes them. Post-decoding validation establishes the
decoded shape; it cannot retroactively bound parser allocation.

### Rule: Charge the representation that consumers traverse

An iterative visitor can keep O(depth) traversal state and an ancestor set for
cycles. A shared child contributes once per serialized occurrence when a later
encoder expands it; a global visited set would count a different quantity.
Avoid copying all child references into a temporary stack when bounded live
state is the desired guarantee. Encoded cost includes punctuation, escaped
text, member names, and numeric spelling under the declared serializer.

### Rule: One admitted snapshot carries one invocation

After budget and shape admission, capture the owned value needed by identity,
approval, comparison, and execution. Cached byte counts and digests describe
that snapshot. A shallow immutable wrapper can still contain mutable
children. Choose a detached copy, a deep immutable representation, or an
explicit borrowed-value lifetime; account for its preparation and allocation.

### Rule: Numeric support reaches serialization

Finite input can overflow during subtraction or division. Arbitrary-precision
integers can exceed an interpreter's conversion budget. Bind input magnitude,
arithmetic result support, emitted numeric type, and configured interpreter
limits. Exact ratio arithmetic can preserve a comparison predicate while a
finite report still needs a typed capacity outcome. Each is a separate
contract decision and regression.

### Rule: Input and expanded output have distinct budgets

Report rows, labels, comparisons, HTML escaping, and repeated summaries can
expand a compact input. Derive an output envelope from the producer's actual
shape and check it before materializing an oversized result where practical.
The saved-report receiver admits that envelope. Prepared artifact verification
can retain exact expected member sizes; a standalone receiver needs its own
general bound and exact permitted membership. Rejection preserves previously
accepted output and names the bounded recovery route.

### Rule: Tests observe the expensive boundary

Cover exact/one-over values, multibyte and escaped text, many keys, extreme
numbers, deep nesting, cycles, shared aliases, and producer→receiver roundtrip
where they enter the contract. A spy or material allocation observation shows
that admission precedes the expensive consumer. Mutating the caller afterward
tests ownership. Independent encoded-byte and output oracles keep a shared
mistake from passing both producer and consumer checks.

## Operating sequence

1. Map raw, decoded, admitted, transformed, serialized, and published forms.
2. Name the first expensive action and its cost variables at each boundary.
3. Compare byte-only, representation-wide, reusable domain-model, and streaming routes.
4. Select capacities, ownership, early checks, and independent semantic validation.
5. Account for traversal state, copy count, sorting, numeric work, and output expansion.
6. Exercise rejection timing, exact boundaries, alias mutation, and full roundtrip.
7. Return the supported envelope, evidence boundary, and capacity-change receiver.

## Conditional context

Read [admission design and evidence](references/admission-design-and-evidence.md)
for the cost map, alternatives, language mechanisms, and receiving examples.
The [small exercise](exercises/exercise.py) and [guide](exercises/README.md)
demonstrate early budget admission and snapshot ownership.

## Scenario: A supported producer exceeds its receiver

- Given a compact supported input expands into repeated report rows and escaped text
- When the producer emits a valid report that its saved-report receiver rejects
- Then the owner derives the output envelope from the actual produced shape and selects a supported output policy
- And a near-capacity producer-to-receiver test checks the same artifact independently
- And rejected output preserves the prior accepted artifact while a capacity change receives its own evidence

## Recovery and re-entry

An over-capacity input returns the native typed rejection and a bounded next
move such as reducing the request or selecting an explicitly larger supported
profile. Preserve accepted state and the input's ownership boundary. If a
legitimate output fails its receiver, return the mismatch to the shared shape
owner before raising unrelated input limits. Parser, serializer, runtime,
profile, or workload changes reopen only the affected budget and roundtrip
observations.

## Completion

The boundary is ready when supported input and output shapes are explicit,
rejection arrives before the protected work, one owned value governs the call,
and producer/receiver agreement survives the material edge cases. A changed
serializer, runtime, shape, consumer, or workload reopens the affected budget.
