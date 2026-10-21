# Bounded representation admission

Use this skill to admit caller-owned names, keys, selectors, and other bounded
representations before expensive work begins, while preserving caller control
and a clear ownership boundary.

## Fastest start

1. Read the [skill contract](SKILL.md).
2. Declare the accepted type, normalization rule, unit, limit, and output shape.
3. Run the [synthetic exercise](exercises/README.md).
4. Add exact-limit, one-over-limit, Unicode, and caller-mutation checks for the
   receiving boundary.
5. Read [admission design and evidence](references/admission-design-and-evidence.md)
   when normalization, allocation, or transfer semantics affect the result.

## Success example

A receiver accepts at most four names and eight UTF-8 bytes per name. It copies
the admitted values into an immutable tuple, reports the measured byte length
for an oversized multibyte name, and starts downstream work only after the full
batch passes. A later caller mutation leaves the admitted snapshot unchanged.

## Recovery example

One member exceeds the byte envelope. Admission returns the member index,
observed size, accepted limit, and unit before resource acquisition. The caller
can shorten that value or choose a receiver with a different declared capacity,
then resubmit the same bounded request.

## Package map

- [Skill contract](SKILL.md): admission order, unit selection, ownership, and
  recovery rules.
- [Exercise guide](exercises/README.md): the quickest local check.
- [Synthetic exercise](exercises/exercise.py): exact and one-over boundaries,
  Unicode bytes, full-batch admission, and copied ownership.
- [Admission design and evidence](references/admission-design-and-evidence.md):
  source lineage, allocation reasoning, and transfer considerations.

## Evidence maturity and transfer boundary

`exercised`: the standard-library exercise establishes its authored limits,
errors, and snapshot semantics. A receiving API selects capacities, Unicode
policy, normalization, resource budgets, and public error vocabulary from its
own protocol and workload evidence.
