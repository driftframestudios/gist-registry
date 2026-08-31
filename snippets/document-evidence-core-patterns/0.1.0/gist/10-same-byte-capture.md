# Pattern 1 — Bind observation and identity to one byte snapshot

The source is read once. The reader receives that snapshot, and the digest is
computed from the same in-memory bytes. The captured record retains the
basename, OCR configuration, and a review standing.

## Source selection

From `document_evidence.py::collect_ocr`:

```python
source_path = source_path.resolve()
if output_path == source_path:
    raise EvidenceWorkflowError("capture output must differ from every source document")
source_bytes = source_path.read_bytes()
result = reader(source_bytes, source_path.name)
for field in ("text", "engineName", "engineVersion", "settings"):
    if not isinstance(result.get(field), str) or not str(result[field]).strip():
        raise EvidenceWorkflowError(f"OCR reader field {field} must be a non-empty string")
current_engine = {
    "name": str(result["engineName"]),
    "version": str(result["engineVersion"]),
    "settings": str(result["settings"]),
}
if engine is not None and engine != current_engine:
    raise EvidenceWorkflowError("one OCR capture must use one engine configuration")
engine = current_engine
captured.append(
    {
        "id": document_id,
        "era": era,
        "sourceName": source_path.name,
        "sourceSha256": sha256_bytes(source_bytes),
        "text": str(result["text"]),
    }
)
```

The enclosing record makes the review and source class explicit:

```python
record = {
    "artifactId": ARTIFACT_ID,
    "captureVersion": WORKFLOW_VERSION,
    "captureRole": "local_ocr_capture",
    "reviewStanding": "requires_human_review",
    "sourceClass": "local_image_observation",
    "ocrEngine": engine,
    "documents": captured,
}
```

## Specification by example

The focused test changes the file after the reader receives the snapshot. The
recorded digest still resolves to the original observed bytes, and serialized
output carries the basename rather than the collector's local directory.

```python
original_source = b"synthetic-image-bytes"
source.write_bytes(original_source)
capture_path = root / "nested" / "capture.json"

def reader(source_bytes: bytes, source_name: str) -> dict[str, str]:
    self.assertEqual(source_bytes, original_source)
    self.assertEqual(source_name, source.name)
    source.write_bytes(b"changed-after-snapshot")
    return {
        "text": "Reviewed OCR text",
        "engineName": "fixture-reader",
        "engineVersion": "1.0",
        "settings": "deterministic",
    }

record = document_evidence.collect_ocr(
    [("document", "2019", source)],
    capture_path,
    reader=reader,
)
serialized = capture_path.read_text(encoding="utf-8")

self.assertEqual(record["documents"][0]["sourceName"], source.name)
self.assertEqual(
    record["documents"][0]["sourceSha256"],
    hashlib.sha256(original_source).hexdigest(),
)
self.assertNotIn(str(root), serialized)
self.assertEqual(record["ocrEngine"]["name"], "fixture-reader")
self.assertEqual(record["reviewStanding"], "requires_human_review")
```

The observation establishes source-identity coherence and locator-safe
serialization for this implementation. OCR accuracy remains a separate
corpus-level observation.
