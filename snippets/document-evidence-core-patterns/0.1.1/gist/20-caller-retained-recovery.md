# Pattern 2 — Let retained recovery state survive caller cleanup

Promotion and carrier cleanup have separate responsibilities. The caller may
remove an ordinary failed stage, while `retains_staged_recovery` transfers
cleanup authority to the recovery path when that stage contains the successor
needed for re-entry.

## Directory caller selection

From the promotion and exception boundary inside
`document_evidence.py::analyze_capture`:

```python
        _promote_staged_directory(
            staged,
            output_dir,
            replace=replace,
            operations=promotion_operations,
            recovery_id=recovery_id,
        )
    except BaseException as error:
        if staged.exists() and not retains_staged_recovery(error, staged):
            shutil.rmtree(staged)
        raise
```

## File caller selection

From the promotion and exception boundary inside
`document_evidence.py::collect_ocr`:

```python
    try:
        write_json(staged, record)
        _promote_staged_capture(
            staged,
            output_path,
            replace=replace,
            operations=promotion_operations,
            recovery_id=recovery_id,
        )
    except BaseException as error:
        if staged.exists() and not retains_staged_recovery(error, staged):
            staged.unlink()
        raise
    return record
```

## Specification by example

The directory-carrier test injects activation and restoration failures through
the public analysis caller. The prior analysis and complete staged successor
remain available even though the accepted target coordinate is temporarily
empty.

```python
    def test_analysis_dual_failure_retains_both_generations_for_reentry(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / "accepted"
            document_evidence.analyze_capture(CAPTURE_PATH, target)
            prior_term_weights = (target / "term-weights.json").read_bytes()
            activation_error = OSError("analysis activation stopped")
            restoration_error = OSError("analysis restoration stopped")
            operations = FaultingPromotionOperations(
                {
                    filesystem_promotion.PromotionOperation.ACTIVATE_SUCCESSOR: [activation_error],
                    filesystem_promotion.PromotionOperation.RESTORE_PRIOR: [restoration_error],
                }
            )

            with self.assertRaises(filesystem_promotion.PromotionRecoveryError) as caught:
                document_evidence.analyze_capture(
                    CAPTURE_PATH,
                    target,
                    replace=True,
                    promotion_operations=operations,
                    recovery_id="d" * 32,
                )

            error = caught.exception
            self.assertIs(error.primary_error, activation_error)
            self.assertIs(error.recovery_error, restoration_error)
            self.assertFalse(target.exists())
            self.assertEqual(
                (error.prior / "term-weights.json").read_bytes(),
                prior_term_weights,
            )
            self.assertTrue((error.staged / "term-weights.json").is_file())
            self.assertEqual(
                json.loads(
                    (error.staged / document_evidence.OUTPUT_SENTINEL).read_text(encoding="utf-8")
                )["workflowVersion"],
                "0.1.1",
            )
```

The file-carrier test exercises the same dual failure through the public OCR
caller. The prior capture bytes and ready successor text remain separately
inspectable.

```python
    def test_collection_dual_failure_retains_both_generations_for_reentry(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source.png"
            source.write_bytes(b"source")
            target = root / "capture.json"

            def reader(_source_bytes: bytes, _source_name: str) -> dict[str, str]:
                return {
                    "text": "Accepted OCR text",
                    "engineName": "fixture-reader",
                    "engineVersion": "1.0",
                    "settings": "deterministic",
                }

            document_evidence.collect_ocr(
                [("document", "2019", source)],
                target,
                reader=reader,
            )
            prior_capture = target.read_bytes()
            activation_error = OSError("capture activation stopped")
            restoration_error = OSError("capture restoration stopped")
            operations = FaultingPromotionOperations(
                {
                    filesystem_promotion.PromotionOperation.ACTIVATE_SUCCESSOR: [activation_error],
                    filesystem_promotion.PromotionOperation.RESTORE_PRIOR: [restoration_error],
                }
            )

            with self.assertRaises(filesystem_promotion.PromotionRecoveryError) as caught:
                document_evidence.collect_ocr(
                    [("document", "2019", source)],
                    target,
                    reader=lambda _bytes, _name: {
                        "text": "Ready successor OCR text",
                        "engineName": "fixture-reader",
                        "engineVersion": "1.0",
                        "settings": "deterministic",
                    },
                    replace=True,
                    promotion_operations=operations,
                    recovery_id="e" * 32,
                )

            error = caught.exception
            self.assertIs(error.primary_error, activation_error)
            self.assertIs(error.recovery_error, restoration_error)
            self.assertFalse(target.exists())
            self.assertEqual(error.prior.read_bytes(), prior_capture)
            self.assertIn(
                "Ready successor OCR text",
                error.staged.read_text(encoding="utf-8"),
            )
```

These tests establish that both public carrier callers preserve staged and
prior generations after dual failure. Cleanup after successful acceptance and
recovery under broader writer, durability, or platform models remain with the
complete artifact and their named observations.
