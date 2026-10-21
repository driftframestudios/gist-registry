# Repository collaboration cycle

Use this skill to carry an authorized repository task from current-state
reconstruction through source-owned work, proportionate verification, and one
reviewable handoff. It is especially useful when a resumed collaborator needs
to recover the real action coordinate before changing code.

## Fastest start

1. Read the [skill contract](SKILL.md).
2. Name the repository, material outcome, work owner, and granted actions.
3. Bind the repository's actual commands and receivers with the
   [repository adapter](references/repository-adapter.md).
4. Follow the [source-work cycle](references/source-work-cycle.md) from
   re-entry through delivery.
5. When another repository receives an exact Registry coordinate, use the
   [receiving-repository runbook](../../runbooks/gist-registry-receiving-repository-use.v0.1.md)
   to bind fit, local adaptation, verification, recovery, and source handback.
6. Use the [receiving task](exercises/receiving-task.md) to assess whether a
   fresh collaborator can continue from the handoff.

Example request:

> Use `$repository-collaboration-cycle` to carry Issue 123 from the current
> source coordinate to a review-ready return. Preserve merge and publication
> for their existing owners.

## Success example

A task names a behavior change while the checkout contains unrelated work. The
collaborator identifies the active source coordinate, finds the module that owns
the behavior, changes that owner, runs focused and repository-native checks,
and returns one reviewable result. The handoff names the inspected tree, the
claim each check supports, retained work, and the next authorized action.

## Recovery example

A cached plan names an older branch and a required integration command is
temporarily unavailable. The collaborator preserves the current worktree,
continues source analysis that remains valid, and holds the integration claim
with its missing observation. Re-entry starts at the affected verification
phase after the command becomes available.

## Package map

- [Skill contract](SKILL.md): fit, authority, rules, sequence, and completion.
- [Repository adapter](references/repository-adapter.md): maps the portable
  cycle to receiving commands, branches, evidence, and recovery owners.
- [Source-work cycle](references/source-work-cycle.md): detailed checkpoints,
  phase transitions, and handback fields.
- [Receiving task](exercises/receiving-task.md): fresh-context transfer
  exercise and assessment prompts.
- [Gist Registry receiving-repository use](../../runbooks/gist-registry-receiving-repository-use.v0.1.md):
  exact-coordinate selection, receiver adaptation, focused observation,
  recovery, and source handback.

## Maturity and transfer boundary

This package is a source-oriented collaboration contract with an authored
receiving exercise. Repository source, focused checks, and native runbooks
establish local behavior. Product priority, branch policy, review, merge,
release, publication, and deployment authority remain with the receiving task
and its named owners.
