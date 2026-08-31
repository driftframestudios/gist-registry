# Document evidence core patterns 0.1.0

This compact companion shows two implementation details that often decide
whether document-processing evidence stays inspectable: binding observation
and identity to the same source bytes, and replacing output through an owned,
recoverable promotion.

## Reading order

1. [`gist/00-README.md`](gist/00-README.md) frames the practical question and
   evidence reach.
2. [`gist/10-same-byte-capture.md`](gist/10-same-byte-capture.md) maps the
   source snapshot to the OCR reader, digest, locator-safe name, and review
   standing.
3. [`gist/20-recovery-aware-promotion.md`](gist/20-recovery-aware-promotion.md)
   maps output ownership to explicit replacement, staged promotion, rollback,
   and retained recovery material.

The [complete versioned artifact](../../document-evidence-extraction/0.1.0/)
carries the imports, surrounding validation, CLI, dependency lock, realistic
synthetic fixture, expected result, and focused test suite. This companion is
classified as a `code_excerpt` because its job is portable technical
orientation. The complete artifact carries independent execution.

## Source and evidence map

| Companion | Complete source | Focused evidence |
| --- | --- | --- |
| Same-byte capture | `src/document_evidence.py::collect_ocr` | `test_collection_records_source_identity_without_local_directory` |
| Recovery-aware promotion | `src/document_evidence.py::_require_owned_output_directory`, `_promote_staged_directory` | `test_output_authority_and_recovery_preserve_prior_state` |

The complete package tests establish current behavior with its committed
fixture and locked environment. Transfer to another workflow still calls for
receiver-specific review policy, storage authority, filesystem behavior, data
classification, and recovery observation.

## Gist publication boundary

The three ordered files in `gist/` are the complete proposed Gist file set.
Human review retains the publication decision. After publication, the Gist ID,
exact revision, filenames, and content digests can be recorded as a projection
relationship while this version remains the editable-meaning authority.
