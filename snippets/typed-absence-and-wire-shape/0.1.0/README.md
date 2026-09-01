# Typed absence and wire shape 0.1.0

## Practical question

How can a JSON update boundary preserve the difference among an omitted field,
an explicit clear, an intentionally empty collection, and meaningful falsy
values?

This version answers with one route-configuration patch. Each field has a
named presence meaning, and the projector copies only admitted own data
properties into a frozen wire shape: the JSON-ready output object.

## Six states with six meanings

| Field | Accepted state | Instruction |
| --- | --- | --- |
| `summary` | omitted | Retain the current summary. |
| `fallbackRoute` | `null` | Clear the existing fallback route. |
| `headers` | `{}` | Replace the header set with an explicitly empty set. |
| `retryLimit` | `0` | Disable automatic retries. |
| `enabled` | `false` | Disable the route. |
| `displayLabel` | `""` | Keep an intentionally blank label. |

The named presence case supplies meaning. JavaScript truthiness does not decide
whether a value is present, and a display fallback stays outside this domain
adapter.

## Run the realistic synthetic example

From the repository root:

```sh
npm --prefix snippets/typed-absence-and-wire-shape/0.1.0 ci --ignore-scripts
npm --prefix snippets/typed-absence-and-wire-shape/0.1.0 run typecheck
npm --prefix snippets/typed-absence-and-wire-shape/0.1.0 test
npm --prefix snippets/typed-absence-and-wire-shape/0.1.0 run example
```

The final command prints the same bytes as
[`expected/wire-shape.json`](expected/wire-shape.json). The output contains
five explicit own properties while `summary` remains absent.

## Projection route

[`projectRoutePatch`](src/typed-absence.ts) performs a small explicit sequence:

1. admit a passive same-realm plain record;
2. snapshot enumerable own data properties once and reject unknown keys;
3. distinguish omission through membership in that snapshot;
4. apply the field-specific parser and normalize negative zero;
5. detach nested headers into a null-prototype object; and
6. return a frozen null-prototype wire shape.

Present `undefined` receives an explicit error because JSON cannot carry it.
`exactOptionalPropertyTypes` supplies the matching compile-time distinction.
An empty object, `0`, `false`, and `""` remain valid because their field
policies assign material meaning.

## Focused evidence

The runtime suite establishes:

- exact fixture and expected-result agreement;
- own-property presence for each explicit field and absence for `summary`;
- JSON round-trip preservation of the six intended states;
- detached, frozen header and result objects;
- explicit rejection of present `undefined`, misplaced `null`, accessors,
  unknown keys, symbol keys, arrays, invalid retry counts, and field type
  mismatches; and
- structured error paths that name the responsible field for recovery and
  review.

The type contract accepts omission, explicit clear, present empty structures,
and meaningful falsy values. Compile-time negative examples establish that an
optional property cannot be supplied as `undefined` and that `null` belongs
only to the field whose policy admits it.

## Technical judgment

**TARGET:** one presence-meaning map and one explicit projector preserve every
meaning-bearing presence state through the object-to-JSON boundary.

**CONTRAST:** truthiness checks and broad defaulting collapse `0`, `false`,
`""`, omission, and explicit clear into fewer states than the receiving
contract provides.

**GUARD:** one descriptor snapshot, enumerable data-property reads,
field-level parsers, strict optional-property types, detached null-prototype
objects, and focused round-trip tests keep each instruction legible.

## Source, evidence, and transfer boundary

Recurring human practice with JSON integrations informs the question. The
code, names, and fixtures are independently authored, domain-neutral,
realistic synthetic material; operational schemas, endpoints, credentials,
production records, and employer code remain with their authorized owners.

The focused checks establish one in-memory object-to-JSON adapter for passive
same-realm records under Node.js 22 and TypeScript 5.9.3. The included compiler
configuration supplies the optional-property distinction; the runtime adapter
rejects present `undefined` under every caller configuration. `RoutePatch`
names admitted input and `RoutePatchWire` names projected output, while
`projectRoutePatch()` supplies runtime validation, detachment, and freezing.

Header entries are opaque string pairs here. An API, generated client,
database, or event transport separately preserves the same field meanings and
selects its validation messages, header grammar, authorization, schema
evolution, concurrency, and persistence behavior. Executable proxies,
cross-realm objects, duplicate JSON keys, and resource bounds remain receiving
boundary questions.

The manifest records the README, TypeScript source, runtime and type tests,
fixture, and expected result as a proposed Gist source order. A public Gist
remains a separate human-held exact-version publication action.
