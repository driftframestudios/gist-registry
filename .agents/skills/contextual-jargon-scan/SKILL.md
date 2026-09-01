---
name: contextual-jargon-scan
description: Classifies potentially specialist or inside wording within a bounded corpus and revises replaceable shorthand into ordinary language. Applies when Registry orientation, artifact documentation, public projection copy, or cross-team prose may rely on context its reader does not share.
---

# Contextual jargon scan

## Contract

- **What:** A context-aware language review that distinguishes useful precision from shorthand a reader must decode.
- **When:** A bounded public, visitor-facing, cross-team, or durable Registry surface may carry terms whose meaning depends on local practice.
- **Boundaries:** Literal language, exact technical terms, quotations, citations, code, identifiers, governed vocabulary, accessibility meaning, and useful compact metaphors retain their source fidelity. The scan stays within the receiving task and leaves vocabulary governance and publication decisions with their established owners. Search and lint tools identify candidates; contextual reading decides disposition.
- **Result:** A scoped occurrence map with targeted revisions, intentional retentions, deferred receivers, and a verification signal tied to the changed prose.

## Fit and attention

- **Useful when:** A reader may understand the sentence grammatically while missing the intended object, action, relationship, mechanism, or consequence.
- **Poor fit when:** The concern is primarily technical correctness, evidence standing, artifact identity, schema validity, or publication authority rather than contextual shorthand.
- **Smallest useful dose:** Named word families across the files already in scope, plus enough surrounding prose to classify each material occurrence.
- **Interactions:** `probe-bearing-exemplar-formation` owns first-coordinate artifact formation. `versioned-exemplar-successor` owns material behavior strengthening. `architecture-convergence-vantages` owns competing guarantee designs. Source, focused tests, and manifests retain technical authority.
- **Rest or release when:** A term already performs an exact or useful job, or changing it requires a source-owner or artifact decision outside the current task. Record the fitting receiver only when the deferral changes continuation.

## Registry profile

- Primary corpora include family and exact-version READMEs, Gist-oriented Markdown, repository orientation, and human-readable Pages copy.
- Artifact IDs, versions, `artifactKind`, schema keys, media types, `technicalVeracity`, continuation standings, code identifiers, and `TARGET`/`CONTRAST`/`GUARD` markers retain their exact owners.
- Runnable code and machine-readable JSON remain outside the default prose scan. Their human-facing strings enter only when they directly serve a reader.
- Ordinary language hydrates technical specificity. Mechanism, recovery behavior, evidence boundaries, and principal-level implementation detail remain available.
- When projected copy changes, the deterministic Pages check and byte-parity route verify the receiving representation. A skill-only source change uses the ordinary source checks and leaves `docs` unchanged.

## Rules

### Rule: Scope precedes the scan

Name the receiving corpus, intended readers, files already changing, and explicit exclusions. An in-stride scan stays with the active surface rather than becoming an automatic repository-wide rewrite.

### Rule: Word families produce candidates

Search inflections and nearby forms of observed terms. Counts locate repetition and variation; they do not establish a defect or a completion threshold.

### Rule: Each occurrence receives a functional class

Classify a material occurrence as:

1. literal ordinary language;
2. an exact technical or governed term;
3. quoted, cited, or source-owned language;
4. a useful compact metaphor whose relationship is retrievable; or
5. replaceable shorthand that asks the reader to infer local meaning.

The same word family may receive several classes within one artifact family.

### Rule: Replacement follows function

For replaceable shorthand, name the concrete object, action, relationship, boundary, mechanism, or consequence the term was carrying. Prefer the smallest ordinary-language revision that preserves technical depth and the artifact's voice.

### Rule: Useful compact language can stay

Retain a specialist term or metaphor when it improves precision, retrieval, or continuity. Define it near first use when the receiving reader otherwise lacks enough context.

### Rule: Fidelity-bearing text keeps its owner

Preserve source titles, direct quotations, code, schema keys, identifiers, artifact coordinates, established technical terms, and accessibility meaning. Route a disputed source-owned term to its authority rather than normalizing it locally.

### Rule: Reconciliation preserves meaningful variation

Reconcile duplicate definitions and conflicting uses when they describe the same concept. Family voice, representation-specific detail, and technically meaningful distinctions can remain.

### Rule: Tooling remains advisory

`rg`, a word-family inventory, or a future Vale rule may make candidates easier to inspect. A zero-occurrence result is neither required nor sufficient. Deterministic tooling forms only after repeated work demonstrates a stable mechanical check.

### Rule: Verification returns to the reader

Read each changed sentence in its paragraph, heading, table, metadata, or accessibility context. Confirm that the intended object, mechanism, and consequence remain clear, then run the receiving surface's existing checks.

## Operating sequence

1. **Bind the review:** Name corpus, reader, active change, exclusions, and candidate word families.
2. **Gather occurrences:** Search each family with enough context to read its actual role.
3. **Classify:** Mark material occurrences as literal, exact, source-owned, useful compact language, or replaceable shorthand.
4. **Choose the smallest action:** Retain, define, revise, or defer each decision-changing occurrence.
5. **Revise in context:** Replace shorthand with concrete nouns, verbs, relationships, mechanisms, or consequences.
6. **Reconcile locally:** Inspect nearby headings, repeated definitions, links, metadata, and accessibility text for agreement.
7. **Verify:** Re-read the receiving passage, perform a targeted rescan, and run the surface-owned checks.
8. **Return:** Name the scoped corpus, concrete changes, intentional retentions that matter, validation signal, coverage boundary, and any next receiver.

## Output contract

The return contains:

- the corpus and exclusions;
- candidate word families and material occurrence classes;
- the targeted change list or a grounded no-change result;
- intentional retentions only where their rationale changes future work;
- the exact verification command or reading signal and its coverage boundary; and
- a named receiver for any material deferral.

## Representative scenario

### Scenario: One term carries exact and vague meanings

Given `boundary` names a verified serialization contract in one passage<br>
And the same word loosely stands for an unspecified transition elsewhere<br>
When the occurrences are classified<br>
Then the exact contract term remains, with a local definition when useful<br>
And the vague occurrence names the systems, field policy, or responsibility handoff it actually means<br>
And completion depends on reader legibility rather than eliminating the word family

## Completion

The scan completes when a reader can retrieve the material objects, actions, relationships, mechanisms, and consequences without relying on collaboration-local context; retained specialist language has an exact or useful role; revisions preserve source fidelity and technical depth; and verification plus any deferred receiver remain visible.
