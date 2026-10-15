# Failure intervals and evidence

Use this guide when commit, response, cleanup, and recovery can produce
different outcomes. Begin with the receiving implementation's actual state
machine and publication primitive. The following rows select observations;
they supply neither a transaction implementation nor a universal retry policy.

## Place faults at meaning-bearing transitions

| Interval | Expected evidence | Recovery decision |
| --- | --- | --- |
| Preparation before publication | A populated accepted state remains equal; candidate effects stay unaccepted. | Repair preparation or retry under the declared input contract. |
| During publication | The authority identifies accepted, rejected, or unresolved outcome. | Reconcile unresolved state through the operation's recorded identity. |
| After commit, before the caller receives a response | The complete effect set and recorded outcome survive. | Same-meaning retry retrieves that outcome; changed meaning enters reconciliation. |
| Cleanup after a successful body | The established body outcome remains distinguishable from failed release. | Recover the retained resource; infer logical retry only from publication state. |
| Cleanup after a failed body | The primary failure and all material release failures remain inspectable. | Complete resource recovery while preserving the original operation evidence. |

An exception class alone can leave the commit decision unresolved. Bind the
observation to the precise injection point and inspect the authoritative
records. A process restart, database crash, restored backup, and external
delivery retry each use different observation owners.

## Distinguish serialization, retry, and authority

- **Forced overlap:** Synchronize actors so their operations actually overlap
  at the disputed state. Sequential success establishes sequential behavior.
- **Complete meaning:** Change one meaning-bearing field while retaining the
  logical identity. Expect an explicit reconciliation result and preservation
  of the accepted effects.
- **Freshness:** Move a version, epoch, approval, or relevant state after
  preparation. Observe the publication-time admission decision.
- **Current resource instance:** Recreate a resource under a reused logical
  name. Prior creation evidence stays historical; current cleanup authority
  follows the admitted instance and owner.
- **External delivery:** Observe the durable local handoff separately from
  receiving-system acknowledgement and its duplicate policy.

Each selected test asserts the relationship the operation owns: field meaning,
effect identity, exact prior state, and outcome. Effect counts help when counts
are part of the claim; matching counts can still hide different records.

## Whole-path work remains visible

A lock can serialize correctness while extending contention across I/O. A copy
can isolate candidate state while allocating the complete aggregate. A digest
can bind meaning while repeatedly walking the same source. Include those costs
when they change the mechanism choice, using input sizes, ownership lifetime,
and a fitting observation. An optimized local step leaves downstream encoding,
transfer, and retained-state costs with their actual owners.

## Recovery scenario

- Given a durable operation has committed and its response is lost
- And closing the client connection also raises an error
- When the caller reconstructs the outcome
- Then the committed operation record supplies the logical result
- And the close error remains a separate resource diagnostic
- And an automatic write retry follows only the operation's admitted replay
  contract

This scenario states intended behavior. The receiving runtime supplies the
actual injection, persisted-state observation, and retry proof; a source-only
review carries the unobserved portions as explicit next checks.

[Return to transaction boundary evidence mapping](../SKILL.md)
