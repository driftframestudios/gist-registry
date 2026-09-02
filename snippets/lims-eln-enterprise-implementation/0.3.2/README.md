# Content-bound idempotency from an accepted implementation release

This repository exemplar publishes one complete file from the accepted
LIMS/ELN Enterprise Implementation `v0.3.2` release. The 94-line source is
small enough to read end to end and substantial enough to show the decisions
that give a retry its meaning.

## What the file demonstrates

`IdempotencyLedger` keeps four concerns together:

- a tenant and stable key form the reservation identity;
- a content digest distinguishes an exact retry from changed work;
- `acquired`, `in_progress`, and `replay` describe who may execute and what a
  later caller can recover; and
- snapshot and restore methods let the process-local reference transaction
  return to its complete prior ledger state after an injected failure.

The collision message also gives the caller a constructive next action: reuse
the original payload or allocate a new command identity.

## Exact source identity

| Coordinate | Value |
|---|---|
| Release | `v0.3.2` |
| Annotated tag object | `c3db01079b88622f06e8714c8bcbdf0dc1803a10` |
| Release commit | `fe0bd2a08ac1697ce18ca583d9631faae7db7132` |
| Release tree | `eb8eadb27a9e07c6069a1946f115a0083d94af5c` |
| Git archive SHA-256 | `0ea3db3099e3485f65d238fb2e194c6bfd9b9a90f6642431c4a96974ebcc3c16` |
| Source path | `src/lims_eln_implementation/idempotency.py` |
| Source Git blob | `b6d27293153aec3af868cbfa7c9a3d9e5d28ae12` |
| Source SHA-256 | `217936e75fb1704825108ea4bc0aa6f4027e1e94e5196e340b829d9eb0117543` |
| Source size | 94 lines, 2,964 bytes |

[`release-coordinate.json`](release-coordinate.json) carries these values in a
machine-readable form. It also binds the later release observation, the
implementation tests that exercise the selected behavior, and the immutable
license and attribution files.

## Evidence

Tests in the implementation repository exercise exact replay, changed-content
collision, pending reservation handling, rollback after an idempotency commit
failure, ambiguous vendor outcomes, and tenant participation in a stable key.
A fresh archive of the exact tag ran the nine selected tests successfully.

The Registry's focused check separately establishes that the projected file
has the recorded byte length, line count, Git blob identity, and SHA-256. The
Pages check establishes that the published file preserves those authored bytes.

## Transfer boundary

This file is the deterministic in-memory reference model. A production
implementation selects durable uniqueness, transaction isolation, lease and
fencing semantics, restart recovery, and multi-process coordination, then
verifies the same reservation and replay decisions through its database-backed
route.

The exact copied source is available at
[`source/idempotency.py`](source/idempotency.py). The corresponding immutable
GitHub links in the coordinate record follow the source repository's current
visibility, while this Registry projection provides the selected public bytes.

## License and attribution

Apache-2.0 governs the source. The source repository's `AUTHORS` file retains
its approved provenance, while Git history and reviewed pull requests retain
change chronology and contribution credit. The immutable paths, Git blobs,
and SHA-256 digests are recorded in `release-coordinate.json`.
