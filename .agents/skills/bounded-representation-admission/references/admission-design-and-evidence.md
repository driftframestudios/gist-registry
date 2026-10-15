# Admission design and evidence

Primary runtime documentation was checked on 2026-10-15. The design bridge
below separates platform behavior from a receiving policy.

| Evidence | Mechanism | Receiving rule and limit |
| --- | --- | --- |
| [Python JSON](https://docs.python.org/3.12/library/json.html) | Parsing can consume substantial resources; duplicate keys and nonfinite values have configurable behavior | Bound the actual representation and select strictness explicitly; the library documentation supplies no universal capacity |
| [Integer string conversion limits](https://docs.python.org/3.12/library/stdtypes.html#integer-string-conversion-length-limitation) | Decimal conversion has a configurable limit with a documented nonzero minimum | Choose a supported integer envelope or a different explicit wire representation; verify the lowest supported configuration |
| [Copy semantics](https://docs.python.org/3.12/library/copy.html) | Assignment, shallow copying, and deep copying have different alias behavior | Observe the admitted snapshot after caller mutation; count copies separately from traversal work |

## Cost map

| Stage | Cost variables | Smallest distinguishing observation |
| --- | --- | --- |
| Read/decode | Encoded bytes, parser depth, numeric spelling | Oversized input rejected before decode; deepest supported fixture parsed |
| Shape admission | Values, keys, expanded occurrences, depth | Repeated aliases charged per occurrence; cycles rejected; bounded visitor state |
| Ownership | Accepted live values and text | One detached snapshot; later caller mutation leaves its bytes unchanged |
| Compare/calculate | Paths, operand bit length, sorting keys | Exact oracle at finite extremes and configured numeric limits |
| Render/publish | Expanded rows, text, escaping, member count | Produced output admitted by its receiver; rejected successor preserves accepted bytes |

Four routes were considered: a CLI byte cap, a shared representation owner,
reuse of optional domain models, and streaming. Comparative selected the
representation owner because native decoded callers and saved reports shared
the missing cost boundary while dependency-light contracts remained useful.
Streaming becomes a fitting successor when accepted volumes exceed the
bounded in-memory route and its added framing/recovery costs are justified.

## Exercised receiving cases

[Comparative #72](https://github.com/driftframestudios/lims-eln-comparative-evidence/pull/72)
at runtime `c1658a6c9b0a603de8e13ccd44c23be92add38ff` moved admission ahead of
shape sorting, charged shared-reference expansion, and reduced compatibility
snapshots from three to one. Independent review exercised 814 exact-byte and
one-under cases, frozen/detached values, minimum interpreter digit settings,
materialized dependency-light profiles, and rejected-output preservation. A
2,048-bit integer envelope fits at most 617 decimal digits for that contract.
That value describes its supported policy; another receiver selects its own.

[Simulation #63](https://github.com/driftframestudios/lims-eln-simulated-final-state/pull/63)
at `83e24982abe884fabe691df673365edd561e6969` bound size admission to the
captured invocation used by approval and execution. Growth, shrinkage,
non-JSON mutation, nested aliases, handler mutation, and receipt replay became
distinct observations. A live caller dictionary and an earlier snapshot had
different cost and identity meaning; the skill preserves that distinction.

The local exercise deliberately accepts only a short list of text labels. It
demonstrates pre-sort rejection and a detached value; it is a teaching
boundary, rather than a replacement for the complete JSON owner above.
