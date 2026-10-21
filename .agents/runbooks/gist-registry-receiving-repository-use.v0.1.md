---
title: Gist Registry receiving-repository use
version: 0.1.0
status: exercised
audience: ai_collaborators
source_band: public_possible
task_type: cross_repository_receiving
---

# Gist Registry receiving-repository use

## Desired receiving state

A receiving team can select one exact Registry coordinate, establish its fit,
adapt it through a named local boundary, and preserve both the prior accepted
state and a concise handback to the source.

```text
receiving decision
  → exact Registry family and version
  → source, license, runtime, and evidence verification
  → local ownership and adaptation boundary
  → focused receiving observation
  → accepted coordinate or typed gap
  → source handback and successor route
```

The Registry supplies an executable mechanism and bounded evidence. The
receiving repository supplies domain meaning, integration authority, security
policy, release acceptance, and any broader runtime claim.

## Entry condition

Use this runbook when another repository wants to reference, vendor, or depend
on a Registry artifact. Begin with a named decision: the behavior to gain, the
reader or system that receives it, and the observation that would establish
fit.

Read the artifact family README, exact-version README, `snippet.json`, focused
tests, fixtures, expected results, and current registry entry. The current task
grant continues to govern checkout changes, dependency installation, network
access, pull requests, publication, and deployment.

## Four standings that answer different questions

| Standing | Question it answers | Authority |
| --- | --- | --- |
| Registry acceptance | Which source coordinate has received repository review? | Accepted source and review history |
| Manifest maturity | How should a reader interpret the artifact's current evidence? | Exact `snippet.json` |
| Receiver evidence | What happened in this receiving repository and environment? | Local test and receipt |
| Public projection | Which accepted bytes appear in a Pages or Gist carrier? | Projection manifest and hosted observation |

One standing can advance while another waits. Record each explicitly so a
public route, candidate manifest, or successful local exercise carries its own
meaning.

## Phase 1 — Name the receiving decision

Write a compact intake:

| Field | Required value |
| --- | --- |
| Practical result | One changed ability or resolved decision |
| Receiver | Application, library, workflow, reader, or team |
| Material invariant | Behavior or relationship that must hold |
| Consequence | What changes when the invariant fails |
| Fitting observation | Smallest check that answers the decision |
| Local owners | Semantic, integration, security, accessibility, and release roles |

**Checkpoint:** The team can explain why the artifact earns a place before
selecting its delivery mode.

**Recovery:** A missing semantic or release owner returns a typed gap with the
current candidate preserved.

## Phase 2 — Select and verify one exact coordinate

Resolve the family and semantic version through `registry.json`, then verify:

- manifest identity, canonical path, standing, and license;
- source, configuration, fixture, test, and expected-result closure;
- runtime and exact dependency lock;
- provenance, technical-veracity basis, evidence boundary, and transfer
  boundary;
- artifact and lock digests when the transfer mechanism supplies them; and
- the prior accepted coordinate and recovery route.

Run the artifact's declared test before adapting it. A dependency or tool
upgrade creates a new receiving coordinate even when source bytes remain the
same.

In a read-only evaluation, inspect the lock-resolved graph already available
and record that narrower evidence. A writable receiver performs the clean
install before local acceptance.

**Checkpoint:** One immutable source-and-runtime coordinate enters the local
decision record.

**Recovery:** A missing representation, license, lock, or runnable check keeps
the coordinate in evaluation and names the source owner who can complete it.

## Phase 3 — Choose the delivery mode

| Mode | Fitting use | Local responsibility |
| --- | --- | --- |
| Reference | The artifact teaches a mechanism while local code owns implementation | Record the exact source route and the decisions adopted locally |
| Vendored coordinate | Review requires source continuity or repository-contained execution | Preserve license, version, source digest, and update route |
| Dependency | A published package supplies the runtime behavior directly | Pin the coordinate, retain the lock, and observe the installed graph |

Select the smallest mode that preserves the needed behavior and review path.
Keep authored meaning and local configuration with their respective owners.

## Phase 4 — Bind the local adapter

Name the boundary where Registry behavior meets local meaning. Record:

- Registry inputs and outputs;
- local domain types, state, and policy;
- any renamed concepts or changed defaults;
- security and data classes crossing the boundary;
- accessibility and browser responsibilities;
- resource ceilings and failure categories; and
- previous accepted local behavior plus rollback coordinate.

The adapter may be code, configuration, a build step, or a documented decision
pattern. Generated artifacts retain one-way ownership: revise authored inputs
and regenerate through the declared toolchain.

## Phase 5 — Run the smallest decisive observation

Exercise the receiving boundary with the source package's focused results as
an accepted input.
Choose evidence in proportion to the decision:

- semantic or schema assertions for meaning and identity;
- model tests for state transitions and reconciliation;
- integration tests for adapters and generated grammars;
- browser semantics and geometry for interaction and layout;
- bounded bitmap evidence for relationships that semantic and geometric
  assertions only partially express; and
- secret-material and dependency observations for the exact transferred
  scope.

Seed the previous accepted state when failure or interruption can affect it.
Use one counterexample or controlled fault that proves the decisive oracle.

**Checkpoint:** The observation establishes the receiving invariant at the
named coordinate and states its coverage boundary.

**Recovery:** A failed candidate leaves the prior accepted coordinate usable
and returns the earliest durable restart point.

## Phase 6 — Record fit, gap, and changed meaning

Produce a compact receipt:

```text
Receiver: repository, application, or package role
Registry coordinate: semantic ID, version, source digest
Delivery mode: reference | vendored | dependency
Local adapter: owning path or component
Signal: decision and observation used
Result: accepted | candidate | friction
Fit: behavior transferred with meaning preserved exactly
Gap: local work or evidence still owned here
Changed meaning: renamed concept, altered default, or wider/narrower claim
Recovery coordinate: prior accepted local state
Source handback: reusable finding for the Registry owner
Next receiver: review, successor, publication, or local release
```

Record `none observed` only after the receiving comparison establishes that
standing. Prefer specific affirmative state over broad confidence language.

## Phase 7 — Accept locally or form a successor

Accept the coordinate when its declared behavior and the local invariant both
pass at the recorded runtime. Preserve the prior coordinate until the local
release transition completes.

Form a Registry successor proposal when shared meaning, compatibility, failure
recovery, or evidence improves for other receivers. Keep local product policy
inside the receiving repository. Return the finding to the artifact's Issue
with the exact coordinate, reproduction, consequence, and proposed shared
change.

## Phase 8 — Route public projection separately

Source acceptance, immutable tagging, Pages projection, optional Gist
publication, and hosted observation each follow their own authorized route.
The receiving receipt can recommend a projection while the human publication
owner retains the audience decision.

## Exercised examples

The durable [exercise receipt](receipts/gist-registry-receiving-repository-use.v0.1.json)
records the exact package coordinates, commands, fit, gaps, changed meaning,
changed decisions, recovery coordinates, and next receivers summarized here.
Both source coordinates were working-tree candidates during the exercise, so
the receipt establishes runbook use while source review retains Registry
acceptance.

The two exercises used materially different mechanisms:

1. a bounded token graph compiled into deterministic CSS and typed JavaScript,
   with exact toolchain coordinates and accepted-pointer recovery; and
2. a source-owned SVG and semantic contract compiled into responsive WebP,
   HTML, JSON, metadata, and digest receipts.

The comparison clarified three transferable distinctions: semantic authority
precedes generation, receiver evidence remains local, and one accepted pointer
can preserve service while candidate artifacts receive inspection. A native
HTML and React Aria receiver adds an integration use of the token coordinate.

An independent cold receiver used this runbook alone to select the
visual-artifact compiler,
reconstructed its vendored-coordinate route, and returned a `candidate`
receipt. That exercise surfaced two missing transfer coordinates: an aggregate
source digest and the operating-system, architecture, and libc family that
help determine image bytes. The compiler now records both, while the receipt
keeps content approval, browser/assistive-technology observation, and local
release acceptance with the receiving owners.

## Publication handback

Return the receipt fields above plus the exact focused command and normalized
result. Keep credentials, private locators, raw secret-scan findings, signed
routes, and environment-specific private paths with their controlled owners.

## Completion and re-entry

The route completes when one exact coordinate has a verified delivery mode,
named local adapter, focused observation, fit/gap statement, recovery
coordinate, and source handback. A changed Registry version, runtime,
dependency graph, local semantic owner, adapter, or release boundary reopens
the matching phase.
