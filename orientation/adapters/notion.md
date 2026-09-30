# Notion connector adapter

This adapter resolves one Gist Registry orientation record through an
authorized Notion connector while the catalog remains independent of provider
coordinates.

## Input

Read one record from [`../selection.json`](../selection.json). Use its title,
semantic key, expected parent title, source family, role, observation date, and
local fallback. The connector session supplies access; the current task grant
continues to govern how the resulting context may be used.

## Resolution order

1. Search the exact semantic key when the record carries one.
2. Search the exact title.
3. Constrain a title result by the expected parent and source family.
4. Fetch the candidate and verify its title, parent, semantic key when present,
   last edit or observation date, verification standing, and truncation state.
5. Prefer the canonical page over a navigation card, selection-deck row, or
   database projection with the same title.
6. Return one normalized observation and keep the exact coordinate inside the
   connector or authorized resolver.

The resolver returns one of four states:

- `resolved` — one candidate matches the semantic identity and expected role;
- `ambiguous` — several candidates remain plausible after parent
  qualification;
- `unavailable` — the connector or page cannot be reached in the current
  environment; or
- `unauthorized` — the current connector identity lacks access.

Each non-resolved state names the local fallback from the catalog. The
repository-local route can continue while external context remains
unobserved.

## Normalized return

Return only:

- catalog pointer ID;
- provider name;
- resolution status;
- resolved title and semantic key when established;
- observed source role, catalog access standing, catalog publication standing,
  and the catalog observation date;
- the decision-changing contribution; and
- `exactLocatorRetainedByResolver: true`.

Repository Issues, pull requests, commits, and documentation carry this
semantic result rather than a provider URL, page ID, private ancestry, signed
asset route, or connector diagnostic.

## Evidence boundary

A successful connector fetch establishes the observed page identity and
content available to that authorized session at one time. Gist Registry source
and executable checks continue to own repository behavior. Registry ancestry,
public-possible content standing, publication approval, and signed-out
availability remain separate observations.

When the connector response is truncated, return that state and retrieve the
needed section before relying on it. When external content and current source
differ, name the difference and continue from the repository owner.
