# Typed absence and wire shape

This family makes one JSON update contract inspectable. Its wire shape—the
JSON-ready output object—keeps an omitted property, explicit `null`, a present
empty object, `0`, `false`, and an empty string available as distinct
instructions.

The first version is a dependency-free runtime adapter with a strict
TypeScript development contract. It demonstrates own-property inspection,
plain-record admission, field-specific parsing, detached output, and exact
round-trip evidence.

## Current state

| Axis | Standing | Meaning |
| --- | --- | --- |
| Registry acceptance | `0.1.0` accepted | The exact version is registered and its immutable tag preserves the reviewed coordinate |
| Manifest maturity | `candidate` | The exact `snippet.json` records the source-supported evidence maturity |
| Continuation | `seeded` | The first runnable form supports use and leaves receiving API decisions open |
| Publication | Pages projected | The accepted package is publicly retrievable; optional Gist creation remains a separate human-held action |

**Current coordinate:**
[`typed-absence-and-wire-shape@0.1.0`](0.1.0/README.md).

## Next evidence-bearing route

The current version is a runnable code sample and proposed compact Gist source
set. A receiving API can bind its schema, generated client, transport,
persistence, authorization, and business acceptance while preserving the
demonstrated wire distinctions.
