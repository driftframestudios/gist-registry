from __future__ import annotations

import hashlib
import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ARTIFACT_ROOT = Path(__file__).resolve().parents[1]
SOURCE_PATH = ARTIFACT_ROOT / "src" / "document_evidence.py"
CAPTURE_PATH = ARTIFACT_ROOT / "fixtures" / "synthetic-ocr-capture.json"
EXPECTED_PATH = ARTIFACT_ROOT / "expected" / "contract.json"

SPEC = importlib.util.spec_from_file_location("document_evidence", SOURCE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Unable to load artifact source: {SOURCE_PATH}")
document_evidence = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = document_evidence
SPEC.loader.exec_module(document_evidence)


class DocumentEvidenceTests(unittest.TestCase):
    def test_stopword_policy_retains_negation(self) -> None:
        stopwords, digest = document_evidence.load_stopwords()
        tokens = document_evidence.normalize_text(
            "The result is not complete, with no overwrite and without silent loss.",
            stopwords,
        )

        self.assertRegex(digest, r"^[a-f0-9]{64}$")
        self.assertTrue({"no", "not", "without"}.issubset(tokens))
        self.assertNotIn("the", tokens)
        self.assertNotIn("with", tokens)

    def test_fixture_digests_resolve_to_reviewed_sources(self) -> None:
        capture = json.loads(CAPTURE_PATH.read_text(encoding="utf-8"))
        fixture_root = CAPTURE_PATH.parent / "reviewed-ocr"

        for document in capture["documents"]:
            source = fixture_root / document["sourceName"]
            source_bytes = source.read_bytes()
            self.assertEqual(hashlib.sha256(source_bytes).hexdigest(), document["sourceSha256"])
            self.assertEqual(source.read_text(encoding="utf-8").strip(), document["text"])

    def test_analysis_preserves_review_standing_and_locator_safe_source_names(self) -> None:
        capture = json.loads(CAPTURE_PATH.read_text(encoding="utf-8"))
        capture["captureRole"] = "local_ocr_capture"
        capture["sourceClass"] = "local_image_observation"
        capture["reviewStanding"] = "requires_human_review"
        self.assertEqual(len(document_evidence._validate_capture(capture)), 4)

        capture["sourceClass"] = "realistic_synthetic"
        with self.assertRaisesRegex(
            document_evidence.EvidenceWorkflowError,
            "coherent supported capture state",
        ):
            document_evidence._validate_capture(capture)

        capture["sourceClass"] = "local_image_observation"
        capture["documents"][0]["sourceName"] = "/private/reviewed-source.txt"
        with self.assertRaisesRegex(
            document_evidence.EvidenceWorkflowError,
            "must not contain a local path",
        ):
            document_evidence._validate_capture(capture)

    def test_analysis_is_ordered_and_repeatable_in_one_environment(self) -> None:
        expected = json.loads(EXPECTED_PATH.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first = root / "first"
            second = root / "second"
            first_result = document_evidence.analyze_capture(CAPTURE_PATH, first)
            second_result = document_evidence.analyze_capture(CAPTURE_PATH, second)

            self.assertEqual(first_result, second_result)
            self.assertEqual(
                (first / "term-weights.json").read_bytes(),
                (second / "term-weights.json").read_bytes(),
            )
            self.assertEqual(
                (first / "word-cloud.png").read_bytes(),
                (second / "word-cloud.png").read_bytes(),
            )
            self.assertEqual(
                document_evidence.sha256_file(first / "term-weights.json"),
                expected["termWeightsSha256"],
            )
            self.assertEqual(
                first_result["termWeights"]["combined"][: len(expected["combinedTop"])],
                expected["combinedTop"],
            )
            self.assertEqual(first_result["termWeights"]["eras"], expected["eras"])
            self.assertEqual(first_result["termWeights"]["topN"], expected["topN"])
            self.assertEqual(
                first_result["termWeights"]["retainedNegationTerms"],
                expected["retainedNegationTerms"],
            )
            self.assertEqual(
                first_result["termWeights"]["workflowVersion"],
                expected["captureVersion"],
            )
            self.assertEqual(
                first_result["termWeights"]["ordering"],
                expected["ordering"],
            )
            self.assertEqual(
                first_result["termWeights"]["sourceReviewStanding"],
                expected["sourceReviewStanding"],
            )
            self.assertEqual(
                first_result["termWeights"]["sourceCaptureRole"],
                expected["sourceCaptureRole"],
            )
            self.assertEqual(
                first_result["termWeights"]["sourceClass"],
                expected["sourceClass"],
            )
            self.assertEqual(
                first_result["render"]["sourceReviewStanding"],
                expected["sourceReviewStanding"],
            )
            self.assertEqual(
                first_result["render"]["sourceCaptureRole"],
                expected["sourceCaptureRole"],
            )
            self.assertEqual(first_result["render"]["sourceClass"], expected["sourceClass"])
            self.assertEqual(
                {
                    "width": first_result["render"]["width"],
                    "height": first_result["render"]["height"],
                    "seed": first_result["render"]["seed"],
                },
                expected["render"],
            )
            self.assertEqual(
                first_result["render"]["sha256"],
                document_evidence.sha256_file(first / "word-cloud.png"),
            )

            for output in expected["outputs"]:
                output_path = first / output["path"]
                self.assertTrue(output_path.is_file(), output["path"])
                if output["mediaType"] == "application/json":
                    self.assertIsInstance(
                        json.loads(output_path.read_text(encoding="utf-8")),
                        dict,
                    )
                elif output["mediaType"] == "image/png":
                    self.assertTrue(output_path.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"))
                else:
                    self.fail(f"unobserved expected media type: {output['mediaType']}")

            for rows in [
                *first_result["termWeights"]["byEra"].values(),
                first_result["termWeights"]["combined"],
            ]:
                self.assertEqual(
                    rows,
                    sorted(rows, key=lambda row: (-row["weight"], row["term"])),
                )

    def test_output_authority_and_recovery_preserve_prior_state(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            unowned = root / "unowned"
            unowned.mkdir()
            (unowned / "keep.txt").write_bytes(b"keep-byte-for-byte\n")
            staged = root / "staged-for-unowned"
            staged.mkdir()
            document_evidence.write_json(
                staged / document_evidence.OUTPUT_SENTINEL,
                document_evidence._output_sentinel_record(),
            )
            (staged / "next.txt").write_bytes(b"next\n")
            before = {path.name: path.read_bytes() for path in unowned.iterdir()}

            with self.assertRaises(document_evidence.EvidenceWorkflowError):
                document_evidence._promote_staged_directory(staged, unowned, replace=True)
            self.assertEqual(
                {path.name: path.read_bytes() for path in unowned.iterdir()},
                before,
            )

            target = root / "accepted"
            target.mkdir()
            document_evidence.write_json(
                target / document_evidence.OUTPUT_SENTINEL,
                document_evidence._output_sentinel_record(),
            )
            (target / "prior.txt").write_text("prior\n", encoding="utf-8")
            replacement = root / "replacement"
            replacement.mkdir()
            document_evidence.write_json(
                replacement / document_evidence.OUTPUT_SENTINEL,
                document_evidence._output_sentinel_record(),
            )
            (replacement / "next.txt").write_text("next\n", encoding="utf-8")

            original_rename = Path.rename

            def fail_staged_promotion(path: Path, destination: Path) -> Path:
                if path == replacement:
                    raise OSError("simulated promotion failure")
                return original_rename(path, destination)

            with (
                mock.patch.object(Path, "rename", new=fail_staged_promotion),
                self.assertRaisesRegex(OSError, "simulated promotion failure"),
            ):
                document_evidence._promote_staged_directory(
                    replacement,
                    target,
                    replace=True,
                )
            self.assertTrue((target / "prior.txt").is_file())
            self.assertEqual(list(root.glob(".accepted.previous-*")), [])

            document_evidence._promote_staged_directory(replacement, target, replace=True)
            self.assertTrue((target / "next.txt").is_file())
            self.assertFalse((target / "prior.txt").exists())

            retained_target = root / "retained-backup"
            retained_target.mkdir()
            document_evidence.write_json(
                retained_target / document_evidence.OUTPUT_SENTINEL,
                document_evidence._output_sentinel_record(),
            )
            (retained_target / "prior.txt").write_text("prior\n", encoding="utf-8")
            retained_replacement = root / "retained-replacement"
            retained_replacement.mkdir()
            document_evidence.write_json(
                retained_replacement / document_evidence.OUTPUT_SENTINEL,
                document_evidence._output_sentinel_record(),
            )
            (retained_replacement / "next.txt").write_text("next\n", encoding="utf-8")

            with (
                mock.patch.object(shutil, "rmtree", side_effect=OSError("cleanup blocked")),
                self.assertWarnsRegex(RuntimeWarning, "prior output remains"),
            ):
                document_evidence._promote_staged_directory(
                    retained_replacement,
                    retained_target,
                    replace=True,
                )
            self.assertTrue((retained_target / "next.txt").is_file())
            retained_backups = list(root.glob(".retained-backup.previous-*"))
            self.assertEqual(len(retained_backups), 1)
            self.assertTrue((retained_backups[0] / "prior.txt").is_file())

    def test_collection_records_source_identity_without_local_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "synthetic page.png"
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

            with self.assertRaises(document_evidence.OutputExistsError):
                document_evidence.collect_ocr(
                    [("document", "2019", source)],
                    capture_path,
                    reader=lambda *_: self.fail("existing capture should fail before OCR"),
                )

            source.write_bytes(original_source)
            replaced = document_evidence.collect_ocr(
                [("document", "2019", source)],
                capture_path,
                reader=lambda _bytes, _name: {
                    "text": "Replacement OCR text",
                    "engineName": "fixture-reader",
                    "engineVersion": "1.0",
                    "settings": "deterministic",
                },
                replace=True,
            )
            self.assertEqual(replaced["documents"][0]["text"], "Replacement OCR text")
            self.assertEqual(list(capture_path.parent.glob(".capture.json.previous-*")), [])

            source.write_bytes(original_source)
            prior_capture = capture_path.read_bytes()
            original_rename = Path.rename

            def fail_capture_promotion(path: Path, destination: Path) -> Path:
                if path.name.startswith(".capture.json.staged-"):
                    raise OSError("simulated capture promotion failure")
                return original_rename(path, destination)

            with (
                mock.patch.object(Path, "rename", new=fail_capture_promotion),
                self.assertRaisesRegex(OSError, "simulated capture promotion failure"),
            ):
                document_evidence.collect_ocr(
                    [("document", "2019", source)],
                    capture_path,
                    reader=lambda _bytes, _name: {
                        "text": "Unpromoted OCR text",
                        "engineName": "fixture-reader",
                        "engineVersion": "1.0",
                        "settings": "deterministic",
                    },
                    replace=True,
                )
            self.assertEqual(capture_path.read_bytes(), prior_capture)
            self.assertEqual(list(capture_path.parent.glob(".capture.json.previous-*")), [])

    def test_collection_rejects_incomplete_identity_before_reading(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "source.png"
            source.write_bytes(b"source")
            reader = mock.Mock()

            with self.assertRaisesRegex(
                document_evidence.EvidenceWorkflowError,
                "id must be a non-empty string",
            ):
                document_evidence.collect_ocr(
                    [(" ", "2019", source)],
                    Path(temporary) / "capture.json",
                    reader=reader,
                )
            reader.assert_not_called()

            with self.assertRaisesRegex(
                document_evidence.EvidenceWorkflowError,
                "era must be a non-empty string",
            ):
                document_evidence.collect_ocr(
                    [("document", " ", source)],
                    Path(temporary) / "capture.json",
                    reader=reader,
                )
            reader.assert_not_called()


if __name__ == "__main__":
    unittest.main()
