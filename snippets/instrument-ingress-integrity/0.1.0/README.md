# Instrument ingress integrity 0.1.0

## Practical question

How can an instrument-ingress boundary preserve exact source bytes while
keeping transport delivery, logical acquisition, scientific normalization,
replay, and quarantine decisions legible under retries and concurrent
arrivals?

This version answers with one process-local conformance model. Caller-owned
bytes become an immutable snapshot before hashing, parsing, or mapping. A
tenant-scoped repository then aligns the raw capture, delivery receipt,
logical acquisition, and accepted or quarantined outcome through one
copy-on-write publication point.

## Three identities, three jobs

| Identity | Meaning | Observable behavior |
| --- | --- | --- |
| Delivery ID | One transport attempt | An exact retry returns its recorded receipt. Changed delivery meaning returns an explicit comparison. |
| Acquisition ID | One logical instrument occurrence | Another delivery can converge on the established occurrence or carry reviewable conflict evidence. |
| Raw SHA-256 | One exact byte sequence | The tenant-scoped content address preserves byte equality without becoming the occurrence identity. |

Two acquisitions may contain the same bytes. They share one tenant-scoped raw
capture while retaining distinct domain outcomes. Two deliveries may also
describe one acquisition. The first settles the acquisition; the next records
a duplicate-delivery receipt linked to its canonical delivery.

Every acquisition fingerprint binds tenant, source instrument, acquisition,
specimen, purpose, capture time, media type, raw digest, optional vendor
message identity, and fixed parser and mapping contracts. The delivery
fingerprint adds delivery identity and receive time.

## Run the realistic synthetic encounter

From the repository root:

```sh
uv --cache-dir .artifacts/uv-cache run \
  --project snippets/instrument-ingress-integrity/0.1.0 --locked \
  python snippets/instrument-ingress-integrity/0.1.0/src/instrument_ingress.py \
  snippets/instrument-ingress-integrity/0.1.0/fixtures/accepted-measurement.json \
  snippets/instrument-ingress-integrity/0.1.0/fixtures/quarantined-measurement.json
```

The deterministic JSON result should match
[`expected/ingress-run.json`](expected/ingress-run.json) byte-for-byte. It
shows one accepted result, one unsupported-unit quarantine, exact replay of
both receipts, retained raw-byte equality, and the final repository counts.

## Pipeline and commit shape

The route:

1. snapshots the complete raw buffer;
2. computes raw SHA-256 and byte length;
3. resolves existing delivery and acquisition identities under the repository
   lock;
4. parses and maps a new acquisition outside the lock;
5. repeats both identity checks after that work;
6. prepares detached raw, receipt, acquisition, and outcome maps; and
7. publishes the frozen candidate through one state reference change.

The second identity check lets concurrent callers converge after they perform
work at the same time. The accepted state remains available for snapshot
reads. A reentrant commit receives an explicit process-local boundary.

Expected intake, parse, and mapping decisions become typed quarantine records
with stable reason codes, bounded details, exact byte coordinates, pipeline
identity, and constructive recovery. Unexpected parser or mapper faults
propagate to their caller while the repository retains its pre-call snapshot.

## Byte and normalized-document identity

Raw SHA-256 answers whether two source byte sequences agree. The normalized
document digest identifies one canonical, lineage-bound projection. That
document retains the raw digest, explicit decimal string, precision, scale,
UCUM code and system, and the parser and mapper contract identities that
produced it. It therefore changes when source bytes or pipeline identity
change, even when the scientific fields normalize to equal values. Scientific
equivalence remains a separate domain decision. Each digest can be reproduced
independently.

The released parser accepts one strict JSON object with `analyte`, `value`, and
`unit`. Duplicate members, non-finite values, ambiguous structures, missing or
additional fields, payload limits, and media-type differences receive named
routes. The released mapper accepts finite bounded decimals and three explicit
unit spellings; a wider decimal or another unit enters scientific mapping
review.

## Validate

```sh
npm run check:python-lock:instrument-ingress-integrity:0.1.0
npm run lint:python:instrument-ingress-integrity:0.1.0
npm run test:python:instrument-ingress-integrity:0.1.0
```

The focused suite establishes:

- immutable caller-buffer capture;
- linked raw and lineage-bound normalized-document digests;
- stable accepted and quarantined replay;
- delivery, acquisition, and tenant identity behavior;
- one raw capture across equal-byte acquisitions in one tenant;
- reviewable identity conflicts with the established outcome preserved;
- strict intake, JSON, decimal, and unit-profile routes;
- typed digest-collision handling through an injected hash seam;
- complete pre-call-state preservation across parser, mapper, reentrant, and
  every detached commit fault;
- process-local concurrent convergence; and
- deterministic fixture output.

## Technical judgment

**TARGET:** one exact raw capture, one recorded delivery meaning, and one
logical acquisition outcome whose scientific projection remains linked to its
source bytes.

**CONTRAST:** treating transport identity, logical occurrence, and byte digest
as one key makes retries, equal-byte acquisitions, and changed source meaning
indistinguishable.

**GUARD:** immutable capture, separate fingerprints, strict parser and mapper
results, a second identity check, tenant-scoped content addressing, detached
candidate maps, and one publication point preserve the demonstrated boundary.

The copy-on-write model makes recovery inspectable: an interrupted candidate
is discarded while readers retain the accepted snapshot. It favors teaching
clarity over sustained mutation throughput.

## Source, evidence, and transfer boundary

This realistic synthetic artifact is a separately reviewed public adaptation
of authorized LIMS/ELN specification, implementation, and Site Reading source
roles. Its manifest carries their stable semantic source keys and captured
integration coordinates. The versioned implementation and focused tests own
the behavior claimed for `0.1.0`.

The suite establishes exact-byte capture, strict normalization, semantic
replay and reconciliation, one-instance concurrent convergence, and
copy-on-write fault recovery in the resolved Python 3.12 environment. SHA-256
supplies content comparison; authenticity remains with a separate trust
mechanism.

A durable receiver can place raw content in a governed object store and align
its locator, inbox receipt, acquisition, normalized measurement, and
quarantine evidence in one durable transaction. Database isolation, commit
durability, restart behavior, participating processes, object-store
coordination, configured instrument authenticity, assay-bound mapping
qualification, quarantine resolution, and operational acceptance each retain
their own implementation and observation routes.

The manifest records a proposed Gist source set and reading order. A public
Gist remains a separate human-held exact-version publication action.
