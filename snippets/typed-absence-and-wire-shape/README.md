# Typed absence and wire shape

Current form:
[`typed-absence-and-wire-shape@0.1.0`](0.1.0/README.md).

This family makes one JSON update contract inspectable. Its wire shape—the
JSON-ready output object—keeps an omitted property, explicit `null`, a present
empty object, `0`, `false`, and an empty string available as distinct
instructions.

The first version is a dependency-free runtime adapter with a strict
TypeScript development contract. It demonstrates own-property inspection,
plain-record admission, field-specific parsing, detached output, and exact
round-trip evidence.

## Continuation

- **Standing:** `seeded`
- **Current form:** [`typed-absence-and-wire-shape@0.1.0`](0.1.0/)
- **Present use:** A runnable code sample and proposed source set for a
  separately reviewed public Gist projection and a Context Canvas companion
  passage that explains the same implementation behavior.
