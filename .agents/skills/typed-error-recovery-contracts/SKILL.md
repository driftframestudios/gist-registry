---
name: typed-error-recovery-contracts
description: Designs stable error types, bounded diagnostics, and explicit recovery at an owned operation boundary. Applies when generic exceptions obscure admission, stale state, execution failure, interruption, or the disposition of previously accepted work.
---

# Typed error and recovery contracts

## Contract

- **What:** A source-grounded failure contract connecting a specific error to its owning operation, observable state, safe diagnostic, and next permitted move.
- **When:** Callers parse message strings, several failure families share an incidental exception, validation details cross a trust boundary, or retries depend on whether an effect became accepted.
- **Boundaries:** The runtime and existing caller contract own exception behavior. A type or factory earns its place through a distinct handling decision. Current task authority governs edits, tests, external execution, and publication.
- **Result:** The smallest compatible error taxonomy, narrow translation points, retained-state behavior, and focused evidence distinguishing promised recovery from a plausible fault.

## Fit and attention

- **Useful when:** Admission, an interpreter, an adapter, or a multi-step operation exposes ambiguous failure or recovery semantics.
- **Direct route when:** One existing exception and a short message supply the caller's complete decision.
- **Smallest useful dose:** Trace one operation from admission to its first effect, name materially distinct outcomes, and repair the owning source-and-test pair.
- **Foregrounds:** Error origin, catch scope, compatibility, privacy, accepted-state preservation, and interruption.
- **May under-attend:** Domain policy, distributed guarantees, authorization, and measured performance; those retain their named owners.
- **Rest or release when:** Another error class or catalog entry would produce the same handling, state, and recovery decision.

## Rules

### Rule: Meaning selects the failure shape

Admission guards reject invalid entry. Independent findings accumulate in an
ordered rule set. Exclusive outcomes retain an exhaustive branch. Legal state
changes receive an explicit transition boundary. A closed error vocabulary
usually needs direct types or a small lookup; an extensible registry requires
an actual registration and replacement contract.

### Rule: Admission precedes derived work

Validate shape, collection budgets, and variable-size members before hashing,
sorting, copying, allocating output, or entering an effectful owner. A count
limit and a member-length limit protect different costs. Annotations describe
the intended API; the named admission boundary establishes runtime constraints.
Admitted internal values retain their trusted role rather than acquiring
repeated whole-object validation at every helper.

### Rule: Types describe caller decisions

Separate stale acceptance, invalid selection, unavailable dependency, execution
failure, and unsettled publication where those distinctions change handling.
A stable code carries machine identity; a bounded message explains the
condition; recovery guidance names the action and its owner. Existing catch
bases and machine-code compatibility remain explicit.

### Rule: A factory centralizes a real contract

A factory is useful when a finite catalog binds known codes to types, fixed
messages, stages, and recovery directions. Prefer immutable descriptors and
direct lookup to a branching constructor tree. Caller-controlled strings stay
outside the catalog and its formatting arguments. Unknown internal codes
surface as programming defects with fixed diagnostics. One error with one
consumer generally needs a direct constructor instead.

### Rule: Translation stays beside the owned operation

Catch failures whose meaning the current boundary can translate. Keep parsing,
resource access, validation, calculation, and publication outside each other's
catch scopes. An adapter may intentionally translate ordinary exceptions into
failed-attempt records; that policy belongs to the adapter invocation itself.
Unexpected internal defects retain their diagnostic route rather than becoming
successful results or invalid-input responses.

### Rule: Diagnostics have a receiving audience

Public recovery receives allowlisted codes, fixed messages, and bounded safe
metadata. Raw input, exception text, file paths, validator input/context, and
tracebacks remain with an authorized diagnostic owner. Suppressing displayed
exception chaining changes presentation, not the underlying object's access
boundary. Framework errors receive an explicit safe projection before entering
a report or remote response.

### Rule: Recovery describes accepted state

Name the last accepted state and publication event. Pre-publication failure
preserves that state. Response loss after publication routes through its
accepted receipt or replay owner. An uncertain attempt remains explicitly
unsettled until reconciliation supplies the missing evidence. A retryable
classification earns an idempotency or reconciliation contract and a bounded
budget; it supplies a recovery option rather than automatic retry authority.

### Rule: Interruption keeps its control meaning

Cancellation, termination, and caller interruption retain the runtime's
declared propagation behavior. Cleanup preserves the original interruption
and accepted state. A secondary check in `finally` can replace the original
failure; make precedence explicit and test it when consequential.

### Rule: Evidence distinguishes neighboring failures

Assert the public type or structured code, safe diagnostic, preserved state,
and next action. Inject a known dependency failure and an unrelated internal
defect separately. Seed prior accepted work before rejection or interruption.
Keep literal expectations independent of the production error catalog or
selector being assessed. Counts establish cardinality; relationship checks
establish that the declared evidence can support its claimed standing.

## Operating sequence

1. Map the caller, input contract, preparation, external call, publication event, and recovery owner.
2. Name the smallest outcome families whose handling differs; separate source inference from observation.
3. Choose direct types, a finite factory, framework-native errors, or the existing result envelope according to the caller contract.
4. Place admission before derived work and translation around the responsible operation.
5. Preserve compatibility, accepted state, diagnostic audience, and interruption precedence.
6. Select counterexamples for a known failure, a neighboring programming defect, and the material recovery boundary.
7. Run authorized focused checks and return one bounded result through the owning PR or Issue.

## Representative scenarios

### Scenario: A changed review selection

- Given a caller retains an accepted snapshot and submits a changed label with an earlier review digest
- When acceptance compares source identity
- Then a typed stale-source error identifies the need for fresh review
- And the earlier snapshot remains byte-identifiable
- And recovery prose contains fixed guidance rather than the submitted label

### Scenario: An adapter fails after earlier work was accepted

- Given an earlier case has a retained result and the next invocation has a reserved attempt
- When the adapter raises an ordinary execution failure or an interruption
- Then the declared failure path records its bounded outcome, while interruption follows its distinct control path
- And earlier accepted work remains available
- And an unsettled attempt receives reconciliation rather than inferred success

## Conditional context and composition

Load [Python exception boundaries](references/python-exception-boundaries.md)
for Python, Pydantic, cancellation, or validation-diagnostic projection.
[Architecture convergence](../architecture-convergence-vantages/SKILL.md)
compares competing mechanisms; [transaction boundary evidence
mapping](../transaction-boundary-evidence-mapping/SKILL.md) owns multi-effect
publication and replay. This skill owns failure classification and the
caller's recovery contract, rather than those peers' complete jobs.

The [initial review exercise](exercises/offline-review-boundary.md) records
the first application and open observations. Source and focused tests retain
technical authority; authored scenarios establish intended behavior.

## Completion

The skill releases when a caller can identify the failure, determine the
standing of accepted work, and take one bounded recovery action using the
exercised contract. A changed caller, runtime, admission scope, effect boundary,
or real incident can reopen a rule. If an existing framework or peer skill
wholly owns these decisions, fold the useful guidance into that owner and
retire this redundant route.
