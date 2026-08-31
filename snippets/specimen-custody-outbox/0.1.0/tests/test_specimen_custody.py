from __future__ import annotations

import hashlib
import json
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

SOURCE_ROOT = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SOURCE_ROOT))

import specimen_custody  # noqa: E402

FIXTURE_ROOT = Path(__file__).resolve().parents[1]
FIXTURE_PATH = FIXTURE_ROOT / "fixtures" / "transfer-command.json"
EXPECTED_PATH = FIXTURE_ROOT / "expected" / "transfer-commit.json"


def actor(
    *,
    tenant_id: str = "tenant-north",
    actor_id: str = "operator-17",
    role: str = "custody_coordinator",
) -> specimen_custody.ActorContext:
    return specimen_custody.ActorContext(
        tenant_id=tenant_id,
        actor_id=actor_id,
        role=role,
    )


def command(
    *,
    transfer_id: str = "transfer-0001",
    tenant_id: str = "tenant-north",
    specimen_id: str = "specimen-control-042",
    actor_id: str = "operator-17",
    actor_role: str = "custody_coordinator",
    reason: str = "Move the synthetic control specimen into the scheduled analysis handoff.",
    aware_at: datetime = datetime(2026, 8, 31, 14, 30, tzinfo=UTC),
    current_source: str = "cold-storage-a",
    expected_version: int = 4,
    destination: str = "analysis-bench-2",
    payload: dict[str, object] | None = None,
) -> specimen_custody.TransferCommand:
    return specimen_custody.TransferCommand.capture(
        transfer_id=transfer_id,
        tenant_id=tenant_id,
        specimen_id=specimen_id,
        actor_id=actor_id,
        actor_role=actor_role,
        reason=reason,
        aware_at=aware_at,
        current_source=current_source,
        expected_version=expected_version,
        destination=destination,
        payload=(
            {
                "carrier": "synthetic-rack-7",
                "temperatureBand": "controlled-cold",
            }
            if payload is None
            else payload
        ),
    )


def custody(
    *,
    tenant_id: str = "tenant-north",
    specimen_id: str = "specimen-control-042",
    current_source: str = "cold-storage-a",
    version: int = 4,
) -> specimen_custody.CustodyRecord:
    return specimen_custody.CustodyRecord(
        tenant_id=tenant_id,
        specimen_id=specimen_id,
        current_source=current_source,
        version=version,
    )


def repository(
    *,
    custody_records: tuple[specimen_custody.CustodyRecord, ...] | None = None,
    outbox: tuple[specimen_custody.OutboxMessage, ...] = (),
) -> specimen_custody.InMemorySpecimenCustody:
    return specimen_custody.InMemorySpecimenCustody(
        custody_records or (custody(),),
        outbox=outbox,
    )


class SpecimenCustodyTests(unittest.TestCase):
    def test_decision_comparison_metadata_is_complete_and_identity_specific(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "changed transfer meaning requires fields and both fingerprints",
        ):
            specimen_custody.TransferDecision(
                status=specimen_custody.TransferStatus.RECONCILIATION_REQUIRED,
                transfer_id="transfer-0001",
                reason=specimen_custody.ReconciliationReason.STALE_VERSION,
                recorded_fingerprint="recorded",
            )
        with self.assertRaisesRegex(
            ValueError,
            "changed transfer meaning requires fields and both fingerprints",
        ):
            specimen_custody.TransferDecision(
                status=specimen_custody.TransferStatus.RECONCILIATION_REQUIRED,
                transfer_id="transfer-0001",
                reason=specimen_custody.ReconciliationReason.TRANSFER_IDENTITY_REUSED,
                changed_fields=("payload",),
            )

    def test_fixture_matches_the_reviewed_transfer_commit(self) -> None:
        actual = specimen_custody.run_fixture(FIXTURE_PATH)
        expected = json.loads(EXPECTED_PATH.read_text(encoding="utf-8"))
        self.assertEqual(actual, expected)

    def test_new_transfer_commits_one_state_event_replay_record_and_outbox_message(
        self,
    ) -> None:
        store = repository()

        decision = store.transfer(command(), actor())

        self.assertIs(decision.status, specimen_custody.TransferStatus.APPLIED)
        self.assertIsNotNone(decision.receipt)
        snapshot = store.snapshot()
        self.assertEqual(len(snapshot.custody), 1)
        self.assertEqual(len(snapshot.events), 1)
        self.assertEqual(len(snapshot.outbox), 1)
        self.assertEqual(len(snapshot.transfers), 1)
        self.assertEqual(snapshot.custody[0].current_source, "analysis-bench-2")
        self.assertEqual(snapshot.custody[0].version, 5)
        self.assertEqual(snapshot.events[0].actor_id, "operator-17")
        self.assertEqual(snapshot.events[0].actor_role, "custody_coordinator")
        self.assertEqual(
            snapshot.events[0].command_fingerprint,
            snapshot.transfers[0].command_fingerprint,
        )
        self.assertEqual(snapshot.outbox[0].tenant_id, "tenant-north")

    def test_exact_replay_resolves_to_the_recorded_outcome(self) -> None:
        store = repository()
        accepted = store.transfer(command(), actor())
        accepted_snapshot = store.snapshot()

        replayed = store.transfer(command(), actor())

        self.assertIs(replayed.status, specimen_custody.TransferStatus.REPLAYED)
        self.assertEqual(replayed.receipt, accepted.receipt)
        self.assertEqual(store.snapshot(), accepted_snapshot)

    def test_transfer_identity_binds_every_meaning_bearing_field(self) -> None:
        mutations = (
            (
                "actorId",
                replace(command(), actor_id="operator-18"),
                actor(actor_id="operator-18"),
            ),
            ("reason", replace(command(), reason="Move for a second synthetic reason."), actor()),
            (
                "awareAt",
                replace(command(), aware_at=command().aware_at + timedelta(microseconds=1)),
                actor(),
            ),
            (
                "currentSource",
                replace(command(), current_source="cold-storage-b"),
                actor(),
            ),
            ("expectedVersion", replace(command(), expected_version=3), actor()),
            ("destination", replace(command(), destination="analysis-bench-3"), actor()),
            ("specimenId", replace(command(), specimen_id="specimen-control-043"), actor()),
            (
                "payload",
                command(payload={"carrier": "synthetic-rack-8"}),
                actor(),
            ),
        )

        for field_name, changed_command, changed_actor in mutations:
            with self.subTest(field=field_name):
                store = repository()
                store.transfer(command(), actor())
                accepted_snapshot = store.snapshot()

                decision = store.transfer(changed_command, changed_actor)

                self.assertIs(
                    decision.status,
                    specimen_custody.TransferStatus.RECONCILIATION_REQUIRED,
                )
                self.assertIs(
                    decision.reason,
                    specimen_custody.ReconciliationReason.TRANSFER_IDENTITY_REUSED,
                )
                self.assertEqual(decision.changed_fields, (field_name,))
                self.assertEqual(
                    decision.recorded_fingerprint,
                    command().fingerprint,
                )
                self.assertEqual(
                    decision.candidate_fingerprint,
                    changed_command.fingerprint,
                )
                self.assertEqual(store.snapshot(), accepted_snapshot)

    def test_capable_role_change_reuses_identity_with_changed_meaning(self) -> None:
        store = specimen_custody.InMemorySpecimenCustody(
            [custody()],
            role_capabilities={
                "custody_coordinator": frozenset({specimen_custody.TRANSFER_CAPABILITY}),
                "custody_supervisor": frozenset({specimen_custody.TRANSFER_CAPABILITY}),
            },
        )
        store.transfer(command(), actor())
        accepted_snapshot = store.snapshot()
        changed = replace(command(), actor_role="custody_supervisor")

        decision = store.transfer(changed, actor(role="custody_supervisor"))

        self.assertIs(
            decision.reason,
            specimen_custody.ReconciliationReason.TRANSFER_IDENTITY_REUSED,
        )
        self.assertEqual(decision.changed_fields, ("actorRole",))
        self.assertEqual(store.snapshot(), accepted_snapshot)

    def test_payload_comparison_uses_the_fingerprint_equivalence_relation(self) -> None:
        store = repository()
        recorded = command(payload={"measurement": 1})
        candidate = command(payload={"measurement": 1.0})
        store.transfer(recorded, actor())
        accepted_snapshot = store.snapshot()

        decision = store.transfer(candidate, actor())

        self.assertIs(
            decision.reason,
            specimen_custody.ReconciliationReason.TRANSFER_IDENTITY_REUSED,
        )
        self.assertEqual(decision.changed_fields, ("payload",))
        self.assertNotEqual(
            decision.recorded_fingerprint,
            decision.candidate_fingerprint,
        )
        self.assertEqual(store.snapshot(), accepted_snapshot)

    def test_context_capability_version_and_source_conflicts_preserve_state(self) -> None:
        cases = (
            (
                "tenant_context",
                command(),
                actor(tenant_id="tenant-south"),
                specimen_custody.ReconciliationReason.TENANT_CONTEXT_MISMATCH,
            ),
            (
                "actor_context",
                command(),
                actor(actor_id="operator-18"),
                specimen_custody.ReconciliationReason.ACTOR_CONTEXT_MISMATCH,
            ),
            (
                "capability",
                replace(command(), actor_role="laboratory_observer"),
                actor(role="laboratory_observer"),
                specimen_custody.ReconciliationReason.CAPABILITY_REQUIRED,
            ),
            (
                "version",
                replace(command(), expected_version=3),
                actor(),
                specimen_custody.ReconciliationReason.STALE_VERSION,
            ),
            (
                "source",
                replace(command(), current_source="cold-storage-b"),
                actor(),
                specimen_custody.ReconciliationReason.STALE_SOURCE,
            ),
        )

        for case_name, candidate, candidate_actor, reason in cases:
            with self.subTest(case=case_name):
                store = repository()
                accepted_snapshot = store.snapshot()

                decision = store.transfer(candidate, candidate_actor)

                self.assertIs(
                    decision.status,
                    specimen_custody.TransferStatus.RECONCILIATION_REQUIRED,
                )
                self.assertIs(decision.reason, reason)
                self.assertEqual(store.snapshot(), accepted_snapshot)

    def test_injected_outbox_write_failure_preserves_the_complete_pre_call_state(
        self,
    ) -> None:
        store = repository(
            custody_records=(
                custody(),
                custody(specimen_id="specimen-control-043"),
            )
        )
        store.transfer(command(), actor())
        accepted_snapshot = store.snapshot()
        failure = OSError("synthetic outbox write stopped")
        interrupted = command(
            transfer_id="transfer-0002",
            specimen_id="specimen-control-043",
        )

        def inject(step: specimen_custody.CommitStep) -> None:
            if step is specimen_custody.CommitStep.OUTBOX_WRITE:
                raise failure

        with self.assertRaises(OSError) as caught:
            store.transfer(interrupted, actor(), fault_injector=inject)

        self.assertIs(caught.exception, failure)
        self.assertEqual(store.snapshot(), accepted_snapshot)

        retried = store.transfer(interrupted, actor())

        self.assertIs(retried.status, specimen_custody.TransferStatus.APPLIED)
        recovered = store.snapshot()
        self.assertEqual(len(recovered.custody), 2)
        self.assertEqual(len(recovered.events), 2)
        self.assertEqual(len(recovered.outbox), 2)
        self.assertEqual(len(recovered.transfers), 2)

    def test_each_commit_step_keeps_the_accepted_snapshot_until_publication(self) -> None:
        for failed_step in specimen_custody.CommitStep:
            with self.subTest(step=failed_step):
                store = repository()
                accepted_snapshot = store.snapshot()

                def inject(
                    step: specimen_custody.CommitStep,
                    selected_step: specimen_custody.CommitStep = failed_step,
                ) -> None:
                    if step is selected_step:
                        raise OSError(f"synthetic {step} stopped")

                with self.assertRaises(OSError):
                    store.transfer(command(), actor(), fault_injector=inject)

                self.assertEqual(store.snapshot(), accepted_snapshot)

    def test_reentrant_transfer_preserves_the_complete_pre_call_state(self) -> None:
        store = repository()
        accepted_snapshot = store.snapshot()

        def reenter(step: specimen_custody.CommitStep) -> None:
            if step is specimen_custody.CommitStep.OUTBOX_WRITE:
                store.transfer(
                    command(transfer_id="transfer-nested"),
                    actor(),
                )

        with self.assertRaisesRegex(
            RuntimeError,
            "one repository instance accepts one transfer call at a time",
        ):
            store.transfer(command(), actor(), fault_injector=reenter)

        self.assertEqual(store.snapshot(), accepted_snapshot)

    def test_command_and_outbox_payloads_are_content_bound_commit_snapshots(self) -> None:
        caller_payload = {
            "carrier": "synthetic-rack-7",
            "temperatureBand": "controlled-cold",
        }
        captured = command(payload=caller_payload)
        captured_payload = captured.payload
        captured_fingerprint = captured.fingerprint
        caller_payload["carrier"] = "caller-local-change"
        store = repository()
        decision = store.transfer(captured, actor())
        message = decision.receipt.outbox
        recorded_payload = message.payload
        decoded = json.loads(recorded_payload)

        decoded["destination"] = "caller-local-change"

        self.assertEqual(captured.payload, captured_payload)
        self.assertEqual(captured.fingerprint, captured_fingerprint)
        self.assertEqual(message.payload, recorded_payload)
        self.assertEqual(
            message.content_sha256,
            hashlib.sha256(recorded_payload).hexdigest(),
        )
        self.assertEqual(json.loads(message.payload)["destination"], "analysis-bench-2")
        self.assertEqual(
            json.loads(message.payload)["payload"]["carrier"],
            "synthetic-rack-7",
        )

    def test_changed_content_at_one_outbox_identity_requests_reconciliation(self) -> None:
        changed_message = specimen_custody.OutboxMessage(
            message_id="custody-transfer:transfer-0001",
            tenant_id="tenant-north",
            topic="specimen.custody.transferred.v1",
            payload=b'{"eventType":"synthetic.changed-content"}',
        )
        store = repository(outbox=(changed_message,))
        accepted_snapshot = store.snapshot()

        decision = store.transfer(command(), actor())

        self.assertIs(
            decision.status,
            specimen_custody.TransferStatus.RECONCILIATION_REQUIRED,
        )
        self.assertIs(
            decision.reason,
            specimen_custody.ReconciliationReason.OUTBOX_CONTENT_COLLISION,
        )
        self.assertEqual(store.snapshot(), accepted_snapshot)

    def test_changed_topic_at_one_outbox_identity_requests_reconciliation(self) -> None:
        source = repository()
        applied = source.transfer(command(), actor())
        changed_topic = specimen_custody.OutboxMessage(
            message_id=applied.receipt.outbox.message_id,
            tenant_id=applied.receipt.outbox.tenant_id,
            topic="specimen.custody.rerouted.v1",
            payload=applied.receipt.outbox.payload,
        )
        store = repository(outbox=(changed_topic,))
        accepted_snapshot = store.snapshot()

        decision = store.transfer(command(), actor())

        self.assertIs(
            decision.reason,
            specimen_custody.ReconciliationReason.OUTBOX_CONTENT_COLLISION,
        )
        self.assertEqual(store.snapshot(), accepted_snapshot)

    def test_transfer_and_outbox_identities_are_tenant_scoped(self) -> None:
        store = repository(
            custody_records=(
                custody(tenant_id="tenant-north"),
                custody(tenant_id="tenant-south"),
            )
        )
        north = command(tenant_id="tenant-north")
        south = command(tenant_id="tenant-south")

        north_result = store.transfer(north, actor(tenant_id="tenant-north"))
        south_result = store.transfer(south, actor(tenant_id="tenant-south"))

        self.assertIs(north_result.status, specimen_custody.TransferStatus.APPLIED)
        self.assertIs(south_result.status, specimen_custody.TransferStatus.APPLIED)
        snapshot = store.snapshot()
        self.assertEqual(len(snapshot.transfers), 2)
        self.assertEqual(len(snapshot.outbox), 2)
        self.assertEqual(
            {(message.tenant_id, message.message_id) for message in snapshot.outbox},
            {
                ("tenant-north", "custody-transfer:transfer-0001"),
                ("tenant-south", "custody-transfer:transfer-0001"),
            },
        )

    def test_process_local_concurrency_resolves_to_one_recorded_outcome(self) -> None:
        store = repository()

        with ThreadPoolExecutor(max_workers=8) as executor:
            decisions = list(
                executor.map(
                    lambda _: store.transfer(command(), actor()),
                    range(8),
                )
            )

        self.assertEqual(
            sum(
                decision.status is specimen_custody.TransferStatus.APPLIED for decision in decisions
            ),
            1,
        )
        self.assertEqual(
            sum(
                decision.status is specimen_custody.TransferStatus.REPLAYED
                for decision in decisions
            ),
            7,
        )
        self.assertTrue(all(decision.receipt == decisions[0].receipt for decision in decisions))
        snapshot = store.snapshot()
        self.assertEqual(len(snapshot.events), 1)
        self.assertEqual(len(snapshot.outbox), 1)
        self.assertEqual(len(snapshot.transfers), 1)

    def test_competing_transfers_resolve_to_one_effect_and_one_stale_caller(self) -> None:
        store = repository()
        candidates = (
            command(transfer_id="transfer-a", destination="analysis-bench-2"),
            command(transfer_id="transfer-b", destination="analysis-bench-3"),
        )

        with ThreadPoolExecutor(max_workers=2) as executor:
            decisions = list(
                executor.map(
                    lambda candidate: store.transfer(candidate, actor()),
                    candidates,
                )
            )

        self.assertEqual(
            [decision.status for decision in decisions].count(
                specimen_custody.TransferStatus.APPLIED
            ),
            1,
        )
        stale = [
            decision
            for decision in decisions
            if decision.status is specimen_custody.TransferStatus.RECONCILIATION_REQUIRED
        ]
        self.assertEqual(len(stale), 1)
        self.assertIs(
            stale[0].reason,
            specimen_custody.ReconciliationReason.STALE_VERSION,
        )
        snapshot = store.snapshot()
        self.assertEqual(snapshot.custody[0].version, 5)
        self.assertEqual(len(snapshot.events), 1)
        self.assertEqual(len(snapshot.outbox), 1)
        self.assertEqual(len(snapshot.transfers), 1)


if __name__ == "__main__":
    unittest.main()
