from __future__ import annotations

import hashlib
import json
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Barrier

SOURCE_ROOT = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SOURCE_ROOT))

import migration_cutover  # noqa: E402

ARTIFACT_ROOT = Path(__file__).resolve().parents[1]
RECONCILED_FIXTURE = ARTIFACT_ROOT / "fixtures" / "reconciled-cutover.json"
RETURNED_FIXTURE = ARTIFACT_ROOT / "fixtures" / "returned-for-evidence.json"
EXPECTED_PATH = ARTIFACT_ROOT / "expected" / "cutover-evaluation.json"
ARTIFACT_A = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
ARTIFACT_B = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
NOW = datetime(2026, 8, 31, 14, 30, tzinfo=UTC)


def independent_digest(value: object) -> str:
    canonical = json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
        allow_nan=False,
    ).encode("ascii")
    return hashlib.sha256(canonical).hexdigest()


def baseline_records() -> tuple[migration_cutover.MigrationRecord, ...]:
    return (
        migration_cutover.MigrationRecord(
            tenant_id="tenant-north",
            canonical_identity="specimen:control-042",
            revision=7,
            payload={
                "status": "released",
                "measurement": {"value": "7.40", "unit": "pH"},
                "tags": ["quality-control", "release"],
            },
            artifact_sha256=ARTIFACT_A,
        ),
        migration_cutover.MigrationRecord(
            tenant_id="tenant-north",
            canonical_identity="sample:synthetic-200",
            revision=3,
            payload={
                "status": "reviewed",
                "assay": "synthetic-panel-a",
                "replicates": ["replicate-1", "replicate-2"],
            },
            artifact_sha256=ARTIFACT_B,
        ),
        migration_cutover.MigrationRecord(
            tenant_id="tenant-south",
            canonical_identity="batch:synthetic-bx-42",
            revision=12,
            payload={
                "status": "approved",
                "lineage": {
                    "source": "synthetic-import-04",
                    "method": "bounded-reconciliation",
                },
            },
            artifact_sha256=ARTIFACT_A,
        ),
    )


def generation(
    generation_id: str,
    records: tuple[migration_cutover.MigrationRecord, ...] | None = None,
) -> migration_cutover.MigrationGeneration:
    return migration_cutover.MigrationGeneration(
        generation_id=generation_id,
        records=baseline_records() if records is None else records,
    )


def restore_observation(
    source: migration_cutover.MigrationGeneration,
    *,
    distinct_witness: bool = True,
) -> migration_cutover.RestoreEvidence:
    restored = migration_cutover.MigrationGeneration(
        generation_id=f"restore-of-{source.generation_id}",
        records=source.records,
    )
    return migration_cutover.RestoreEvidence.observe(
        restore_id=f"restore-observation-for-{source.generation_id}",
        source=source,
        restored=restored,
        observed_rto_seconds=184.5,
        observed_rpo_seconds=0.0,
        rto_objective_seconds=300.0,
        rpo_objective_seconds=0.0,
        operator_id="recovery-operator-03",
        witness_id=("recovery-witness-11" if distinct_witness else "recovery-operator-03"),
        completed_at=NOW - timedelta(minutes=20),
    )


@dataclass
class ManualClock:
    now: datetime

    def __call__(self) -> datetime:
        return self.now


@dataclass(frozen=True)
class PreparedCutover:
    coordinator: migration_cutover.MigrationCoordinator
    clock: ManualClock
    active: migration_cutover.MigrationGeneration
    candidate: migration_cutover.MigrationGeneration
    restore: migration_cutover.RestoreEvidence
    plan: migration_cutover.CutoverPlan
    approval: migration_cutover.CutoverApproval


def prepare_cutover(
    *,
    coordinator: migration_cutover.MigrationCoordinator | None = None,
    candidate_id: str = "candidate-generation-018",
    request_id: str = "cutover-request-018",
    approval_id: str = "cutover-approval-018",
    actor_id: str = "migration-operator-07",
    distinct_witness: bool = True,
    entry_probe: migration_cutover.EntryProbe | None = None,
    commit_probe: migration_cutover.CommitProbe | None = None,
    post_publication_probe: migration_cutover.PostPublicationProbe | None = None,
    clock: ManualClock | None = None,
) -> PreparedCutover:
    clock = clock or ManualClock(NOW + timedelta(minutes=2))
    if coordinator is None:
        arguments: dict[str, object] = {
            "migration_id": "lims-cutover-synthetic-001",
            "active_generation": generation("accepted-generation-017"),
            "clock": clock,
        }
        if entry_probe is not None:
            arguments["entry_probe"] = entry_probe
        if commit_probe is not None:
            arguments["commit_probe"] = commit_probe
        if post_publication_probe is not None:
            arguments["post_publication_probe"] = post_publication_probe
        coordinator = migration_cutover.MigrationCoordinator(**arguments)  # type: ignore[arg-type]
    active = coordinator.snapshot().active_generation
    candidate = generation(candidate_id)
    coordinator.stage_candidate(
        candidate,
        expected_state_epoch=coordinator.snapshot().state_epoch,
    )
    restore = restore_observation(active, distinct_witness=distinct_witness)
    plan = coordinator.prepare_cutover(
        request_id=request_id,
        approval_id=approval_id,
        actor_id=actor_id,
        restore_evidence=restore,
        requested_at=NOW,
    )
    approval = migration_cutover.CutoverApproval.for_request(
        plan.request,
        approved_by="accountable-reviewer-05",
        approved_at=NOW + timedelta(minutes=1),
        expires_at=NOW + timedelta(minutes=10),
    )
    return PreparedCutover(coordinator, clock, active, candidate, restore, plan, approval)


class SyntheticCommitFault(OSError):
    pass


class MigrationCutoverTests(unittest.TestCase):
    def test_fixture_run_matches_the_reviewed_expected_document_byte_for_byte(self) -> None:
        actual = migration_cutover.run_fixture(RECONCILED_FIXTURE, RETURNED_FIXTURE)
        actual_bytes = (
            json.dumps(actual, indent=2, sort_keys=True, ensure_ascii=True) + "\n"
        ).encode("ascii")

        self.assertEqual(actual_bytes, EXPECTED_PATH.read_bytes())

        reconciliation = dict(actual["reconciliation"])
        report_sha256 = reconciliation.pop("reportSha256")
        restore = dict(actual["restore"])
        evidence_sha256 = restore.pop("evidenceSha256")
        request = dict(actual["request"])
        request_fingerprint = request.pop("requestFingerprint")
        approval = dict(actual["approval"])
        approval_fingerprint = approval.pop("approvalFingerprint")
        receipt = actual["activation"]["receipt"]
        event = actual["event"]

        self.assertEqual(independent_digest(reconciliation), report_sha256)
        self.assertEqual(independent_digest(restore), evidence_sha256)
        self.assertEqual(independent_digest(request), request_fingerprint)
        self.assertEqual(independent_digest(approval), approval_fingerprint)
        self.assertEqual(independent_digest(receipt), event["receiptSha256"])
        self.assertEqual(receipt["eventId"], event["eventId"])

        returned = actual["returnedForEvidence"]
        self.assertEqual(
            returned["state"]["activeGeneration"]["id"],
            "accepted-generation-017",
        )
        self.assertEqual(
            returned["state"]["candidateGeneration"]["id"],
            "candidate-generation-019",
        )
        self.assertEqual(
            returned["state"]["counts"],
            {
                "approvalConsumptions": 0,
                "approvals": 0,
                "events": 0,
                "receipts": 0,
                "requests": 0,
            },
        )

    def test_records_snapshot_nested_input_and_use_an_independent_digest_oracle(self) -> None:
        caller_payload = {
            "status": "reviewed",
            "measurements": [{"name": "synthetic-analyte", "value": "12.50"}],
            "flags": {"requiresReview": False},
        }
        record = migration_cutover.MigrationRecord(
            tenant_id="tenant-north",
            canonical_identity="sample:synthetic-900",
            revision=2,
            payload=caller_payload,
            artifact_sha256=ARTIFACT_A,
        )
        caller_records = [record]
        captured = migration_cutover.MigrationGeneration(
            generation_id="captured-generation",
            records=caller_records,  # type: ignore[arg-type]
        )
        expected_record = {
            "tenantId": "tenant-north",
            "canonicalIdentity": "sample:synthetic-900",
            "revision": 2,
            "payload": {
                "status": "reviewed",
                "measurements": [{"name": "synthetic-analyte", "value": "12.50"}],
                "flags": {"requiresReview": False},
            },
            "artifactSha256": ARTIFACT_A,
        }
        expected_record_digest = independent_digest(expected_record)
        expected_generation_digest = independent_digest({"records": [expected_record]})

        caller_payload["status"] = "caller-local-change"
        caller_payload["measurements"][0]["value"] = "999.00"  # type: ignore[index]
        caller_records.clear()

        self.assertEqual(record.to_document(), expected_record)
        self.assertEqual(record.semantic_sha256, expected_record_digest)
        self.assertEqual(captured.generation_sha256, expected_generation_digest)
        self.assertEqual(len(captured.records), 1)
        with self.assertRaises(TypeError):
            record.payload["status"] = "mutated-through-record"  # type: ignore[index]

    def test_nested_json_object_keys_require_text_before_canonicalization(self) -> None:
        with self.assertRaisesRegex(ValueError, "object keys require text"):
            migration_cutover.MigrationRecord(
                tenant_id="tenant-north",
                canonical_identity="sample:non-text-key",
                revision=1,
                payload={"nested": {7: "would-canonicalize-as-text"}},  # type: ignore[dict-item]
            )

    def test_identity_text_preserves_canonical_distinctions(self) -> None:
        for field_name, values in (
            ("tenant_id", {"tenant_id": " tenant-north"}),
            ("canonical_identity", {"canonical_identity": "sample-7 "}),
        ):
            with self.subTest(field=field_name):
                arguments = {
                    "tenant_id": "tenant-north",
                    "canonical_identity": "sample-7",
                    "revision": 1,
                    "payload": {"status": "accepted"},
                    **values,
                }
                with self.assertRaisesRegex(ValueError, "without surrounding whitespace"):
                    migration_cutover.MigrationRecord(**arguments)  # type: ignore[arg-type]

        with self.assertRaisesRegex(ValueError, "active_generation"):
            migration_cutover.MigrationCoordinator(
                migration_id="migration-invalid-active",
                active_generation=object(),  # type: ignore[arg-type]
            )

    def test_candidate_staging_uses_epoch_compare_and_set_and_exact_replay(self) -> None:
        coordinator = migration_cutover.MigrationCoordinator(
            migration_id="migration-stage-cas",
            active_generation=generation("active-stage-cas"),
            clock=ManualClock(NOW + timedelta(minutes=2)),
        )
        candidate = generation("candidate-stage-cas")
        initial = coordinator.snapshot()

        with self.assertRaises(migration_cutover.CandidateRoleConflict):
            coordinator.stage_candidate(
                initial.active_generation,
                expected_state_epoch=initial.state_epoch,
            )
        self.assertIs(coordinator.snapshot(), initial)

        self.assertEqual(
            coordinator.stage_candidate(candidate, expected_state_epoch=0),
            1,
        )
        staged = coordinator.snapshot()
        self.assertEqual(
            coordinator.stage_candidate(candidate, expected_state_epoch=0),
            1,
        )
        self.assertEqual(
            coordinator.stage_candidate(candidate, expected_state_epoch=1),
            1,
        )
        self.assertIs(coordinator.snapshot(), staged)

        with self.assertRaises(migration_cutover.StaleCandidateStage):
            coordinator.stage_candidate(
                generation("candidate-from-stale-read"),
                expected_state_epoch=0,
            )
        self.assertIs(coordinator.snapshot(), staged)

        changed_records = list(baseline_records())
        changed_records[0] = replace(
            changed_records[0],
            revision=changed_records[0].revision + 1,
            payload=changed_records[0].decoded_payload(),
        )
        identity_conflict = generation(
            candidate.generation_id,
            tuple(changed_records),
        )
        with self.assertRaises(migration_cutover.CandidateIdentityConflict):
            coordinator.stage_candidate(identity_conflict, expected_state_epoch=1)
        self.assertIs(coordinator.snapshot(), staged)

        replacement = generation("candidate-from-current-read")
        self.assertEqual(
            coordinator.stage_candidate(replacement, expected_state_epoch=1),
            2,
        )
        replaced = coordinator.snapshot()
        self.assertEqual(replaced.candidate_generation, replacement)
        with self.assertRaises(migration_cutover.CandidateIdentityConflict):
            coordinator.stage_candidate(identity_conflict, expected_state_epoch=2)
        self.assertIs(coordinator.snapshot(), replaced)

        self.assertEqual(
            coordinator.stage_candidate(candidate, expected_state_epoch=2),
            3,
        )
        self.assertEqual(
            dict(coordinator.snapshot().generation_digests),
            {
                "active-stage-cas": generation("active-stage-cas").generation_sha256,
                candidate.generation_id: candidate.generation_sha256,
                replacement.generation_id: replacement.generation_sha256,
            },
        )

    def test_retained_generations_keep_their_roles_after_cutover(self) -> None:
        prepared = prepare_cutover(
            request_id="request-retained-generation-roles",
            approval_id="approval-retained-generation-roles",
        )
        activated = prepared.coordinator.cutover(prepared.plan, prepared.approval)
        committed = prepared.coordinator.snapshot()
        self.assertIs(activated.status, migration_cutover.CutoverStatus.ACTIVATED)
        self.assertEqual(
            dict(committed.generation_digests),
            {
                prepared.active.generation_id: prepared.active.generation_sha256,
                prepared.candidate.generation_id: prepared.candidate.generation_sha256,
            },
        )

        for retained in (prepared.active, prepared.candidate):
            with self.subTest(generation=retained.generation_id):
                with self.assertRaises(migration_cutover.CandidateRoleConflict):
                    prepared.coordinator.stage_candidate(
                        retained,
                        expected_state_epoch=committed.state_epoch,
                    )
                self.assertIs(prepared.coordinator.snapshot(), committed)

    def test_reconciliation_reports_a_complete_partition_and_readiness(self) -> None:
        source = generation("accepted-generation")
        source_records = {record.canonical_identity: record for record in source.records}
        divergent = replace(
            source_records["sample:synthetic-200"],
            revision=4,
            payload={
                "status": "amended",
                "assay": "synthetic-panel-a",
                "replicates": ["replicate-1", "replicate-2"],
            },
        )
        extra = migration_cutover.MigrationRecord(
            tenant_id="tenant-south",
            canonical_identity="batch:synthetic-bx-99",
            revision=1,
            payload={"status": "review-pending"},
            artifact_sha256=ARTIFACT_B,
        )
        candidate = generation(
            "candidate-with-differences",
            (source_records["specimen:control-042"], divergent, extra),
        )

        report = migration_cutover.reconcile_generations(
            migration_id="migration-partition",
            state_epoch=9,
            active_generation=source,
            source_generation=source,
            candidate_generation=candidate,
        )

        self.assertEqual(
            report.matching_identities,
            (("tenant-north", "specimen:control-042"),),
        )
        self.assertEqual(
            report.divergent_identities,
            (("tenant-north", "sample:synthetic-200"),),
        )
        self.assertEqual(
            report.missing_identities,
            (("tenant-south", "batch:synthetic-bx-42"),),
        )
        self.assertEqual(
            report.extra_identities,
            (("tenant-south", "batch:synthetic-bx-99"),),
        )
        self.assertFalse(report.ready_for_approval)
        self.assertIs(
            report.phase,
            migration_cutover.ReconciliationPhase.RECONCILIATION_REQUIRED,
        )

        ready = migration_cutover.reconcile_generations(
            migration_id="migration-ready",
            state_epoch=10,
            active_generation=source,
            source_generation=source,
            candidate_generation=generation("candidate-ready"),
        )
        self.assertTrue(ready.ready_for_approval)
        self.assertIs(ready.phase, migration_cutover.ReconciliationPhase.READY_FOR_APPROVAL)
        self.assertEqual(len(ready.matching_identities), len(source.records))

    def test_reconciliation_identity_coordinates_remain_unambiguous(self) -> None:
        first = migration_cutover.MigrationRecord(
            tenant_id="tenant:region",
            canonical_identity="sample-7",
            revision=1,
            payload={"status": "accepted"},
        )
        second = migration_cutover.MigrationRecord(
            tenant_id="tenant",
            canonical_identity="region:sample-7",
            revision=1,
            payload={"status": "accepted"},
        )
        source = generation("source-with-colons", (first, second))
        candidate = generation("candidate-with-one-coordinate", (first,))

        report = migration_cutover.reconcile_generations(
            migration_id="migration-coordinate-encoding",
            state_epoch=1,
            active_generation=source,
            source_generation=source,
            candidate_generation=candidate,
        )

        self.assertNotEqual(report.matching_identities[0], report.missing_identities[0])
        partition = report.to_document()["partition"]
        assert isinstance(partition, dict)
        self.assertEqual(
            partition["matching"],
            [{"tenantId": "tenant:region", "canonicalIdentity": "sample-7"}],
        )
        self.assertEqual(
            partition["missing"],
            [{"tenantId": "tenant", "canonicalIdentity": "region:sample-7"}],
        )

    def test_cutover_plan_and_approval_bind_every_meaning_bearing_coordinate(self) -> None:
        prepared = prepare_cutover()
        with self.assertRaisesRegex(ValueError, "candidate_generation_sha256"):
            migration_cutover.CutoverPlan(
                report=prepared.plan.report,
                restore_evidence=prepared.restore,
                request=replace(
                    prepared.plan.request,
                    candidate_generation_sha256="0" * 64,
                ),
            )

        approval_mutations = (
            ("approval_id", {"approval_id": "another-approval"}),
            ("request_id", {"request_id": "another-request"}),
            ("request_fingerprint", {"request_fingerprint": "1" * 64}),
            ("report_sha256", {"report_sha256": "2" * 64}),
            ("operation_name", {"operation_name": "migration.cutover.other"}),
            ("operation_version", {"operation_version": "9.9.9"}),
            ("operation_contract", {"operation_contract": "other-contract/9.9.9"}),
            ("actor_id", {"actor_id": "migration-operator-08"}),
        )
        for field_name, changes in approval_mutations:
            with self.subTest(field=field_name):
                current = prepare_cutover(
                    request_id=f"request-binding-{field_name}",
                    approval_id=f"approval-binding-{field_name}",
                )
                before = current.coordinator.snapshot()
                mismatched = replace(current.approval, **changes)

                decision = current.coordinator.cutover(current.plan, mismatched)

                self.assertIs(decision.status, migration_cutover.CutoverStatus.DENIED)
                self.assertIs(
                    decision.reason_code,
                    migration_cutover.CutoverReason.APPROVAL_SCOPE_MISMATCH,
                )
                self.assertEqual(decision.changed_fields, (field_name,))
                self.assertIs(current.coordinator.snapshot(), before)

    def test_unready_report_and_unverified_restore_preserve_the_staged_state(self) -> None:
        active = generation("accepted-generation")
        candidate_records = list(baseline_records())
        candidate_records[0] = replace(
            candidate_records[0],
            revision=8,
            payload=candidate_records[0].decoded_payload(),
        )
        clock = ManualClock(NOW + timedelta(minutes=2))
        coordinator = migration_cutover.MigrationCoordinator(
            migration_id="migration-unready",
            active_generation=active,
            clock=clock,
        )
        coordinator.stage_candidate(
            generation("candidate-divergent", tuple(candidate_records)),
            expected_state_epoch=0,
        )
        restore = restore_observation(active)
        plan = coordinator.prepare_cutover(
            request_id="request-unready",
            approval_id="approval-unready",
            actor_id="migration-operator-07",
            restore_evidence=restore,
            requested_at=NOW,
        )
        approval = migration_cutover.CutoverApproval.for_request(
            plan.request,
            approved_by="accountable-reviewer-05",
            approved_at=NOW + timedelta(minutes=1),
            expires_at=NOW + timedelta(minutes=10),
        )
        before = coordinator.snapshot()

        decision = coordinator.cutover(plan, approval)

        self.assertIs(
            decision.reason_code,
            migration_cutover.CutoverReason.REPORT_NOT_READY,
        )
        self.assertIs(coordinator.snapshot(), before)

        unverified = prepare_cutover(
            request_id="request-unverified-restore",
            approval_id="approval-unverified-restore",
            distinct_witness=False,
        )
        unverified_before = unverified.coordinator.snapshot()
        unverified_decision = unverified.coordinator.cutover(
            unverified.plan,
            unverified.approval,
        )
        self.assertIs(
            unverified_decision.reason_code,
            migration_cutover.CutoverReason.RESTORE_NOT_VERIFIED,
        )
        self.assertIs(unverified.coordinator.snapshot(), unverified_before)

    def test_approval_window_includes_approval_and_excludes_expiry(self) -> None:
        at_approval = prepare_cutover(
            request_id="request-at-approval",
            approval_id="approval-at-approval",
        )
        at_approval.clock.now = at_approval.approval.approved_at
        accepted = at_approval.coordinator.cutover(
            at_approval.plan,
            at_approval.approval,
        )
        self.assertIs(accepted.status, migration_cutover.CutoverStatus.ACTIVATED)

        at_expiry = prepare_cutover(
            request_id="request-at-expiry",
            approval_id="approval-at-expiry",
        )
        before = at_expiry.coordinator.snapshot()
        at_expiry.clock.now = at_expiry.approval.expires_at
        expired = at_expiry.coordinator.cutover(
            at_expiry.plan,
            at_expiry.approval,
        )
        self.assertIs(expired.status, migration_cutover.CutoverStatus.DENIED)
        self.assertIs(
            expired.reason_code,
            migration_cutover.CutoverReason.APPROVAL_EXPIRED,
        )
        self.assertIs(at_expiry.coordinator.snapshot(), before)

    def test_new_effect_authorization_decisions_preserve_the_staged_state(self) -> None:
        cases = (
            (
                "approval precedes request",
                migration_cutover.CutoverReason.APPROVAL_PRECEDES_REQUEST,
                {"approved_at": NOW - timedelta(minutes=1)},
                NOW + timedelta(minutes=2),
            ),
            (
                "approval is not active yet",
                migration_cutover.CutoverReason.APPROVAL_NOT_YET_ACTIVE,
                {},
                NOW,
            ),
            (
                "approval is revoked",
                migration_cutover.CutoverReason.APPROVAL_REVOKED,
                {"revoked_at": NOW + timedelta(minutes=1, seconds=30)},
                NOW + timedelta(minutes=2),
            ),
        )
        for name, expected_reason, changes, observed_at in cases:
            with self.subTest(case=name):
                prepared = prepare_cutover(
                    request_id=f"request-{expected_reason}",
                    approval_id=f"approval-{expected_reason}",
                )
                prepared.clock.now = observed_at
                approval = replace(prepared.approval, **changes)
                before = prepared.coordinator.snapshot()

                decision = prepared.coordinator.cutover(prepared.plan, approval)

                self.assertIs(decision.status, migration_cutover.CutoverStatus.DENIED)
                self.assertIs(decision.reason_code, expected_reason)
                self.assertIs(prepared.coordinator.snapshot(), before)
                self.assertEqual(dict(before.approval_consumptions), {})

        distinct = prepare_cutover(
            request_id="request-distinct-approver",
            approval_id="approval-distinct-approver",
        )
        with self.assertRaisesRegex(ValueError, "approved_by to differ from actor_id"):
            migration_cutover.CutoverApproval.for_request(
                distinct.plan.request,
                approved_by=distinct.plan.request.actor_id,
                approved_at=NOW + timedelta(minutes=1),
                expires_at=NOW + timedelta(minutes=10),
            )

    def test_activation_consumes_approval_and_exact_replay_survives_expiry(self) -> None:
        prepared = prepare_cutover()
        activated = prepared.coordinator.cutover(prepared.plan, prepared.approval)
        committed = prepared.coordinator.snapshot()

        prepared.clock.now = prepared.approval.expires_at + timedelta(days=1)
        replayed = prepared.coordinator.cutover(
            prepared.plan,
            prepared.approval,
        )

        self.assertIs(activated.status, migration_cutover.CutoverStatus.ACTIVATED)
        self.assertIs(replayed.status, migration_cutover.CutoverStatus.REPLAYED)
        self.assertIs(replayed.receipt, activated.receipt)
        self.assertIs(prepared.coordinator.snapshot(), committed)
        self.assertEqual(
            dict(committed.approval_consumptions),
            {
                prepared.approval.approval_id: prepared.plan.request.request_fingerprint,
            },
        )
        self.assertEqual(len(committed.events), 1)
        self.assertEqual(committed.prior_generations, (prepared.active,))

    def test_completed_replay_requires_the_original_approval_record(self) -> None:
        prepared = prepare_cutover()
        activated = prepared.coordinator.cutover(prepared.plan, prepared.approval)
        committed = prepared.coordinator.snapshot()
        changed_approval = replace(
            prepared.approval,
            expires_at=prepared.approval.expires_at + timedelta(minutes=1),
        )

        changed = prepared.coordinator.cutover(prepared.plan, changed_approval)

        self.assertIs(activated.status, migration_cutover.CutoverStatus.ACTIVATED)
        self.assertIs(changed.status, migration_cutover.CutoverStatus.DENIED)
        self.assertIs(
            changed.reason_code,
            migration_cutover.CutoverReason.APPROVAL_RECORD_CHANGED,
        )
        self.assertEqual(changed.changed_fields, ("expiresAt",))
        self.assertEqual(
            changed.recorded_fingerprint,
            prepared.approval.approval_fingerprint,
        )
        self.assertEqual(
            changed.candidate_fingerprint,
            changed_approval.approval_fingerprint,
        )
        self.assertIs(prepared.coordinator.snapshot(), committed)

    def test_stale_state_returns_for_current_evidence_without_consuming_approval(self) -> None:
        prepared = prepare_cutover()
        prepared.coordinator.stage_candidate(
            generation("replacement-candidate"),
            expected_state_epoch=prepared.coordinator.snapshot().state_epoch,
        )
        current = prepared.coordinator.snapshot()

        decision = prepared.coordinator.cutover(prepared.plan, prepared.approval)

        self.assertIs(
            decision.status,
            migration_cutover.CutoverStatus.RETURN_FOR_EVIDENCE,
        )
        self.assertIs(
            decision.reason_code,
            migration_cutover.CutoverReason.STALE_STATE,
        )
        self.assertIs(prepared.coordinator.snapshot(), current)
        self.assertEqual(dict(current.approval_consumptions), {})

    def test_request_and_approval_identity_conflicts_preserve_committed_state(self) -> None:
        prepared = prepare_cutover()
        prepared.coordinator.cutover(prepared.plan, prepared.approval)
        committed = prepared.coordinator.snapshot()

        changed_request = replace(
            prepared.plan.request,
            actor_id="migration-operator-08",
        )
        changed_plan = migration_cutover.CutoverPlan(
            prepared.plan.report,
            prepared.restore,
            changed_request,
        )
        changed_approval = migration_cutover.CutoverApproval.for_request(
            changed_request,
            approved_by="accountable-reviewer-06",
            approved_at=NOW + timedelta(minutes=1),
            expires_at=NOW + timedelta(minutes=10),
        )
        request_conflict = prepared.coordinator.cutover(
            changed_plan,
            changed_approval,
        )
        self.assertIs(
            request_conflict.reason_code,
            migration_cutover.CutoverReason.REQUEST_IDENTITY_REUSED,
        )
        self.assertEqual(request_conflict.changed_fields, ("actorId",))
        self.assertIs(prepared.coordinator.snapshot(), committed)

        new_request = replace(prepared.plan.request, request_id="another-request")
        new_plan = migration_cutover.CutoverPlan(
            prepared.plan.report,
            prepared.restore,
            new_request,
        )
        reused_approval = migration_cutover.CutoverApproval.for_request(
            new_request,
            approved_by="accountable-reviewer-06",
            approved_at=NOW + timedelta(minutes=1),
            expires_at=NOW + timedelta(minutes=10),
        )
        approval_conflict = prepared.coordinator.cutover(
            new_plan,
            reused_approval,
        )
        self.assertIs(approval_conflict.status, migration_cutover.CutoverStatus.DENIED)
        self.assertIs(
            approval_conflict.reason_code,
            migration_cutover.CutoverReason.APPROVAL_IDENTITY_REUSED,
        )
        self.assertIs(prepared.coordinator.snapshot(), committed)

    def test_barrier_coordinated_exact_requests_publish_one_outcome(self) -> None:
        overlap = Barrier(2)
        prepared = prepare_cutover(entry_probe=lambda: overlap.wait(timeout=5))

        def activate() -> migration_cutover.CutoverDecision:
            return prepared.coordinator.cutover(
                prepared.plan,
                prepared.approval,
            )

        with ThreadPoolExecutor(max_workers=2) as executor:
            decisions = [
                future.result() for future in [executor.submit(activate) for _ in range(2)]
            ]

        statuses = [decision.status for decision in decisions]
        self.assertEqual(statuses.count(migration_cutover.CutoverStatus.ACTIVATED), 1)
        self.assertEqual(statuses.count(migration_cutover.CutoverStatus.REPLAYED), 1)
        self.assertEqual(decisions[0].receipt, decisions[1].receipt)
        snapshot = prepared.coordinator.snapshot()
        self.assertEqual(len(snapshot.receipts), 1)
        self.assertEqual(len(snapshot.events), 1)
        self.assertEqual(len(snapshot.approval_consumptions), 1)

    def test_barrier_coordinated_competing_meanings_publish_one_outcome(self) -> None:
        overlap = Barrier(2)
        prepared = prepare_cutover(entry_probe=lambda: overlap.wait(timeout=5))
        competing_request = replace(
            prepared.plan.request,
            actor_id="migration-operator-08",
        )
        competing_plan = migration_cutover.CutoverPlan(
            prepared.plan.report,
            prepared.restore,
            competing_request,
        )
        competing_approval = migration_cutover.CutoverApproval.for_request(
            competing_request,
            approved_by="accountable-reviewer-06",
            approved_at=NOW + timedelta(minutes=1),
            expires_at=NOW + timedelta(minutes=10),
        )
        calls = (
            (prepared.plan, prepared.approval),
            (competing_plan, competing_approval),
        )

        def activate(call) -> migration_cutover.CutoverDecision:
            plan, approval = call
            return prepared.coordinator.cutover(
                plan,
                approval,
            )

        with ThreadPoolExecutor(max_workers=2) as executor:
            decisions = list(executor.map(activate, calls))

        statuses = [decision.status for decision in decisions]
        self.assertEqual(statuses.count(migration_cutover.CutoverStatus.ACTIVATED), 1)
        self.assertEqual(
            statuses.count(migration_cutover.CutoverStatus.RETURN_FOR_EVIDENCE),
            1,
        )
        collision = next(
            decision
            for decision in decisions
            if decision.status is migration_cutover.CutoverStatus.RETURN_FOR_EVIDENCE
        )
        self.assertIs(
            collision.reason_code,
            migration_cutover.CutoverReason.REQUEST_IDENTITY_REUSED,
        )
        snapshot = prepared.coordinator.snapshot()
        self.assertEqual(len(snapshot.receipts), 1)
        self.assertEqual(len(snapshot.events), 1)
        self.assertEqual(len(snapshot.approval_consumptions), 1)

    def test_each_detached_commit_step_preserves_populated_prior_state(self) -> None:
        for selected_step in migration_cutover.CommitStep:
            with self.subTest(step=selected_step):
                fault: dict[str, migration_cutover.CommitStep | None] = {"step": None}

                def inject(
                    step: migration_cutover.CommitStep,
                    selected_fault: dict[str, migration_cutover.CommitStep | None] = fault,
                ) -> None:
                    if step is selected_fault["step"]:
                        raise SyntheticCommitFault(f"synthetic interruption at {step}")

                first = prepare_cutover(commit_probe=inject)
                first_result = first.coordinator.cutover(first.plan, first.approval)
                self.assertIs(first_result.status, migration_cutover.CutoverStatus.ACTIVATED)
                second = prepare_cutover(
                    coordinator=first.coordinator,
                    candidate_id=f"candidate-after-{selected_step}",
                    request_id=f"request-after-{selected_step}",
                    approval_id=f"approval-after-{selected_step}",
                    clock=first.clock,
                )
                populated = first.coordinator.snapshot()
                self.assertEqual(len(populated.requests), 1)
                self.assertEqual(len(populated.approvals), 1)
                self.assertEqual(len(populated.events), 1)
                self.assertEqual(populated.prior_generations, (first.active,))

                fault["step"] = selected_step
                with self.assertRaises(SyntheticCommitFault):
                    first.coordinator.cutover(
                        second.plan,
                        second.approval,
                    )

                self.assertIs(first.coordinator.snapshot(), populated)
                fault["step"] = None
                retried = first.coordinator.cutover(
                    second.plan,
                    second.approval,
                )
                self.assertIs(retried.status, migration_cutover.CutoverStatus.ACTIVATED)
                final = first.coordinator.snapshot()
                self.assertEqual(
                    tuple(item.generation_id for item in final.prior_generations),
                    (first.active.generation_id, first.candidate.generation_id),
                )
                self.assertEqual(len(final.requests), 2)
                self.assertEqual(len(final.events), 2)

    def test_reentrant_commit_probe_preserves_the_newer_staged_state(self) -> None:
        holder: list[migration_cutover.MigrationCoordinator] = []
        replacement = generation("candidate-staged-during-commit")
        reentered = False

        def reenter(step: migration_cutover.CommitStep) -> None:
            nonlocal reentered
            if step is migration_cutover.CommitStep.APPROVAL_CONSUMED and not reentered:
                reentered = True
                coordinator = holder[0]
                coordinator.stage_candidate(
                    replacement,
                    expected_state_epoch=coordinator.snapshot().state_epoch,
                )

        prepared = prepare_cutover(commit_probe=reenter)
        holder.append(prepared.coordinator)
        before = prepared.coordinator.snapshot()

        decision = prepared.coordinator.cutover(prepared.plan, prepared.approval)

        self.assertTrue(reentered)
        self.assertIs(
            decision.status,
            migration_cutover.CutoverStatus.RETURN_FOR_EVIDENCE,
        )
        self.assertIs(
            decision.reason_code,
            migration_cutover.CutoverReason.STALE_STATE,
        )
        current = prepared.coordinator.snapshot()
        self.assertEqual(current.state_epoch, before.state_epoch + 1)
        self.assertEqual(current.active_generation, prepared.active)
        self.assertEqual(current.candidate_generation, replacement)
        self.assertEqual(current.prior_generations, ())
        self.assertEqual(dict(current.requests), {})
        self.assertEqual(dict(current.approvals), {})
        self.assertEqual(dict(current.approval_consumptions), {})
        self.assertEqual(dict(current.receipts), {})
        self.assertEqual(current.events, ())

    def test_response_loss_replays_the_published_receipt_without_a_second_effect(self) -> None:
        observed: list[migration_cutover.CutoverReceipt] = []

        def lose_response(receipt: migration_cutover.CutoverReceipt) -> None:
            observed.append(receipt)
            raise migration_cutover.PostPublicationResponseLost(
                "synthetic response loss after publication"
            )

        prepared = prepare_cutover(post_publication_probe=lose_response)
        with self.assertRaises(migration_cutover.PostPublicationResponseLost):
            prepared.coordinator.cutover(
                prepared.plan,
                prepared.approval,
            )
        published = prepared.coordinator.snapshot()
        self.assertEqual(len(published.receipts), 1)
        self.assertEqual(len(published.events), 1)
        self.assertEqual(published.prior_generations, (prepared.active,))
        self.assertIs(published.receipts[prepared.plan.request.request_id], observed[0])

        prepared.clock.now = prepared.approval.expires_at + timedelta(days=1)
        replayed = prepared.coordinator.cutover(prepared.plan, prepared.approval)
        self.assertIs(replayed.status, migration_cutover.CutoverStatus.REPLAYED)
        self.assertIs(replayed.receipt, observed[0])
        self.assertIs(prepared.coordinator.snapshot(), published)
        self.assertEqual(len(observed), 1)

    def test_fresh_coordinator_starts_at_the_process_local_boundary(self) -> None:
        prepared = prepare_cutover()
        prepared.coordinator.cutover(prepared.plan, prepared.approval)
        committed = prepared.coordinator.snapshot()
        fresh = migration_cutover.MigrationCoordinator(
            migration_id="lims-cutover-synthetic-001",
            active_generation=prepared.active,
        ).snapshot()

        self.assertEqual(committed.active_generation, prepared.candidate)
        self.assertEqual(fresh.active_generation, prepared.active)
        self.assertEqual(fresh.state_epoch, 0)
        self.assertIsNone(fresh.candidate_generation)
        self.assertEqual(fresh.prior_generations, ())
        self.assertEqual(dict(fresh.requests), {})
        self.assertEqual(dict(fresh.approvals), {})
        self.assertEqual(dict(fresh.approval_consumptions), {})
        self.assertEqual(dict(fresh.receipts), {})
        self.assertEqual(fresh.events, ())


if __name__ == "__main__":
    unittest.main()
