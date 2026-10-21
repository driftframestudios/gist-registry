# Exercise: carry one token contract into two receivers

Run from the repository root:

```sh
node .agents/skills/design-token-pipeline-stewardship/exercises/exercise.mjs
```

The exercise admits a synthetic primitive → semantic → component chain,
validates aliases and the finite brand/mode matrix, checks two target
inventories, and compares the resulting receipt with an independent expected
result.

Success establishes the mechanics encoded in this fixture. A production token
set supplies its own semantic owner, dependency graph, compiler coordinate,
receiver behavior, and release observation.

Recovery example: change `action.focus-ring.$value` to a missing path. The
exercise returns `UNRESOLVED_REFERENCE` and identifies the semantic token while
the accepted coordinate in the expected receipt remains available.
