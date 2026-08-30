# Document evidence extraction 0.1.0

## Practical question

How can a local document-evidence workflow keep OCR provenance, negation,
era-specific term weighting, and a visual orientation artifact inspectable
while ordered JSON remains the evidence carrier?

This representative reconstruction separates two concerns:

1. **Collection** performs local OCR and records the input digest, engine, and
   settings in a capture JSON file.
2. **Analysis** consumes a capture, applies versioned stop-word data while
   retaining negation terms, aggregates deterministic TF-IDF weights by era,
   and renders a seeded word cloud plus metadata.

The checked-in fixture is a realistic synthetic captured-OCR document. It lets
the analysis contract run on machines without Tesseract while the `ocr`
subcommand remains available for a local image observation.

## Run the deterministic route

From the repository root:

```sh
uv --cache-dir .artifacts/uv-cache run \
  --project snippets/document-evidence-extraction/0.1.0 --locked \
  python snippets/document-evidence-extraction/0.1.0/src/document_evidence.py analyze \
  snippets/document-evidence-extraction/0.1.0/fixtures/synthetic-ocr-capture.json \
  --output .artifacts/document-evidence-extraction/0.1.0
```

The committed `.python-version` and package contract select Python 3.12 as the
first accepted environment. A receiving environment can propose and observe an
additional Python line without treating PNG bytes from different native stacks
as universally equal.

The output directory receives:

- `.document-evidence-output.json` — the ownership sentinel required before an
  existing directory can be replaced;
- `term-weights.json` — normalized, bounded ordered terms by era and across the
  corpus, including the selected `topN`;
- `word-cloud.png` — a seeded orientation view; and
- `render-metadata.json` — declared media type, dimensions, seed, source-weight
  digest, and output SHA-256.

An existing output directory remains in place unless `--replace` is explicit.
Replacement additionally requires the matching ownership sentinel, uses a
sibling backup, and restores it if promotion of the staged output fails.

The TF-IDF vocabulary and inverse-document frequency are fitted once across
the complete capture. Each document vector is L2-normalized; an era view is the
equal-weight mean of its member document vectors rather than a separately
fitted era model.

## Run local OCR collection

Tesseract is an operating-system dependency and is intentionally outside the
ordinary deterministic test path. This command is for operator-selected,
trusted local images; it is not a network or upload intake surface. After
installing Tesseract locally:

```sh
python snippets/document-evidence-extraction/0.1.0/src/document_evidence.py ocr \
  --document requirements-core 2018 /path/to/page-1.png \
  --document review-notes 2019 /path/to/page-2.png \
  --output /tmp/document-ocr-capture.json
```

The command reads each source into one in-memory snapshot, then hashes and OCRs
that same byte sequence. The capture records file names, digests, engine
version, and the complete preprocessing recipe—not local directory paths.
OCR output is an observed input rather than an authoritative transcription.
Collection writes `reviewStanding: requires_human_review`; analysis preserves
that standing in the weighted evidence and render metadata so it can assist the
review without claiming the review occurred. Interpretive use follows human
review. The checked-in synthetic fixture carries
`reviewStanding: reviewed_synthetic_fixture`. An existing local capture changes
only when `--replace` is explicit and the file identifies itself as a
compatible local capture.

## Validate

```sh
uv --cache-dir .artifacts/uv-cache run \
  --project snippets/document-evidence-extraction/0.1.0 --locked \
  python -m unittest discover \
  -s snippets/document-evidence-extraction/0.1.0/tests -v
```

The tests establish:

- explicit negation terms survive a stop-word list that contains them;
- term weights are ordered deterministically by descending weight and then
  lexical tie-break;
- repeated renders from one captured fixture have the same bytes;
- render metadata agrees with the PNG bytes and analysis configuration;
- OCR collection can keep source identity and engine standing without leaking
  a local path or hashing a different file state; and
- output and capture replacement require explicit authority and retain
  recovery behavior.

## Technical judgment

**TARGET:** a source-digested OCR capture, explicit negation retention,
era-aware weights, and a word cloud that remains paired with machine-readable
term evidence.

**CONTRAST:** one opaque script that OCRs, cleans, scores, and overwrites a
picture without an inspectable intermediate or recovery route.

**GUARD:** captured text is reviewable before analysis; deterministic output is
staged before promotion; an existing result changes only through `--replace`.

Time and allocation are dominated by sparse TF-IDF construction and image
rendering. Documents are normalized once; era aggregation reuses the fitted
matrix. Terms are sorted once per era, and output order is explicit.

## Evidence and transfer boundary

The artifact is a participant-account-supported representative reconstruction
of a 2018–2019 method. The fixture is synthetic. The checks establish the code
behavior in the current dependency environment; they do not establish byte or
implementation equality with an earlier production system, OCR accuracy on an
unseen corpus, or the interpretive importance of a frequent term.

A receiving implementation selects its own corpus, OCR review policy,
stop-word data, era model, privacy boundary, and interpretation method. The
weighted JSON remains the evidence carrier; the word cloud is an orientation
surface.
