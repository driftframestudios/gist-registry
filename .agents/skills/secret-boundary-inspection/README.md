# Secret boundary inspection

Use this skill to inspect secret-shaped material across the actual tree,
artifact, index, history, image, or media boundary requested by a task. It
keeps scan authority, completed scopes, findings, faults, redaction, and
recovery distinct so a clean result means exactly what the receiver observed.

## Fastest start

1. Read the [skill contract](SKILL.md).
2. Name the exact scopes, source coordinate, accepted scanner/configuration,
   and receiver that owns findings and faults.
3. Map the receiving implementation with the
   [receiver adapter contract](references/receiver-adapter-contract.md).
4. Run the scanner's operational canary before interpreting a clean result.
5. From this skill directory, run `node exercises/exercise.mjs`; run
   `node --test exercises/source-identity.test.mjs` for the source-selection
   regression.

Example request:

> Use `$secret-boundary-inspection` to inspect the proposed public artifact,
> its embedded metadata, and the selected Git history. Return redacted scope
> receipts and route any finding through the repository's existing owner.

## Success example

The accepted scanner passes a fresh canary, completes the requested tree and
media-metadata scopes, and returns redacted clean receipts bound to the exact
source and configuration. Index and history remain outside the requested
scope, so the handoff describes the completed observation precisely.

## Recovery example

The scanner process exits before producing a valid report. The adapter records
an incomplete observation, preserves any independently completed scope, and
routes the fault to the scanner owner. A safe public receipt carries the scope,
failure class, and next action while sensitive diagnostic details stay with the
authorized receiver.

## Package map

- [Skill contract](SKILL.md): scope model, rules, sequence, and completion.
- [Embedded metadata](references/embedded-metadata.md): image, video, document,
  archive, and container inspection boundaries.
- [Evidence and recovery](references/evidence-and-recovery.md): canaries,
  findings, faults, resting states, and safe projection.
- [Receiver adapter contract](references/receiver-adapter-contract.md): maps
  the portable procedure to an actual scanner and repository.
- [Exercise guide](exercises/README.md): runnable synthetic scenarios and their
  limits.
- [`exercise.mjs`](exercises/exercise.mjs) and
  [`source-identity.test.mjs`](exercises/source-identity.test.mjs): adapter and
  source-selection proofs.

## Maturity and transfer boundary

This package supplies a portable boundary and a synthetic native-adapter
exercise. The receiving repository supplies its scanner, configuration,
installation evidence, revision, redaction policy, and operational authority.
Canary and focused tests establish their named scopes. Credential response,
incident handling, publication, and external-system mutation remain with their
existing owners.
