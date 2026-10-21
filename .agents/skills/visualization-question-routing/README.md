# Visualization question routing

Use this skill to turn a reader question and data structure into one defensible
visual comparison. It makes observation unit, variable roles, transformations,
visual channels, meaningful absence, and exact-value recovery explicit before
production polish begins.

## Fastest start

1. Read the [skill contract](SKILL.md).
2. Supply the reader, decision, observation unit, population, field meanings,
   meaningful absence, and destination.
3. Assign each field a data, statistical, visual, and reading role.
4. Compare a primary form with one alternative and state the fact that changes
   the choice.
5. From this skill directory, run `python3 exercises/exercise.py --check`; read
   the [exercise guide](exercises/README.md) for the view contracts.

Example request:

> Use `$visualization-question-routing` to decide whether these annual records
> support individual change, group comparison, seasonal overlay, or a table.
> Preserve exact values and identify the missing fact that would change the
> selected form.

## Success example

Annual samples contain different people, so the selected view compares group
distributions and keeps year as a condition rather than connecting individuals.
A compact exact-value table shares the same population and definitions. The
alternative individual-history view stays attached to the specific identity
evidence that would make it valid.

## Recovery example

A source field named `year` was treated as elapsed time even though it labels
independent survey rounds. The team retains the records and exact-value table,
returns the time-basis question to the source owner, and uses the supported
group comparison. Rendering resumes after the field role is admitted.

## Package map

- [Skill contract](SKILL.md): question framing, role assignment, alternatives,
  transfer, and completion.
- [Roles and evidence](references/roles-and-evidence.md): time, identity,
  conditional panels, source support, and transfer limits.
- [Exercise guide](exercises/README.md): dataset, questions, commands, and
  assertions.
- [`exercise.py`](exercises/exercise.py): runnable semantic checks.
- [`records.csv`](exercises/records.csv) and
  [`view-contracts.json`](exercises/view-contracts.json): exercise data and
  admitted view contracts.

## Maturity and transfer boundary

This package is a decision contract with authored synthetic examples. The
exercise establishes its named semantic choices and carrier agreement. Domain
validity, statistical warrant, reader comprehension, final accessibility, and
publication remain with their fitting evidence and destination owners.
