# Mechanisms and receiving evidence

Consult this reference when a resource wrapper or exception translation can
change the lifecycle. Primary documentation was checked on 2026-10-15.

| Source | Established mechanism | Receiving consequence and limit |
| --- | --- | --- |
| [Python 3.12 exception hierarchy and chaining](https://docs.python.org/3.12/library/exceptions.html) | Control exceptions, cause/context, notes, and groups have distinct runtime behavior | Select the caller's propagation policy explicitly; a public message does not define access to the underlying object |
| [Python 3.12 cleanup clauses](https://docs.python.org/3.12/tutorial/errors.html#defining-clean-up-actions) | A cleanup clause can produce a new failure while another is active | Keep teardown completion and final error selection as separate jobs |
| [Python 3.12 fdopen](https://docs.python.org/3.12/library/os.html#os.fdopen) and [open](https://docs.python.org/3.12/library/functions.html#open) | Stream construction and descriptor closure have a `closefd` ownership contract | Audit raw descriptor and wrapper lifetimes independently; the receiving runtime still needs actual close-state observations |

## Alternatives and selection

Four routes were compared in the receiving work: more nested `try/finally`
blocks at every caller; one universal transaction/publication framework;
reusing an existing wrapper without changing its policy; and a small explicit
release owner with caller-selected translation. The fourth route preserved
readability across differing database and filesystem protocols. Existing
framework owners remain preferable when their documented policy already fits.

## Exercised lineage

[Enterprise #85](https://github.com/driftframestudios/lims-eln-enterprise-implementation/pull/85)
at runtime `ae213e7c01262431030a2a8d81129bed090f1376` separated stream and
raw-descriptor ownership after review showed interrupted stream close could
leak the descriptor. The focused checks exercised partial construction,
cursor/connection release, ordinary failures, and interruption. Its native
PostgreSQL and hosted database observations belong to that receiving source;
this skill carries the transferable review rule.

[Comparative #71](https://github.com/driftframestudios/lims-eln-comparative-evidence/pull/71)
at `98e9808a3f3a2c1aafc7eec0792815a85614c3c1` made staging ownership and final
failure selection explicit. Thirty focused tests and composed real-I/O probes
passed. Separate source mutations retained pending ownership after rename or
bypassed selected control-signal precedence; each failed a public-result and
retained-state regression. This is evidence from those protocols, not a claim
that every context manager or storage device shares their guarantees.

The local exercise is an intentionally small state model. It makes the
ownership and precedence distinctions independently inspectable. Actual OS
closure, namespace races, database isolation, and storage-device durability
remain receiving-runtime observations.
