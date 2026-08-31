from __future__ import annotations

import hashlib
import json
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Barrier

SOURCE_ROOT = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SOURCE_ROOT))

import instrument_ingress  # noqa: E402

ARTIFACT_ROOT = Path(__file__).resolve().parents[1]
ACCEPTED_FIXTURE = ARTIFACT_ROOT / "fixtures" / "accepted-measurement.json"
QUARANTINED_FIXTURE = ARTIFACT_ROOT / "fixtures" / "quarantined-measurement.json"
EXPECTED_PATH = ARTIFACT_ROOT / "expected" / "ingress-run.json"
NOW = datetime(2026, 8, 31, 14, 30, tzinfo=UTC)
ACCEPTED_RAW = ACCEPTED_FIXTURE.read_bytes()
QUARANTINED_RAW = QUARANTINED_FIXTURE.read_bytes()


def delivery(
    raw: bytes | bytearray | memoryview = ACCEPTED_RAW,
    *,
    tenant_id: str = "tenant-north",
    delivery_id: str = "delivery-001",
    acquisition_id: str = "acquisition-001",
    instrument_id: str = "instrument-synthetic-07",
    specimen_id: str = "specimen-control-042",
    purpose: str = "synthetic-quantity-observation",
    captured_at: datetime = NOW,
    received_at: datetime = NOW + timedelta(seconds=2),
    media_type: str = "application/json",
    vendor_message_id: str | None = "vendor-message-synthetic-042",
) -> instrument_ingress.InstrumentDelivery:
    return instrument_ingress.InstrumentDelivery.capture(
        tenant_id=tenant_id,
        delivery_id=delivery_id,
        acquisition_id=acquisition_id,
        instrument_id=instrument_id,
        specimen_id=specimen_id,
        purpose=purpose,
        captured_at=captured_at,
        received_at=received_at,
        media_type=media_type,
        raw_bytes=raw,
        vendor_message_id=vendor_message_id,
    )


class InstrumentIngressTests(unittest.TestCase):
    def test_fixture_run_matches_the_reviewed_expected_document(self) -> None:
        actual = instrument_ingress.run_fixtures(ACCEPTED_FIXTURE, QUARANTINED_FIXTURE)
        expected_bytes = EXPECTED_PATH.read_bytes()
        actual_bytes = (
            json.dumps(actual, indent=2, sort_keys=True, ensure_ascii=True) + "\n"
        ).encode("ascii")
        self.assertEqual(actual_bytes, expected_bytes)

    def test_command_capture_detaches_caller_owned_bytes(self) -> None:
        caller = bytearray(ACCEPTED_RAW)
        captured = delivery(caller)
        expected = bytes(caller)
        caller[:] = b"caller-local-change"

        repository = instrument_ingress.InstrumentIngressRepository()
        decision = repository.ingest(captured)

        self.assertEqual(decision.status, instrument_ingress.DecisionStatus.ACCEPTED)
        assert decision.receipt is not None
        self.assertEqual(decision.receipt.raw_sha256, hashlib.sha256(expected).hexdigest())
        self.assertEqual(
            repository.raw_bytes(captured.tenant_id, decision.receipt.raw_sha256),
            expected,
        )

    def test_direct_construction_and_replace_detach_caller_owned_bytes(self) -> None:
        caller = bytearray(ACCEPTED_RAW)
        direct = instrument_ingress.InstrumentDelivery(
            tenant_id=" tenant-north ",
            delivery_id="delivery-direct",
            acquisition_id="acquisition-direct",
            instrument_id="instrument-synthetic-07",
            specimen_id="specimen-control-042",
            purpose="synthetic-quantity-observation",
            captured_at=NOW,
            received_at=NOW + timedelta(seconds=2),
            media_type="application/json",
            raw_bytes=caller,
        )
        replacement_bytes = bytearray(ACCEPTED_RAW)
        replaced = replace(
            direct,
            delivery_id="delivery-replaced",
            acquisition_id="acquisition-replaced",
            raw_bytes=replacement_bytes,
        )
        caller[:] = b"changed-after-direct-construction"
        replacement_bytes[:] = b"changed-after-replace"

        self.assertEqual(direct.raw_bytes, ACCEPTED_RAW)
        self.assertEqual(replaced.raw_bytes, ACCEPTED_RAW)
        self.assertEqual(direct.tenant_id, "tenant-north")
        repository = instrument_ingress.InstrumentIngressRepository()
        repository.ingest(direct)
        repository.ingest(replaced)
        retained_digest = hashlib.sha256(ACCEPTED_RAW).hexdigest()
        self.assertEqual(repository.raw_bytes("tenant-north", retained_digest), ACCEPTED_RAW)

    def test_accepted_delivery_links_raw_and_normalized_digests(self) -> None:
        repository = instrument_ingress.InstrumentIngressRepository()
        command = delivery()

        decision = repository.ingest(command)

        self.assertEqual(decision.status, instrument_ingress.DecisionStatus.ACCEPTED)
        assert decision.receipt is not None
        snapshot = repository.snapshot()
        self.assertEqual(
            snapshot.counts(),
            {
                "rawArtifacts": 1,
                "receipts": 1,
                "acquisitions": 1,
                "accepted": 1,
                "quarantines": 0,
            },
        )
        observation = snapshot.accepted[0]
        canonical_normalized_bytes = json.dumps(
            observation.to_document(),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
            allow_nan=False,
        ).encode("ascii")
        independently_reproduced = hashlib.sha256(canonical_normalized_bytes).hexdigest()
        self.assertEqual(observation.raw_sha256, decision.receipt.raw_sha256)
        self.assertEqual(observation.normalized_sha256, independently_reproduced)
        self.assertEqual(observation.normalized_sha256, decision.receipt.normalized_sha256)
        self.assertNotEqual(observation.normalized_sha256, observation.raw_sha256)
        self.assertEqual(observation.decimal_value, "12.50")
        self.assertEqual(observation.scale, 2)
        self.assertEqual(observation.unit_system, "http://unitsofmeasure.org")

    def test_normalized_document_digest_remains_bound_to_source_bytes(self) -> None:
        first_repository = instrument_ingress.InstrumentIngressRepository()
        second_repository = instrument_ingress.InstrumentIngressRepository()
        first_repository.ingest(delivery(ACCEPTED_RAW))
        second_repository.ingest(delivery(ACCEPTED_RAW.rstrip(b"\n")))

        first = first_repository.snapshot().accepted[0]
        second = second_repository.snapshot().accepted[0]
        self.assertEqual(first.decimal_value, second.decimal_value)
        self.assertEqual(first.unit_code, second.unit_code)
        self.assertNotEqual(first.raw_sha256, second.raw_sha256)
        self.assertNotEqual(first.normalized_sha256, second.normalized_sha256)

    def test_exact_accepted_and_quarantined_replays_reuse_recorded_receipts(self) -> None:
        parse_calls = 0

        def counting_parser(raw: bytes):
            nonlocal parse_calls
            parse_calls += 1
            return instrument_ingress.parse_measurement(raw)

        repository = instrument_ingress.InstrumentIngressRepository(
            parser=counting_parser,
            parser_contract="counting-strict-json-measurement/test",
        )
        accepted_command = delivery()
        quarantined_command = delivery(
            QUARANTINED_RAW,
            delivery_id="delivery-002",
            acquisition_id="acquisition-002",
        )
        accepted = repository.ingest(accepted_command)
        quarantined = repository.ingest(quarantined_command)
        accepted_snapshot = repository.snapshot()

        accepted_replay = repository.ingest(accepted_command)
        quarantined_replay = repository.ingest(quarantined_command)

        self.assertEqual(parse_calls, 2)
        self.assertEqual(accepted_replay.status, instrument_ingress.DecisionStatus.REPLAYED)
        self.assertEqual(quarantined_replay.status, instrument_ingress.DecisionStatus.REPLAYED)
        self.assertIs(accepted_replay.receipt, accepted.receipt)
        self.assertIs(quarantined_replay.receipt, quarantined.receipt)
        self.assertEqual(repository.snapshot(), accepted_snapshot)

    def test_second_delivery_for_one_acquisition_records_one_duplicate_receipt(self) -> None:
        repository = instrument_ingress.InstrumentIngressRepository()
        first = delivery()
        second = delivery(
            delivery_id="delivery-002",
            received_at=NOW + timedelta(seconds=5),
        )

        accepted = repository.ingest(first)
        duplicate = repository.ingest(second)

        self.assertEqual(accepted.status, instrument_ingress.DecisionStatus.ACCEPTED)
        self.assertEqual(
            duplicate.status,
            instrument_ingress.DecisionStatus.DUPLICATE_DELIVERY,
        )
        assert duplicate.receipt is not None
        self.assertEqual(duplicate.receipt.canonical_delivery_id, first.delivery_id)
        self.assertEqual(
            repository.snapshot().counts(),
            {
                "rawArtifacts": 1,
                "receipts": 2,
                "acquisitions": 1,
                "accepted": 1,
                "quarantines": 0,
            },
        )

    def test_equal_raw_bytes_can_represent_distinct_acquisitions(self) -> None:
        repository = instrument_ingress.InstrumentIngressRepository()

        repository.ingest(delivery())
        repository.ingest(
            delivery(
                delivery_id="delivery-002",
                acquisition_id="acquisition-002",
                captured_at=NOW + timedelta(minutes=1),
                received_at=NOW + timedelta(minutes=1, seconds=2),
            )
        )

        snapshot = repository.snapshot()
        self.assertEqual(len(snapshot.raw_artifacts), 1)
        self.assertEqual(len(snapshot.acquisitions), 2)
        self.assertEqual(len(snapshot.accepted), 2)

    def test_delivery_identity_change_returns_comparison_and_preserves_state(self) -> None:
        repository = instrument_ingress.InstrumentIngressRepository()
        command = delivery()
        repository.ingest(command)
        accepted_snapshot = repository.snapshot()
        changed = replace(command, received_at=command.received_at + timedelta(seconds=1))

        decision = repository.ingest(changed)

        self.assertEqual(
            decision.status,
            instrument_ingress.DecisionStatus.RECONCILIATION_REQUIRED,
        )
        self.assertEqual(decision.reason_code, "delivery_identity_reused")
        self.assertEqual(decision.changed_fields, ("receivedAt",))
        self.assertNotEqual(decision.recorded_fingerprint, decision.candidate_fingerprint)
        self.assertEqual(repository.snapshot(), accepted_snapshot)

    def test_acquisition_identity_change_retains_conflict_quarantine_evidence(self) -> None:
        repository = instrument_ingress.InstrumentIngressRepository()
        command = delivery()
        repository.ingest(command)
        accepted = repository.snapshot().accepted[0]
        changed = delivery(
            b'{"analyte":"synthetic-dna","value":"13.00","unit":"ng/uL"}\n',
            delivery_id="delivery-002",
            received_at=NOW + timedelta(seconds=5),
        )

        decision = repository.ingest(changed)

        self.assertEqual(decision.status, instrument_ingress.DecisionStatus.QUARANTINED)
        assert decision.receipt is not None
        self.assertEqual(decision.receipt.reason_code, "acquisition_identity_reused")
        snapshot = repository.snapshot()
        self.assertEqual(snapshot.accepted, (accepted,))
        self.assertEqual(len(snapshot.acquisitions), 1)
        self.assertEqual(len(snapshot.raw_artifacts), 2)
        self.assertEqual(len(snapshot.quarantines), 1)
        self.assertIn("rawSha256", snapshot.quarantines[0].details)
        self.assertEqual(
            repository.raw_bytes(changed.tenant_id, decision.receipt.raw_sha256),
            changed.raw_bytes,
        )

    def test_strict_intake_parse_and_mapping_routes_are_typed(self) -> None:
        examples = (
            (b"{broken", "malformed_json"),
            (b'{"analyte":"A","value":"1","value":"2","unit":"ng/uL"}', "duplicate_json_member"),
            (b'{"analyte":"A","value":NaN,"unit":"ng/uL"}', "nonfinite_json_number"),
            (b'{"analyte":"A","value":true,"unit":"ng/uL"}', "quantity_requires_mapping"),
            (b'{"analyte":"A","value":{"n":1},"unit":"ng/uL"}', "quantity_requires_mapping"),
            (b'{"analyte":"A","value":"1","unit":"ng/uL","flag":true}', "unreleased_fields"),
            (b'{"analyte":"A","value":"1"}', "missing_required_fields"),
            (b'{"analyte":"A","value":"1","unit":"mystery"}', "unsupported_unit"),
            (
                b'{"analyte":"A","value":"0.0000000000000000001","unit":"ng/uL"}',
                "quantity_precision_exceeded",
            ),
        )
        for index, (raw, reason_code) in enumerate(examples, start=1):
            with self.subTest(reason_code=reason_code):
                repository = instrument_ingress.InstrumentIngressRepository()
                decision = repository.ingest(
                    delivery(
                        raw,
                        delivery_id=f"delivery-{index}",
                        acquisition_id=f"acquisition-{index}",
                    )
                )
                self.assertEqual(decision.status, instrument_ingress.DecisionStatus.QUARANTINED)
                assert decision.receipt is not None
                self.assertEqual(decision.receipt.reason_code, reason_code)
                self.assertIsNone(decision.receipt.normalized_sha256)
                self.assertTrue(decision.receipt.recovery)
                self.assertEqual(len(repository.snapshot().quarantines), 1)

        intake_examples = (
            (
                delivery(media_type="text/csv"),
                "unsupported_media_type",
            ),
            (
                delivery(b"x" * (instrument_ingress.MAX_PAYLOAD_BYTES + 1)),
                "payload_limit_exceeded",
            ),
        )
        for command, reason_code in intake_examples:
            with self.subTest(reason_code=reason_code):
                repository = instrument_ingress.InstrumentIngressRepository()
                decision = repository.ingest(command)
                assert decision.receipt is not None
                self.assertEqual(decision.receipt.reason_code, reason_code)
                self.assertEqual(repository.snapshot().quarantines[0].stage, "intake")

    def test_unexpected_parser_and_mapper_faults_propagate_with_state_unchanged(self) -> None:
        parser_failure = RuntimeError("synthetic parser implementation fault")
        mapper_failure = RuntimeError("synthetic mapper implementation fault")

        def failing_parser(raw: bytes):
            raise parser_failure

        def failing_mapper(command, parsed, raw_digest):
            raise mapper_failure

        parser_repository = instrument_ingress.InstrumentIngressRepository(
            parser=failing_parser,
            parser_contract="failing-parser/test",
        )
        mapper_repository = instrument_ingress.InstrumentIngressRepository(
            mapper=failing_mapper,
            mapper_contract="failing-mapper/test",
        )

        with self.assertRaises(RuntimeError) as parser_caught:
            parser_repository.ingest(delivery())
        with self.assertRaises(RuntimeError) as mapper_caught:
            mapper_repository.ingest(delivery())

        self.assertIs(parser_caught.exception, parser_failure)
        self.assertIs(mapper_caught.exception, mapper_failure)
        self.assertEqual(parser_repository.snapshot().counts()["receipts"], 0)
        self.assertEqual(mapper_repository.snapshot().counts()["receipts"], 0)

    def test_each_detached_commit_step_preserves_state_until_publication(self) -> None:
        for selected_step in instrument_ingress.CommitStep:
            with self.subTest(step=selected_step):
                repository = instrument_ingress.InstrumentIngressRepository()
                repository.ingest(delivery())
                accepted_snapshot = repository.snapshot()
                candidate = delivery(
                    delivery_id=f"delivery-{selected_step}",
                    acquisition_id=f"acquisition-{selected_step}",
                    captured_at=NOW + timedelta(minutes=1),
                    received_at=NOW + timedelta(minutes=1, seconds=2),
                )

                def inject(step, selected=selected_step):
                    if step is selected:
                        raise OSError(f"synthetic {step} interruption")

                with self.assertRaises(OSError):
                    repository.ingest(candidate, fault_injector=inject)

                self.assertEqual(repository.snapshot(), accepted_snapshot)
                retry = repository.ingest(candidate)
                self.assertEqual(retry.status, instrument_ingress.DecisionStatus.ACCEPTED)

    def test_reentrant_commit_attempt_preserves_the_pre_call_snapshot(self) -> None:
        repository = instrument_ingress.InstrumentIngressRepository()
        repository.ingest(delivery())
        accepted_snapshot = repository.snapshot()

        def reenter(step):
            if step is instrument_ingress.CommitStep.OUTCOME:
                repository.ingest(
                    delivery(
                        delivery_id="delivery-nested",
                        acquisition_id="acquisition-nested",
                    )
                )

        with self.assertRaisesRegex(RuntimeError, "publishes one ingress commit"):
            repository.ingest(
                delivery(
                    delivery_id="delivery-outer",
                    acquisition_id="acquisition-outer",
                    captured_at=NOW + timedelta(minutes=1),
                    received_at=NOW + timedelta(minutes=1, seconds=2),
                ),
                fault_injector=reenter,
            )

        self.assertEqual(repository.snapshot(), accepted_snapshot)

    def test_concurrent_exact_deliveries_converge_on_one_outcome(self) -> None:
        overlap = Barrier(8)

        def coordinated_parser(raw: bytes):
            overlap.wait(timeout=5)
            return instrument_ingress.parse_measurement(raw)

        repository = instrument_ingress.InstrumentIngressRepository(
            parser=coordinated_parser,
            parser_contract="coordinated-strict-json-measurement/test",
        )
        command = delivery()

        with ThreadPoolExecutor(max_workers=8) as pool:
            decisions = list(pool.map(repository.ingest, [command] * 8))

        statuses = [decision.status for decision in decisions]
        self.assertEqual(statuses.count(instrument_ingress.DecisionStatus.ACCEPTED), 1)
        self.assertEqual(statuses.count(instrument_ingress.DecisionStatus.REPLAYED), 7)
        self.assertEqual(repository.snapshot().counts()["acquisitions"], 1)

    def test_concurrent_distinct_deliveries_converge_on_one_acquisition(self) -> None:
        overlap = Barrier(2)

        def coordinated_parser(raw: bytes):
            overlap.wait(timeout=5)
            return instrument_ingress.parse_measurement(raw)

        repository = instrument_ingress.InstrumentIngressRepository(
            parser=coordinated_parser,
            parser_contract="coordinated-strict-json-measurement/test",
        )
        commands = (
            delivery(delivery_id="delivery-a"),
            delivery(
                delivery_id="delivery-b",
                received_at=NOW + timedelta(seconds=5),
            ),
        )

        with ThreadPoolExecutor(max_workers=2) as pool:
            decisions = list(pool.map(repository.ingest, commands))

        statuses = {decision.status for decision in decisions}
        self.assertEqual(
            statuses,
            {
                instrument_ingress.DecisionStatus.ACCEPTED,
                instrument_ingress.DecisionStatus.DUPLICATE_DELIVERY,
            },
        )
        snapshot = repository.snapshot()
        self.assertEqual(len(snapshot.receipts), 2)
        self.assertEqual(len(snapshot.acquisitions), 1)
        self.assertEqual(len(snapshot.accepted), 1)

    def test_custom_pipeline_contracts_are_explicit_and_lineage_is_preserved(self) -> None:
        with self.assertRaisesRegex(ValueError, "custom parser requires"):
            instrument_ingress.InstrumentIngressRepository(
                parser=lambda raw: instrument_ingress.parse_measurement(raw)
            )
        with self.assertRaisesRegex(ValueError, "custom mapper requires"):
            instrument_ingress.InstrumentIngressRepository(
                mapper=lambda command, parsed, raw_digest: instrument_ingress.map_measurement(
                    command, parsed, raw_digest
                )
            )

        def identified_parser(raw: bytes):
            return instrument_ingress.parse_measurement(raw)

        def identified_mapper(command, parsed, raw_digest):
            return instrument_ingress.map_measurement(command, parsed, raw_digest)

        repository = instrument_ingress.InstrumentIngressRepository(
            parser=identified_parser,
            mapper=identified_mapper,
            parser_contract="identified-parser/test",
            mapper_contract="identified-mapper/test",
        )
        decision = repository.ingest(delivery())
        assert decision.receipt is not None
        observation = repository.snapshot().accepted[0]
        self.assertEqual(
            decision.receipt.to_document()["pipeline"],
            {"parser": "identified-parser/test", "mapper": "identified-mapper/test"},
        )
        self.assertEqual(
            observation.to_document()["pipeline"],
            {"parser": "identified-parser/test", "mapper": "identified-mapper/test"},
        )
        quarantined = repository.ingest(
            delivery(
                b"{broken",
                delivery_id="delivery-quarantined",
                acquisition_id="acquisition-quarantined",
            )
        )
        assert quarantined.receipt is not None
        self.assertEqual(
            quarantined.receipt.to_document()["pipeline"],
            {"parser": "identified-parser/test", "mapper": "identified-mapper/test"},
        )
        self.assertEqual(
            repository.snapshot().quarantines[0].to_document()["pipeline"],
            {"parser": "identified-parser/test", "mapper": "identified-mapper/test"},
        )

        def changed_lineage_mapper(command, parsed, raw_digest):
            mapped = instrument_ingress.map_measurement(command, parsed, raw_digest)
            assert isinstance(mapped, instrument_ingress.NormalizedObservation)
            return replace(mapped, specimen_id="another-specimen")

        invalid_repository = instrument_ingress.InstrumentIngressRepository(
            mapper=changed_lineage_mapper,
            mapper_contract="changed-lineage-mapper/test",
        )
        with self.assertRaisesRegex(ValueError, "specimen_id"):
            invalid_repository.ingest(delivery())
        self.assertEqual(invalid_repository.snapshot().counts()["receipts"], 0)

        invalid_shape_repository = instrument_ingress.InstrumentIngressRepository(
            mapper=lambda command, parsed, raw_digest: object(),
            mapper_contract="invalid-shape-mapper/test",
        )
        with self.assertRaisesRegex(TypeError, "NormalizedObservation"):
            invalid_shape_repository.ingest(delivery())
        self.assertEqual(invalid_shape_repository.snapshot().counts()["receipts"], 0)

    def test_settled_quarantine_recovery_names_new_delivery_and_acquisition(self) -> None:
        repository = instrument_ingress.InstrumentIngressRepository()
        rejected = repository.ingest(delivery(b"{broken"))
        assert rejected.receipt is not None
        self.assertIn("new delivery and acquisition identities", rejected.receipt.recovery)

        corrected = repository.ingest(
            delivery(
                delivery_id="delivery-corrected",
                acquisition_id="acquisition-corrected",
            )
        )
        self.assertEqual(corrected.status, instrument_ingress.DecisionStatus.ACCEPTED)

    def test_injected_digest_collision_is_typed_and_preserves_state(self) -> None:
        repository = instrument_ingress.InstrumentIngressRepository(raw_digest=lambda raw: "0" * 64)
        repository.ingest(delivery())
        accepted_snapshot = repository.snapshot()

        collision = repository.ingest(
            delivery(
                QUARANTINED_RAW,
                delivery_id="delivery-002",
                acquisition_id="acquisition-002",
            )
        )

        self.assertEqual(
            collision.status,
            instrument_ingress.DecisionStatus.RECONCILIATION_REQUIRED,
        )
        self.assertEqual(collision.reason_code, "raw_digest_collision")
        self.assertEqual(collision.changed_fields, ("rawBytes",))
        self.assertNotEqual(
            collision.recorded_fingerprint,
            collision.candidate_fingerprint,
        )
        self.assertEqual(repository.snapshot(), accepted_snapshot)

    def test_equal_ids_and_bytes_remain_tenant_scoped(self) -> None:
        repository = instrument_ingress.InstrumentIngressRepository()

        first = repository.ingest(delivery(tenant_id="tenant-north"))
        second = repository.ingest(delivery(tenant_id="tenant-south"))

        self.assertEqual(first.status, instrument_ingress.DecisionStatus.ACCEPTED)
        self.assertEqual(second.status, instrument_ingress.DecisionStatus.ACCEPTED)
        snapshot = repository.snapshot()
        self.assertEqual(len(snapshot.raw_artifacts), 2)
        self.assertEqual(len(snapshot.acquisitions), 2)

    def test_new_repository_makes_the_process_local_boundary_explicit(self) -> None:
        first = instrument_ingress.InstrumentIngressRepository()
        first.ingest(delivery())

        restarted = instrument_ingress.InstrumentIngressRepository()

        self.assertEqual(
            restarted.snapshot().counts(),
            {
                "rawArtifacts": 0,
                "receipts": 0,
                "acquisitions": 0,
                "accepted": 0,
                "quarantines": 0,
            },
        )


if __name__ == "__main__":
    unittest.main()
