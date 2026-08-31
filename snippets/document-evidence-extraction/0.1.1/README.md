# Document evidence extraction 0.1.1

## Practical question

How can a local document-evidence workflow keep OCR provenance, ordered term
evidence, and deterministic rendering inspectable while one trusted writer can
replace a prior result through a typed recovery path?

This candidate successor keeps the collection and analysis relationship from
`0.1.0` and gives directory outputs and capture files one shared filesystem
transition. A complete successor is staged beside its target. Explicit replace
authority and a matching ownership record allow the prior generation to move
to a transaction-specific recovery coordinate before the successor becomes
accepted.

The operating model is deliberately small: one cooperative writer works in a
trusted parent directory whose entries remain stable except for that writer's
operations. When prior movement or successor activation raises a Python event,
including `KeyboardInterrupt`, the transition reads the named coordinates and
reverses any completed rename effect while recovery operations can execute. It
returns the prior and ready stage before propagating the original event. A
recovery operation event receives the same observation: a completed effect is
recorded on the original event, while a pre-effect stop produces a
`PromotionRecoveryError` with every event, coordinate, phase, and observed
state for re-entry.

## Run the deterministic route

From the repository root:

```sh
uv --cache-dir .artifacts/uv-cache run \
  --project snippets/document-evidence-extraction/0.1.1 --locked \
  python snippets/document-evidence-extraction/0.1.1/src/document_evidence.py analyze \
  snippets/document-evidence-extraction/0.1.1/fixtures/synthetic-ocr-capture.json \
  --output .artifacts/document-evidence-extraction/0.1.1
```

The committed `.python-version` and package contract select Python 3.12 as the
first candidate environment. A receiving environment can propose and observe
another Python line while keeping render-byte claims tied to its resolved
native stack.

The output directory receives:

- `.document-evidence-output.json` — the emitted `0.1.1` ownership sentinel;
- `term-weights.json` — normalized, bounded ordered terms by era and across the
  corpus, including the selected `topN` and workflow version;
- `word-cloud.png` — a seeded orientation view; and
- `render-metadata.json` — declared media type, dimensions, seed, source-weight
  digest, and output SHA-256.

The TF-IDF vocabulary and inverse-document frequency are fitted once across
the complete capture. Each document vector is L2-normalized; an era view is the
equal-weight mean of its member document vectors.

## Version compatibility

Artifact and analysis-output identity advance to `0.1.1`. The capture format
remains `0.1.0`, so a coherent `0.1.0` reviewed fixture or local OCR capture can
flow into this successor unchanged. New local collection also emits
`captureVersion: 0.1.0`; the output sentinel and term evidence carry
`workflowVersion: 0.1.1`.

With explicit `--replace` authority, the successor can also receive an existing
analysis directory whose exact ownership sentinel identifies workflow `0.1.0`.
That compatibility route treats the prior directory as a migration input; the
accepted successor always emits the `0.1.1` sentinel. Unrecognized or malformed
ownership records preserve the existing directory unchanged.

This separation lets a receiver strengthen filesystem behavior without
rewriting the already sufficient capture envelope. A future capture-format
version can begin when document identity, OCR provenance, or review standing
needs a material change of its own.

## Run local OCR collection

Tesseract is an operating-system dependency outside the ordinary deterministic
test route. This command receives operator-selected trusted local images and
writes a reviewable local capture:

```sh
python snippets/document-evidence-extraction/0.1.1/src/document_evidence.py ocr \
  --document requirements-core 2018 /path/to/page-1.png \
  --document review-notes 2019 /path/to/page-2.png \
  --output /tmp/document-ocr-capture.json
```

The command reads each source into one in-memory snapshot, then hashes and OCRs
that same byte sequence. The capture carries file names, digests, engine
identity, the complete preprocessing recipe, and
`reviewStanding: requires_human_review`. Local directory paths stay with the
operator. Analysis preserves the review standing so ordered evidence can
support the review while interpretive judgment remains with its human owner.

## Filesystem promotion contract

`src/filesystem_promotion.py` supplies one transition for directory and file
carriers. Carrier adapters validate ownership before the transition and retire
prior material only after successor acceptance.

The transition has five semantic operation boundaries:

1. `MOVE_PRIOR` moves an accepted target to a unique sibling recovery path.
2. `ACTIVATE_SUCCESSOR` moves the complete stage into the target coordinate.
3. `RETAIN_SUCCESSOR` reverses an activation whose event arrived after the
   rename effect.
4. `RESTORE_PRIOR` returns the prior generation when activation stops.
5. `REMOVE_PRIOR` performs carrier-specific post-acceptance retirement.

Successful reconciliation restores the prior, retains the ready successor, and
re-raises the original Python event. Recovery-operation events observed after
their effects remain attached to that original event. A recovery route that
stops before reaching this state raises a typed surface whose `primary_error`,
`recovery_errors`, phase, three coordinates, and observed occupancy keep the
next decision legible.

Successor acceptance precedes prior retirement. File retirement uses one
unlink operation. Directory retirement is recursive and can report an error
after removing some entries, so its warning identifies the remaining material
for inspection rather than describing it as a complete recoverable generation.

## Validate

```sh
uv --cache-dir .artifacts/uv-cache run \
  --project snippets/document-evidence-extraction/0.1.1 --locked \
  python -m unittest discover \
  -s snippets/document-evidence-extraction/0.1.1/tests -v
```

The focused tests exercise:

- retained negation, ordered term evidence, seeded rendering, and capture
  review standing;
- one shared transition contract for directory and file carriers;
- events before and after prior movement, successor activation, retention, and
  restoration effects;
- restoration of the prior generation with propagation of the identical
  original event and attached post-effect recovery events;
- typed recovery reporting with every cause, coordinate, phase, and observed
  occupancy state;
- complete-caller retention of staged and prior material after dual failure;
  and
- successor acceptance before carrier-specific cleanup and cleanup-warning
  behavior.

## Technical judgment

**TARGET:** a source-digested capture, visible negation, ordered era-aware
weights, deterministic rendering, and one typed promotion transition shared by
directory and file outputs.

**CONTRAST:** carrier-specific replacement paths that discard staged recovery
material or replace the event that first interrupted promotion.

**GUARD:** explicit authority, a complete sibling stage, a small
mutation-critical reconciliation envelope, cause-retaining errors, and
post-acceptance retirement keep accepted and recovery states legible.

Time and allocation remain dominated by sparse TF-IDF construction and image
rendering. The promotion layer adds a finite transition and a narrow operation
adapter, keeping its recovery evidence independent from incidental path-method
call counts.

## Evidence and future probes

The focused suite establishes the candidate's behavior for injected Python
events and real temporary filesystems in the resolved test environment. Static
symbolic-link and ownership checks provide momentary observations within the
trusted-parent model. They are not TOCTOU protection; descriptor-relative
opens, no-follow semantics, and opened-object verification remain a
capability-gated Unix probe.

The following operating models retain their own fitting mechanisms and
evidence routes:

- participating local POSIX writers call for ownership-bearing advisory
  locking, a transaction journal, and deterministic reconciliation;
- process, host, and power-loss durability call for an ordered persistence
  protocol, restart observations, and named filesystem environments;
- another process with the same parent-directory authority calls for a
  stronger authorization or sandbox boundary;
- concurrent readers that need complete old-or-new visibility call for
  immutable generations, one-resolution references, and retention-aware
  cleanup; and
- Windows parity for descriptor hardening calls for a declared handle and
  reparse-point contract.

The fixture remains realistic synthetic material. The analysis checks establish
behavior in the resolved environment; unseen-corpus OCR accuracy, historical
production equality, interpretive importance, and the future operating models
above retain their own evidence routes.

## Standing

The manifest records `candidate` maturity. Reviewed merge, registry membership,
an immutable tag, Pages delivery, and optional Gist publication remain distinct
coordinates with their existing owners. This versioned README continues to
describe the runnable behavior as those coordinates advance.
