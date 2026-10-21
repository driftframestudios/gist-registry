---
name: design-token-pipeline-stewardship
description: Carries design-token meaning from named authority through a bounded DTCG subset, validated aliases, pinned compilation, generated artifacts, and receiving adapters. Use for Figma variables, Style Dictionary, theme packages, or component bindings that need reproducibility, semantic review, or recovery.
---

# Design-token pipeline stewardship

## Contract

- **What:** A portable method for carrying visual meaning through authoring,
  exchange, validation, compilation, generated artifacts, and live receivers.
- **When:** Work crosses design variables, DTCG-shaped data, compiler hooks,
  platform artifacts, brand or mode matrices, or component-library adapters.
- **Boundaries:** Design, engineering, accessibility, security, and release
  owners retain their assigned authority. Vendor behavior receives a current
  official-source and installed-version check.
- **Result:** An explicit canonical subset, reproducible artifacts, semantic
  change summary, receiving observations, and recoverable accepted state.

## Fit and smallest useful dose

Use this skill when two or more tools represent the same visual meaning and a
team needs one inspectable source-to-receiver route. An isolated value update
inside an established pipeline can follow that pipeline's focused edit and
check.

Start with one token chain:

```text
meaning owner → primitive → semantic alias → component/state binding
  → generated target → supported receiver → observation
```

Name the accepted source, canonical format subset, exact compiler coordinate,
one receiver, one decisive check, and one recovery coordinate.

## Rules

### Meaning authority precedes tooling

Name who defines each concept, who can revise it, and which authored source
carries the accepted value. A design file, token repository, compiler config,
generated package, and receiver can each hold distinct roles.

### The canonical subset is explicit

Declare the exact DTCG Format Module or project contract, token types, inherited
types, alias syntax, extensions, naming rules, modes, brands, defaults, and
compatibility direction. Preserve admitted extension data through the declared
round trip. Return a typed result for every value outside the subset.

### Resource limits precede expansion

Set source-byte, depth, token, reference, alias-depth, variant, target, file,
generated-byte, concurrency, elapsed-time, and peak-memory ceilings. Preflight
cheap structural limits, traverse references through indexed identities, and
check output ceilings before publication. Return stage, dimension, observed
value, limit, and restart point.

### Layers keep distinct jobs

- primitives carry material values;
- semantic tokens name purpose; and
- component/state bindings connect purpose with a receiver and interaction
  state.

An override records an owned component or state decision while shared semantic
meaning remains visible.

### The graph passes admission before compilation

Index stable token identities and normalized target names. Check type
compatibility, unresolved references, cycles, alias depth, duplicate identities,
mode completeness, and normalized-name collisions. Keep display labels separate
from canonical consumer addresses.

### Compiler and executable hooks belong to the artifact coordinate

Pin runtime, compiler package, configuration, transforms, formats, filters,
parsers, preprocessors, actions, and dependency lock. Treat token JSON as data
and custom hooks as executable code with named filesystem, network, environment,
and subprocess authority. Use a fresh compiler instance for each finite build
coordinate when that policy improves isolation and reproducibility.

### Every target receives its grammar check

Normalize and escape for the target grammar, detect post-normalization
collisions, and parse, compile, or lint CSS, JavaScript, TypeScript, XML, or
native output before digest and promotion.

### Framework adapters preserve responsibility

Keep domain state, React Stately collection state, React Aria interaction and
accessibility behavior, React Spectrum presentation, and custom visual styling
separately identifiable. Follow the API and provider ordering supported by the
installed framework generation.

### Semantic changes lead review

Classify added and removed identities, type changes, alias-target changes,
primitive values, defaults, modes, component/state bindings, and affected
receivers before generated-file churn. A display-label change can retain
canonical identity; a path change is a consumer compatibility event.

### Candidate work preserves the accepted carrier

Generate and verify inside an isolated candidate boundary. Promote one complete
manifest or pointer after every target and receiver check passes. Keep the last
accepted coordinate serviceable while a candidate receives repair.

### Receipts bind claims to exact coordinates

Record source and configuration digests, canonical subset, compiler/runtime
and lock, resource envelope and maxima, graph counts, generated artifacts,
grammar checks, semantic diff, receiver checks, accepted coordinate, recovery
coordinate, and next owner. The receipt establishes the stages it exercised.

## Operating sequence

1. Frame the concepts, receivers, dimensions, and release decision.
2. Assign semantic, source, compiler, accessibility, integration, and release
   authority.
3. Declare the canonical subset and resource envelope.
4. Admit sources and validate the indexed alias graph.
5. Compile each sorted build coordinate with the pinned toolchain.
6. Check every target grammar, inventory, digest, and budget.
7. Bind generated data through each receiver's supported adapter.
8. Review semantic changes and run focused receiving observations.
9. Promote the complete candidate or retain the accepted coordinate with an
   exact restart point.
10. Write a concise, coordinate-bound receipt.

## Conditional context

Read [tool and runtime boundaries](references/tool-and-runtime-boundaries.md)
when DTCG, Style Dictionary, Figma Variables, React Aria/Stately/Spectrum, or
complexity and receipt details affect the decision. Use the [exercise](exercises/README.md)
to inspect one complete synthetic authority-to-receiver route.

## Recovery and completion

Return a failed stage to its named source owner with the token path, tool
coordinate, accepted pointer, and smallest restart point. The current route is
ready when a cold collaborator can identify authority, admitted meaning, graph
checks, compiler coordinate, artifacts, adapters, receiving evidence, and
recovery in one pass. A changed tool, type, authority, adapter, or material
receiver behavior reopens the matching boundary.
