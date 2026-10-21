# Exercise: map decisions to direct evidence

Run:

```sh
node .agents/skills/visual-contract-receipt-design/exercises/exercise.mjs
```

The fixture maps five decisions to five evidence classes, gives each a
controlled fault and consequence, selects the changed-boundary tier, and
verifies a compact receipt.

Recovery example: remove a fault ID. The exercise returns the affected decision
before receipt promotion because the oracle still lacks a proven counterexample.
