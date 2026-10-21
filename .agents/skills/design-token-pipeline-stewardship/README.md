# Design-token pipeline stewardship

This skill helps a team carry visual meaning across design tools, token data,
build tooling, generated code, and live components while every owner and
recovery route stays clear.

## Start here

1. Read the [skill contract](SKILL.md).
2. Trace one primitive → semantic → component/state chain.
3. Run the [synthetic exercise](exercises/README.md).
4. Open [tool and runtime boundaries](references/tool-and-runtime-boundaries.md)
   when a vendor or framework mechanism affects the implementation.

## Why it matters

A cobalt value can match in design and code while its purpose, state, or source
authority drifts. This contract lets reviewers inspect meaning before generated
volume and lets release owners keep the accepted carrier available throughout
candidate work.

## Success example

A focus-ring alias changes for one mode. The pipeline identifies the semantic
owner, validates type and reference integrity, compiles CSS and typed
JavaScript with one exact Style Dictionary coordinate, and runs keyboard plus
forced-color observations in the receiver. The receipt names the changed alias,
affected components, artifact digests, and accepted recovery pointer.

## Recovery example

Two aliases form a cycle. Graph admission returns the complete bounded path
before compilation, the candidate directory remains isolated, and the previous
artifact pointer continues to serve receivers. Repair begins at the authored
alias source.

## Maturity

`exercised`: a deterministic compiler and an accessible native/React receiver
have used the contract with synthetic fixtures, exact dependencies, semantic
diffs, target checks, and accepted-pointer recovery. A production design file
or component library supplies its own authority and runtime observations.
