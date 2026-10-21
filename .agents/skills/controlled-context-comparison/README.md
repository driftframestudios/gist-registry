# Controlled context comparison

Use this skill to learn what one deliberate context change causes while source
identity, decision criteria, execution conditions, and retained observations
stay comparable.

## Fastest start

1. Read the [skill contract](SKILL.md).
2. Name the decision, shared source digest, single changed condition, expected
   distinction, and stop rule.
3. Run the [synthetic paired-arm exercise](exercises/README.md).
4. Inspect [design and evidence](references/design-and-evidence.md) when order,
   contamination, masking, or transfer can change the interpretation.

## Success example

Two runs use the same source digest and differ only in administrative review
status. The result records both arm identities, shows the expected disposition
change, and preserves the source coordinate and comparison contract in the
receipt. The team can attribute the observed difference to the admitted change
within that exercise.

## Recovery example

The source digest changes between arms. The comparison stops before drawing a
paired conclusion, preserves both attempted coordinates, and returns a fresh
shared-source requirement. A failed arm also remains in the receipt with its
observed error and rerun owner.

## Package map

- [Skill contract](SKILL.md): comparison topology, authority, ordering, and
  completion rules.
- [Exercise guide](exercises/README.md): setup and expected observations.
- [Paired-arm exercise](exercises/exercise.py): shared-source enforcement,
  deliberate condition change, and retained failure state.
- [Design and evidence](references/design-and-evidence.md): comparison methods,
  validity threats, and bounded inference.

## Evidence maturity and transfer boundary

`exercised`: the local fixture establishes its exact paired-arm mechanics and
rejection paths. A receiving study owns source selection, randomization or
ordering, sample size, statistical inference, environment control, and the
decision authority that consumes the comparison.
