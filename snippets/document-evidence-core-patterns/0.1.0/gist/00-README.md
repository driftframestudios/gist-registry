# Document evidence: two integrity patterns worth carrying forward

Document-processing pipelines become easier to trust when a reviewer can
follow two relationships directly:

1. the bytes observed by OCR are the bytes named by the source digest; and
2. accepted output moves through an owned staging and recovery path.

The adjacent excerpts show those relationships in a representative Python
workflow. They are source-mapped teaching selections. The complete runnable
artifact carries the surrounding validation, CLI, dependency lock, synthetic
fixture, expected result, and focused tests:

- [Complete document-evidence artifact](https://kindlight.io/snippets/document-evidence-extraction/0.1.0/)
- [Compact companion manifest](https://kindlight.io/snippets/document-evidence-core-patterns/0.1.0/snippet.json)

## Why these two

A file path can point to different bytes across time. Reading once and passing
that same snapshot to observation and hashing keeps identity coherent. A
basename keeps a useful public-safe source label while the local directory
stays with its authorized collector.

Output replacement carries a second authority question: which directory is
owned by this workflow, and what happens when promotion stops midway? An
ownership sentinel, explicit replacement, a sibling backup, and rollback on
promotion failure keep the prior result recoverable.

## Evidence standing

The selections come from `document-evidence-extraction@0.1.0`, where focused
tests exercise same-byte capture, locator-safe serialization, explicit output
ownership, failed-promotion rollback, and retained backup behavior. The
examples establish those mechanics for the committed implementation.
Receiver-specific OCR quality, storage semantics, privacy review, and
operational recovery remain local observations.

## Suggested use

Use these excerpts as review prompts for any workflow that converts source
documents into derived evidence:

- Where is the immutable source snapshot formed?
- Which digest identifies the bytes actually observed?
- Which source locator is appropriate to carry forward?
- What marks an output as workflow-owned?
- Which accepted state survives an interrupted replacement?
