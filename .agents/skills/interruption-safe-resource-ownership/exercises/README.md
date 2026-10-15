# Exercise: transfer and failure precedence

Run with Python 3.12 or newer:

```sh
python3 exercise.py
```

The synthetic state model observes a failed stream release followed by a
descriptor release, exact primary/control identities, and the transfer from
pending ownership to a visible target. Two deliberately altered decisions
produce distinguishable incorrect states. The exercise writes no files and
opens no resources; its explicit output establishes model behavior. The
reference's exact receiving PRs carry actual resource and publication evidence.

For a real caller, replace the synthetic observations with its public outcome,
accepted bytes, and actual resource state. Preserve the two independent
oracles: visibility alone leaves ownership open, and observing an exception
alone leaves its selected identity and recovery meaning open.

Return to the [skill](../SKILL.md) or
[mechanism evidence](../references/mechanisms-and-evidence.md).
