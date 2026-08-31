"""Digest-bound migration reconciliation and approval-bound cutover."""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from hashlib import sha256
from math import isfinite
from pathlib import Path
from threading import RLock
from types import MappingProxyType
from typing import Any

REPORT_CONTRACT = "migration-reconciliation-report/0.1.0"
CUTOVER_OPERATION = "migration.cutover.activate"
CUTOVER_OPERATION_VERSION = "0.1.0"
CUTOVER_OPERATION_CONTRACT = "migration-cutover-operation/0.1.0"
RESTORE_CONTRACT = "migration-restore-observation/0.1.0"
SHA256_PATTERN = re.compile(r"[a-f0-9]{64}")
IdentityKey = tuple[str, str]


def _validate_json_tree(value: object, *, path: str = "$") -> None:
    if value is None or isinstance(value, (str, bool, int)):
        return
    if isinstance(value, float):
        if not isfinite(value):
            raise ValueError(f"{path} requires a finite JSON number")
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise ValueError(f"{path} object keys require text")
            _validate_json_tree(item, path=f"{path}.{key}")
        return
    if isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            _validate_json_tree(item, path=f"{path}[{index}]")
        return
    raise ValueError(f"{path} contains a value outside the admitted JSON types")


def _canonical_bytes(value: object) -> bytes:
    _validate_json_tree(value)
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
        allow_nan=False,
    ).encode("ascii")


def _digest(value: object) -> str:
    return sha256(_canonical_bytes(value)).hexdigest()


def _require_text(name: str, value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} requires a populated value")
    if value != value.strip():
        raise ValueError(f"{name} requires canonical text without surrounding whitespace")
    return value


def _require_digest(name: str, value: str) -> str:
    if not isinstance(value, str) or SHA256_PATTERN.fullmatch(value) is None:
        raise ValueError(f"{name} requires a lowercase SHA-256 digest")
    return value


def _require_aware_utc(name: str, value: datetime) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{name} requires a timezone-aware value")
    return value.astimezone(UTC)


def _require_nonnegative_integer(name: str, value: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValueError(f"{name} requires a nonnegative integer")
    return value


def _require_positive_integer(name: str, value: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise ValueError(f"{name} requires a positive integer")
    return value


def _require_nonnegative_number(name: str, value: object) -> float:
    if (
        not isinstance(value, (int, float))
        or isinstance(value, bool)
        or not isfinite(value)
        or value < 0
    ):
        raise ValueError(f"{name} requires a finite nonnegative number")
    return float(value)


def _require_identity_key(name: str, value: IdentityKey) -> IdentityKey:
    if not isinstance(value, tuple) or len(value) != 2:
        raise ValueError(f"{name} requires a tenant and canonical identity pair")
    return (
        _require_text(f"{name}.tenant_id", value[0]),
        _require_text(f"{name}.canonical_identity", value[1]),
    )


def _identity_document(value: IdentityKey) -> dict[str, str]:
    return {"tenantId": value[0], "canonicalIdentity": value[1]}


def _immutable_json(value: Any) -> Any:
    if isinstance(value, dict):
        return MappingProxyType({key: _immutable_json(item) for key, item in value.items()})
    if isinstance(value, list):
        return tuple(_immutable_json(item) for item in value)
    return value


def _freeze_map(values: Mapping[str, Any]) -> Mapping[str, Any]:
    return MappingProxyType(dict(values))


def _changed_fields(
    recorded: Mapping[str, object], candidate: Mapping[str, object]
) -> tuple[str, ...]:
    return tuple(
        sorted(
            key for key in set(recorded).union(candidate) if recorded.get(key) != candidate.get(key)
        )
    )


@dataclass(frozen=True, slots=True)
class MigrationRecord:
    tenant_id: str
    canonical_identity: str
    revision: int
    payload: Mapping[str, object]
    artifact_sha256: str | None = None
    _payload_bytes: bytes = field(init=False, repr=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "tenant_id", _require_text("tenant_id", self.tenant_id))
        object.__setattr__(
            self,
            "canonical_identity",
            _require_text("canonical_identity", self.canonical_identity),
        )
        _require_positive_integer("revision", self.revision)
        if not isinstance(self.payload, Mapping):
            raise ValueError("payload requires a JSON object")
        payload_input = dict(self.payload)
        payload_bytes = _canonical_bytes(payload_input)
        decoded = json.loads(payload_bytes)
        if not isinstance(decoded, dict):
            raise ValueError("payload requires a JSON object")
        object.__setattr__(self, "payload", _immutable_json(decoded))
        object.__setattr__(self, "_payload_bytes", payload_bytes)
        if self.artifact_sha256 is not None:
            _require_digest("artifact_sha256", self.artifact_sha256)

    @property
    def identity_key(self) -> tuple[str, str]:
        return self.tenant_id, self.canonical_identity

    def decoded_payload(self) -> dict[str, object]:
        decoded = json.loads(self._payload_bytes)
        assert isinstance(decoded, dict)
        return decoded

    def to_document(self) -> dict[str, object]:
        return {
            "tenantId": self.tenant_id,
            "canonicalIdentity": self.canonical_identity,
            "revision": self.revision,
            "payload": self.decoded_payload(),
            "artifactSha256": self.artifact_sha256,
        }

    @property
    def semantic_sha256(self) -> str:
        return _digest(self.to_document())


@dataclass(frozen=True, slots=True)
class MigrationGeneration:
    generation_id: str
    records: tuple[MigrationRecord, ...]

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "generation_id",
            _require_text("generation_id", self.generation_id),
        )
        records = tuple(self.records)
        if any(not isinstance(record, MigrationRecord) for record in records):
            raise ValueError("generation records require MigrationRecord values")
        ordered = tuple(sorted(records, key=lambda item: item.identity_key))
        if not ordered:
            raise ValueError("a migration generation requires at least one record")
        keys = [record.identity_key for record in ordered]
        if len(keys) != len(set(keys)):
            raise ValueError("generation record identities require tenant-scoped uniqueness")
        object.__setattr__(self, "records", ordered)

    @property
    def generation_sha256(self) -> str:
        return _digest({"records": [record.to_document() for record in self.records]})

    def record_map(self) -> dict[tuple[str, str], MigrationRecord]:
        return {record.identity_key: record for record in self.records}

    def to_document(self) -> dict[str, object]:
        return {
            "generationId": self.generation_id,
            "generationSha256": self.generation_sha256,
            "recordCount": len(self.records),
            "records": [record.to_document() for record in self.records],
        }


class ReconciliationPhase(StrEnum):
    RECONCILIATION_REQUIRED = "reconciliation_required"
    READY_FOR_APPROVAL = "ready_for_approval"


@dataclass(frozen=True, slots=True)
class ReconciliationReport:
    migration_id: str
    state_epoch: int
    active_generation_id: str
    active_generation_sha256: str
    source_generation_id: str
    source_generation_sha256: str
    source_count: int
    candidate_generation_id: str
    candidate_generation_sha256: str
    candidate_count: int
    matching_identities: tuple[IdentityKey, ...]
    missing_identities: tuple[IdentityKey, ...]
    divergent_identities: tuple[IdentityKey, ...]
    extra_identities: tuple[IdentityKey, ...]
    report_contract: str = REPORT_CONTRACT

    def __post_init__(self) -> None:
        for name in (
            "migration_id",
            "active_generation_id",
            "source_generation_id",
            "candidate_generation_id",
            "report_contract",
        ):
            object.__setattr__(self, name, _require_text(name, getattr(self, name)))
        for name in (
            "active_generation_sha256",
            "source_generation_sha256",
            "candidate_generation_sha256",
        ):
            _require_digest(name, getattr(self, name))
        _require_nonnegative_integer("state_epoch", self.state_epoch)
        _require_nonnegative_integer("source_count", self.source_count)
        _require_nonnegative_integer("candidate_count", self.candidate_count)
        partitions: list[IdentityKey] = []
        for name in (
            "matching_identities",
            "missing_identities",
            "divergent_identities",
            "extra_identities",
        ):
            values = tuple(
                sorted(_require_identity_key(name, value) for value in getattr(self, name))
            )
            if len(values) != len(set(values)):
                raise ValueError(f"{name} requires unique identities")
            object.__setattr__(self, name, values)
            partitions.extend(values)
        if len(partitions) != len(set(partitions)):
            raise ValueError("reconciliation partitions require disjoint identities")

    @property
    def ready_for_approval(self) -> bool:
        return (
            self.source_count == self.candidate_count == len(self.matching_identities)
            and not self.missing_identities
            and not self.divergent_identities
            and not self.extra_identities
        )

    @property
    def phase(self) -> ReconciliationPhase:
        if self.ready_for_approval:
            return ReconciliationPhase.READY_FOR_APPROVAL
        return ReconciliationPhase.RECONCILIATION_REQUIRED

    def to_document(self) -> dict[str, object]:
        return {
            "reportContract": self.report_contract,
            "migrationId": self.migration_id,
            "stateEpoch": self.state_epoch,
            "phase": self.phase,
            "activeGeneration": {
                "id": self.active_generation_id,
                "sha256": self.active_generation_sha256,
            },
            "sourceGeneration": {
                "id": self.source_generation_id,
                "sha256": self.source_generation_sha256,
                "count": self.source_count,
            },
            "candidateGeneration": {
                "id": self.candidate_generation_id,
                "sha256": self.candidate_generation_sha256,
                "count": self.candidate_count,
            },
            "partition": {
                "matching": [_identity_document(value) for value in self.matching_identities],
                "missing": [_identity_document(value) for value in self.missing_identities],
                "divergent": [_identity_document(value) for value in self.divergent_identities],
                "extra": [_identity_document(value) for value in self.extra_identities],
            },
        }

    @property
    def report_sha256(self) -> str:
        return _digest(self.to_document())


def reconcile_generations(
    *,
    migration_id: str,
    state_epoch: int,
    active_generation: MigrationGeneration,
    source_generation: MigrationGeneration,
    candidate_generation: MigrationGeneration,
) -> ReconciliationReport:
    source = source_generation.record_map()
    candidate = candidate_generation.record_map()
    source_keys = set(source)
    candidate_keys = set(candidate)
    shared = source_keys.intersection(candidate_keys)
    divergent = {
        key for key in shared if source[key].semantic_sha256 != candidate[key].semantic_sha256
    }
    matching = shared.difference(divergent)

    def coordinates(keys: Iterable[IdentityKey]) -> tuple[IdentityKey, ...]:
        return tuple(sorted(keys))

    return ReconciliationReport(
        migration_id=migration_id,
        state_epoch=state_epoch,
        active_generation_id=active_generation.generation_id,
        active_generation_sha256=active_generation.generation_sha256,
        source_generation_id=source_generation.generation_id,
        source_generation_sha256=source_generation.generation_sha256,
        source_count=len(source),
        candidate_generation_id=candidate_generation.generation_id,
        candidate_generation_sha256=candidate_generation.generation_sha256,
        candidate_count=len(candidate),
        matching_identities=coordinates(matching),
        missing_identities=coordinates(source_keys.difference(candidate_keys)),
        divergent_identities=coordinates(divergent),
        extra_identities=coordinates(candidate_keys.difference(source_keys)),
    )


def _artifact_multiplicity(generation: MigrationGeneration) -> tuple[tuple[str, int], ...]:
    counts = Counter(
        record.artifact_sha256
        for record in generation.records
        if record.artifact_sha256 is not None
    )
    return tuple(sorted(counts.items()))


@dataclass(frozen=True, slots=True)
class RestoreEvidence:
    restore_id: str
    source_generation_id: str
    source_generation_sha256: str
    restored_generation_id: str
    restored_generation_sha256: str
    source_count: int
    restored_count: int
    source_artifact_multiplicity: tuple[tuple[str, int], ...]
    restored_artifact_multiplicity: tuple[tuple[str, int], ...]
    observed_rto_seconds: float
    observed_rpo_seconds: float
    rto_objective_seconds: float
    rpo_objective_seconds: float
    operator_id: str
    witness_id: str
    completed_at: datetime
    restore_contract: str = RESTORE_CONTRACT

    def __post_init__(self) -> None:
        for name in (
            "restore_id",
            "source_generation_id",
            "restored_generation_id",
            "operator_id",
            "witness_id",
            "restore_contract",
        ):
            object.__setattr__(self, name, _require_text(name, getattr(self, name)))
        for name in ("source_generation_sha256", "restored_generation_sha256"):
            _require_digest(name, getattr(self, name))
        object.__setattr__(
            self,
            "completed_at",
            _require_aware_utc("completed_at", self.completed_at),
        )
        for name in (
            "observed_rto_seconds",
            "observed_rpo_seconds",
            "rto_objective_seconds",
            "rpo_objective_seconds",
        ):
            object.__setattr__(
                self,
                name,
                _require_nonnegative_number(name, getattr(self, name)),
            )
        _require_nonnegative_integer("source_count", self.source_count)
        _require_nonnegative_integer("restored_count", self.restored_count)
        for name in (
            "source_artifact_multiplicity",
            "restored_artifact_multiplicity",
        ):
            values = tuple(sorted(getattr(self, name)))
            if len(values) != len({digest for digest, _ in values}):
                raise ValueError(f"{name} requires unique artifact digests")
            for digest, count in values:
                _require_digest(f"{name} digest", digest)
                _require_positive_integer(f"{name} count", count)
            object.__setattr__(self, name, values)
        if self.restore_contract != RESTORE_CONTRACT:
            raise ValueError(f"restore_contract requires {RESTORE_CONTRACT}")

    @classmethod
    def observe(
        cls,
        *,
        restore_id: str,
        source: MigrationGeneration,
        restored: MigrationGeneration,
        observed_rto_seconds: float,
        observed_rpo_seconds: float,
        rto_objective_seconds: float,
        rpo_objective_seconds: float,
        operator_id: str,
        witness_id: str,
        completed_at: datetime,
    ) -> RestoreEvidence:
        return cls(
            restore_id=restore_id,
            source_generation_id=source.generation_id,
            source_generation_sha256=source.generation_sha256,
            restored_generation_id=restored.generation_id,
            restored_generation_sha256=restored.generation_sha256,
            source_count=len(source.records),
            restored_count=len(restored.records),
            source_artifact_multiplicity=_artifact_multiplicity(source),
            restored_artifact_multiplicity=_artifact_multiplicity(restored),
            observed_rto_seconds=observed_rto_seconds,
            observed_rpo_seconds=observed_rpo_seconds,
            rto_objective_seconds=rto_objective_seconds,
            rpo_objective_seconds=rpo_objective_seconds,
            operator_id=operator_id,
            witness_id=witness_id,
            completed_at=completed_at,
        )

    @property
    def verified(self) -> bool:
        return (
            self.source_generation_sha256 == self.restored_generation_sha256
            and self.source_count == self.restored_count
            and self.source_artifact_multiplicity == self.restored_artifact_multiplicity
            and self.operator_id != self.witness_id
            and self.observed_rto_seconds <= self.rto_objective_seconds
            and self.observed_rpo_seconds <= self.rpo_objective_seconds
        )

    def to_document(self) -> dict[str, object]:
        def multiplicity(values: tuple[tuple[str, int], ...]) -> list[dict[str, object]]:
            return [{"sha256": digest, "count": count} for digest, count in values]

        return {
            "restoreContract": self.restore_contract,
            "restoreId": self.restore_id,
            "sourceGeneration": {
                "id": self.source_generation_id,
                "sha256": self.source_generation_sha256,
                "count": self.source_count,
                "artifactMultiplicity": multiplicity(self.source_artifact_multiplicity),
            },
            "restoredGeneration": {
                "id": self.restored_generation_id,
                "sha256": self.restored_generation_sha256,
                "count": self.restored_count,
                "artifactMultiplicity": multiplicity(self.restored_artifact_multiplicity),
            },
            "observed": {
                "rtoSeconds": self.observed_rto_seconds,
                "rpoSeconds": self.observed_rpo_seconds,
            },
            "objective": {
                "rtoSeconds": self.rto_objective_seconds,
                "rpoSeconds": self.rpo_objective_seconds,
            },
            "operatorId": self.operator_id,
            "witnessId": self.witness_id,
            "completedAt": self.completed_at.isoformat(),
            "verified": self.verified,
        }

    @property
    def evidence_sha256(self) -> str:
        return _digest(self.to_document())


@dataclass(frozen=True, slots=True)
class CutoverRequest:
    request_id: str
    approval_id: str
    migration_id: str
    actor_id: str
    expected_state_epoch: int
    expected_active_generation_id: str
    expected_active_generation_sha256: str
    source_generation_id: str
    source_generation_sha256: str
    candidate_generation_id: str
    candidate_generation_sha256: str
    report_sha256: str
    restore_evidence_sha256: str
    requested_at: datetime
    operation_name: str = CUTOVER_OPERATION
    operation_version: str = CUTOVER_OPERATION_VERSION
    operation_contract: str = CUTOVER_OPERATION_CONTRACT

    def __post_init__(self) -> None:
        for name in (
            "request_id",
            "approval_id",
            "migration_id",
            "actor_id",
            "expected_active_generation_id",
            "source_generation_id",
            "candidate_generation_id",
            "operation_name",
            "operation_version",
            "operation_contract",
        ):
            object.__setattr__(self, name, _require_text(name, getattr(self, name)))
        for name in (
            "expected_active_generation_sha256",
            "source_generation_sha256",
            "candidate_generation_sha256",
            "report_sha256",
            "restore_evidence_sha256",
        ):
            _require_digest(name, getattr(self, name))
        _require_nonnegative_integer("expected_state_epoch", self.expected_state_epoch)
        object.__setattr__(
            self,
            "requested_at",
            _require_aware_utc("requested_at", self.requested_at),
        )
        expected_operation = (
            CUTOVER_OPERATION,
            CUTOVER_OPERATION_VERSION,
            CUTOVER_OPERATION_CONTRACT,
        )
        if (
            self.operation_name,
            self.operation_version,
            self.operation_contract,
        ) != expected_operation:
            raise ValueError("cutover request requires the modeled operation contract")

    def to_document(self) -> dict[str, object]:
        return {
            "requestId": self.request_id,
            "approvalId": self.approval_id,
            "migrationId": self.migration_id,
            "actorId": self.actor_id,
            "expectedStateEpoch": self.expected_state_epoch,
            "expectedActiveGeneration": {
                "id": self.expected_active_generation_id,
                "sha256": self.expected_active_generation_sha256,
            },
            "sourceGeneration": {
                "id": self.source_generation_id,
                "sha256": self.source_generation_sha256,
            },
            "candidateGeneration": {
                "id": self.candidate_generation_id,
                "sha256": self.candidate_generation_sha256,
            },
            "reportSha256": self.report_sha256,
            "restoreEvidenceSha256": self.restore_evidence_sha256,
            "requestedAt": self.requested_at.isoformat(),
            "operation": {
                "name": self.operation_name,
                "version": self.operation_version,
                "contract": self.operation_contract,
            },
        }

    @property
    def request_fingerprint(self) -> str:
        return _digest(self.to_document())


@dataclass(frozen=True, slots=True)
class CutoverPlan:
    report: ReconciliationReport
    restore_evidence: RestoreEvidence
    request: CutoverRequest

    def __post_init__(self) -> None:
        request = self.request
        report = self.report
        restore = self.restore_evidence
        bindings = {
            "migration_id": (request.migration_id, report.migration_id),
            "state_epoch": (request.expected_state_epoch, report.state_epoch),
            "active_generation_id": (
                request.expected_active_generation_id,
                report.active_generation_id,
            ),
            "active_generation_sha256": (
                request.expected_active_generation_sha256,
                report.active_generation_sha256,
            ),
            "source_generation_id": (request.source_generation_id, report.source_generation_id),
            "source_generation_sha256": (
                request.source_generation_sha256,
                report.source_generation_sha256,
            ),
            "candidate_generation_id": (
                request.candidate_generation_id,
                report.candidate_generation_id,
            ),
            "candidate_generation_sha256": (
                request.candidate_generation_sha256,
                report.candidate_generation_sha256,
            ),
            "report_sha256": (request.report_sha256, report.report_sha256),
            "restore_evidence_sha256": (
                request.restore_evidence_sha256,
                restore.evidence_sha256,
            ),
            "restore_source_id": (
                restore.source_generation_id,
                report.active_generation_id,
            ),
            "restore_source_sha256": (
                restore.source_generation_sha256,
                report.active_generation_sha256,
            ),
        }
        mismatches = [name for name, values in bindings.items() if values[0] != values[1]]
        if mismatches:
            raise ValueError("cutover plan bindings disagree: " + ", ".join(mismatches))
        if request.requested_at < restore.completed_at:
            raise ValueError("cutover request requires completed restore evidence")

    @property
    def ready_for_approval(self) -> bool:
        return self.report.ready_for_approval and self.restore_evidence.verified


@dataclass(frozen=True, slots=True)
class CutoverApproval:
    approval_id: str
    request_id: str
    request_fingerprint: str
    report_sha256: str
    operation_name: str
    operation_version: str
    operation_contract: str
    actor_id: str
    approved_by: str
    approved_at: datetime
    expires_at: datetime
    revoked_at: datetime | None = None

    def __post_init__(self) -> None:
        for name in (
            "approval_id",
            "request_id",
            "operation_name",
            "operation_version",
            "operation_contract",
            "actor_id",
            "approved_by",
        ):
            object.__setattr__(self, name, _require_text(name, getattr(self, name)))
        _require_digest("request_fingerprint", self.request_fingerprint)
        _require_digest("report_sha256", self.report_sha256)
        object.__setattr__(
            self,
            "approved_at",
            _require_aware_utc("approved_at", self.approved_at),
        )
        object.__setattr__(
            self,
            "expires_at",
            _require_aware_utc("expires_at", self.expires_at),
        )
        if self.expires_at <= self.approved_at:
            raise ValueError("approval expiry requires a later instant")
        if self.revoked_at is not None:
            object.__setattr__(
                self,
                "revoked_at",
                _require_aware_utc("revoked_at", self.revoked_at),
            )
            if self.revoked_at < self.approved_at:
                raise ValueError("approval revocation requires an instant at or after approval")
        if self.approved_by == self.actor_id:
            raise ValueError("cutover approval requires approved_by to differ from actor_id")

    @classmethod
    def for_request(
        cls,
        request: CutoverRequest,
        *,
        approved_by: str,
        approved_at: datetime,
        expires_at: datetime,
        revoked_at: datetime | None = None,
    ) -> CutoverApproval:
        return cls(
            approval_id=request.approval_id,
            request_id=request.request_id,
            request_fingerprint=request.request_fingerprint,
            report_sha256=request.report_sha256,
            operation_name=request.operation_name,
            operation_version=request.operation_version,
            operation_contract=request.operation_contract,
            actor_id=request.actor_id,
            approved_by=approved_by,
            approved_at=approved_at,
            expires_at=expires_at,
            revoked_at=revoked_at,
        )

    def to_document(self) -> dict[str, object]:
        return {
            "approvalId": self.approval_id,
            "requestId": self.request_id,
            "requestFingerprint": self.request_fingerprint,
            "reportSha256": self.report_sha256,
            "operation": {
                "name": self.operation_name,
                "version": self.operation_version,
                "contract": self.operation_contract,
            },
            "actorId": self.actor_id,
            "approvedBy": self.approved_by,
            "approvedAt": self.approved_at.isoformat(),
            "expiresAt": self.expires_at.isoformat(),
            "revokedAt": self.revoked_at.isoformat() if self.revoked_at else None,
        }

    @property
    def approval_fingerprint(self) -> str:
        return _digest(self.to_document())


class CutoverStatus(StrEnum):
    ACTIVATED = "activated"
    REPLAYED = "replayed"
    RETURN_FOR_EVIDENCE = "return_for_evidence"
    DENIED = "denied"


class CutoverReason(StrEnum):
    REQUEST_IDENTITY_REUSED = "request_identity_reused"
    APPROVAL_IDENTITY_REUSED = "approval_identity_reused"
    APPROVAL_RECORD_CHANGED = "approval_record_changed"
    STALE_STATE = "stale_state"
    REPORT_NOT_READY = "report_not_ready"
    RESTORE_NOT_VERIFIED = "restore_not_verified"
    APPROVAL_SCOPE_MISMATCH = "approval_scope_mismatch"
    APPROVAL_PRECEDES_REQUEST = "approval_precedes_request"
    APPROVAL_NOT_YET_ACTIVE = "approval_not_yet_active"
    APPROVAL_EXPIRED = "approval_expired"
    APPROVAL_REVOKED = "approval_revoked"


@dataclass(frozen=True, slots=True)
class CutoverReceipt:
    migration_id: str
    event_id: str
    request_id: str
    request_fingerprint: str
    approval_id: str
    approval_fingerprint: str
    report_sha256: str
    restore_evidence_sha256: str
    prior_generation_id: str
    prior_generation_sha256: str
    accepted_generation_id: str
    accepted_generation_sha256: str
    prior_state_epoch: int
    committed_state_epoch: int
    actor_id: str
    approved_by: str
    committed_at: datetime
    operation_name: str
    operation_version: str
    operation_contract: str

    def to_document(self) -> dict[str, object]:
        return {
            "migrationId": self.migration_id,
            "eventId": self.event_id,
            "requestId": self.request_id,
            "requestFingerprint": self.request_fingerprint,
            "approvalId": self.approval_id,
            "approvalFingerprint": self.approval_fingerprint,
            "reportSha256": self.report_sha256,
            "restoreEvidenceSha256": self.restore_evidence_sha256,
            "priorGeneration": {
                "id": self.prior_generation_id,
                "sha256": self.prior_generation_sha256,
            },
            "acceptedGeneration": {
                "id": self.accepted_generation_id,
                "sha256": self.accepted_generation_sha256,
            },
            "priorStateEpoch": self.prior_state_epoch,
            "committedStateEpoch": self.committed_state_epoch,
            "actorId": self.actor_id,
            "approvedBy": self.approved_by,
            "committedAt": self.committed_at.isoformat(),
            "operation": {
                "name": self.operation_name,
                "version": self.operation_version,
                "contract": self.operation_contract,
            },
        }

    @property
    def receipt_sha256(self) -> str:
        return _digest(self.to_document())


@dataclass(frozen=True, slots=True)
class CutoverEvent:
    event_id: str
    migration_id: str
    request_id: str
    receipt_sha256: str
    prior_generation_id: str
    accepted_generation_id: str
    committed_state_epoch: int
    committed_at: datetime

    def to_document(self) -> dict[str, object]:
        return {
            "eventId": self.event_id,
            "migrationId": self.migration_id,
            "requestId": self.request_id,
            "receiptSha256": self.receipt_sha256,
            "priorGenerationId": self.prior_generation_id,
            "acceptedGenerationId": self.accepted_generation_id,
            "committedStateEpoch": self.committed_state_epoch,
            "committedAt": self.committed_at.isoformat(),
        }


@dataclass(frozen=True, slots=True)
class CutoverDecision:
    status: CutoverStatus
    reason_code: CutoverReason | None
    recovery: str
    receipt: CutoverReceipt | None = None
    changed_fields: tuple[str, ...] = ()
    recorded_fingerprint: str | None = None
    candidate_fingerprint: str | None = None

    def to_document(self) -> dict[str, object]:
        return {
            "status": self.status,
            "reasonCode": self.reason_code,
            "recovery": self.recovery,
            "changedFields": list(self.changed_fields),
            "recordedFingerprint": self.recorded_fingerprint,
            "candidateFingerprint": self.candidate_fingerprint,
            "receipt": self.receipt.to_document() if self.receipt else None,
        }


@dataclass(frozen=True, slots=True)
class CoordinatorSnapshot:
    state_epoch: int
    active_generation: MigrationGeneration
    candidate_generation: MigrationGeneration | None
    prior_generations: tuple[MigrationGeneration, ...]
    generation_digests: Mapping[str, str]
    requests: Mapping[str, CutoverRequest]
    approvals: Mapping[str, CutoverApproval]
    approval_consumptions: Mapping[str, str]
    receipts: Mapping[str, CutoverReceipt]
    events: tuple[CutoverEvent, ...]

    def to_document(self) -> dict[str, object]:
        return {
            "stateEpoch": self.state_epoch,
            "activeGeneration": {
                "id": self.active_generation.generation_id,
                "sha256": self.active_generation.generation_sha256,
            },
            "candidateGeneration": (
                {
                    "id": self.candidate_generation.generation_id,
                    "sha256": self.candidate_generation.generation_sha256,
                }
                if self.candidate_generation
                else None
            ),
            "priorGenerations": [
                {"id": item.generation_id, "sha256": item.generation_sha256}
                for item in self.prior_generations
            ],
            "knownGenerations": [
                {"id": generation_id, "sha256": digest}
                for generation_id, digest in sorted(self.generation_digests.items())
            ],
            "counts": {
                "requests": len(self.requests),
                "approvals": len(self.approvals),
                "approvalConsumptions": len(self.approval_consumptions),
                "receipts": len(self.receipts),
                "events": len(self.events),
            },
        }


class CommitStep(StrEnum):
    REQUEST_RECORDED = "request_recorded"
    APPROVAL_RECORDED = "approval_recorded"
    APPROVAL_CONSUMED = "approval_consumed"
    RECEIPT_RECORDED = "receipt_recorded"
    EVENT_RECORDED = "event_recorded"
    BEFORE_PUBLICATION = "before_publication"


class PostPublicationResponseLost(RuntimeError):
    """The process-local commit completed before its response was observed."""


class StaleCandidateStage(RuntimeError):
    """The candidate stage was formed from an older coordinator epoch."""


class CandidateIdentityConflict(ValueError):
    """A generation identity already names different canonical content."""


class CandidateRoleConflict(ValueError):
    """A retained active or prior generation cannot become a new candidate."""


CommitProbe = Callable[[CommitStep], None]
EntryProbe = Callable[[], None]
PostPublicationProbe = Callable[[CutoverReceipt], None]


def _no_commit_probe(step: CommitStep) -> None:
    del step


def _no_entry_probe() -> None:
    return None


def _no_post_publication_probe(receipt: CutoverReceipt) -> None:
    del receipt


class MigrationCoordinator:
    """One-instance reference model for approval-bound cutover."""

    def __init__(
        self,
        *,
        migration_id: str,
        active_generation: MigrationGeneration,
        clock: Callable[[], datetime] | None = None,
        commit_probe: CommitProbe = _no_commit_probe,
        entry_probe: EntryProbe = _no_entry_probe,
        post_publication_probe: PostPublicationProbe = _no_post_publication_probe,
    ) -> None:
        self.migration_id = _require_text("migration_id", migration_id)
        if not isinstance(active_generation, MigrationGeneration):
            raise ValueError("active_generation requires a MigrationGeneration")
        self._clock = clock or (lambda: datetime.now(UTC))
        self._commit_probe = commit_probe
        self._entry_probe = entry_probe
        self._post_publication_probe = post_publication_probe
        self._lock = RLock()
        self._state = CoordinatorSnapshot(
            state_epoch=0,
            active_generation=active_generation,
            candidate_generation=None,
            prior_generations=(),
            generation_digests=_freeze_map(
                {active_generation.generation_id: active_generation.generation_sha256}
            ),
            requests=_freeze_map({}),
            approvals=_freeze_map({}),
            approval_consumptions=_freeze_map({}),
            receipts=_freeze_map({}),
            events=(),
        )

    def snapshot(self) -> CoordinatorSnapshot:
        with self._lock:
            return self._state

    def stage_candidate(
        self,
        candidate: MigrationGeneration,
        *,
        expected_state_epoch: int,
    ) -> int:
        if not isinstance(candidate, MigrationGeneration):
            raise ValueError("candidate requires a MigrationGeneration")
        _require_nonnegative_integer("expected_state_epoch", expected_state_epoch)
        with self._lock:
            current = self._state
            if current.candidate_generation == candidate:
                if expected_state_epoch in (current.state_epoch, current.state_epoch - 1):
                    return current.state_epoch
                raise StaleCandidateStage(
                    "candidate replay requires its source or current state epoch"
                )
            if expected_state_epoch != current.state_epoch:
                raise StaleCandidateStage(
                    f"candidate stage expected epoch {expected_state_epoch}; "
                    f"current epoch is {current.state_epoch}"
                )
            recorded_digest = current.generation_digests.get(candidate.generation_id)
            if recorded_digest is not None and recorded_digest != candidate.generation_sha256:
                raise CandidateIdentityConflict(
                    "candidate generation identity already names different canonical content"
                )
            retained_ids = {
                current.active_generation.generation_id,
                *(generation.generation_id for generation in current.prior_generations),
            }
            if candidate.generation_id in retained_ids:
                raise CandidateRoleConflict(
                    "candidate generation identity already has an active or prior role"
                )
            generation_digests = dict(current.generation_digests)
            generation_digests[candidate.generation_id] = candidate.generation_sha256
            self._state = CoordinatorSnapshot(
                state_epoch=current.state_epoch + 1,
                active_generation=current.active_generation,
                candidate_generation=candidate,
                prior_generations=current.prior_generations,
                generation_digests=_freeze_map(generation_digests),
                requests=current.requests,
                approvals=current.approvals,
                approval_consumptions=current.approval_consumptions,
                receipts=current.receipts,
                events=current.events,
            )
            return self._state.state_epoch

    def reconcile(self) -> ReconciliationReport:
        with self._lock:
            state = self._state
            candidate = state.candidate_generation
            if candidate is None:
                raise ValueError("reconciliation requires a staged candidate generation")
            active = state.active_generation
            epoch = state.state_epoch
        return reconcile_generations(
            migration_id=self.migration_id,
            state_epoch=epoch,
            active_generation=active,
            source_generation=active,
            candidate_generation=candidate,
        )

    def prepare_cutover(
        self,
        *,
        request_id: str,
        approval_id: str,
        actor_id: str,
        restore_evidence: RestoreEvidence,
        requested_at: datetime,
    ) -> CutoverPlan:
        report = self.reconcile()
        request = CutoverRequest(
            request_id=request_id,
            approval_id=approval_id,
            migration_id=self.migration_id,
            actor_id=actor_id,
            expected_state_epoch=report.state_epoch,
            expected_active_generation_id=report.active_generation_id,
            expected_active_generation_sha256=report.active_generation_sha256,
            source_generation_id=report.source_generation_id,
            source_generation_sha256=report.source_generation_sha256,
            candidate_generation_id=report.candidate_generation_id,
            candidate_generation_sha256=report.candidate_generation_sha256,
            report_sha256=report.report_sha256,
            restore_evidence_sha256=restore_evidence.evidence_sha256,
            requested_at=requested_at,
        )
        return CutoverPlan(report=report, restore_evidence=restore_evidence, request=request)

    def _return(
        self,
        *,
        status: CutoverStatus,
        reason: CutoverReason,
        recovery: str,
        changed_fields: tuple[str, ...] = (),
        recorded_fingerprint: str | None = None,
        candidate_fingerprint: str | None = None,
    ) -> CutoverDecision:
        return CutoverDecision(
            status=status,
            reason_code=reason,
            recovery=recovery,
            changed_fields=changed_fields,
            recorded_fingerprint=recorded_fingerprint,
            candidate_fingerprint=candidate_fingerprint,
        )

    def cutover(
        self,
        plan: CutoverPlan,
        approval: CutoverApproval,
    ) -> CutoverDecision:
        self._entry_probe()
        with self._lock:
            current = self._state
            request = plan.request
            request_fingerprint = request.request_fingerprint
            recorded_request = current.requests.get(request.request_id)
            recorded_receipt = current.receipts.get(request.request_id)

            # TARGET: an exact completed request-and-approval pair resolves before renewed time evaluation.
            if recorded_receipt is not None and recorded_request is not None:
                if recorded_receipt.request_fingerprint == request_fingerprint:
                    if recorded_receipt.approval_fingerprint != approval.approval_fingerprint:
                        recorded_approval = current.approvals.get(recorded_receipt.approval_id)
                        changed_fields = (
                            _changed_fields(
                                recorded_approval.to_document(),
                                approval.to_document(),
                            )
                            if recorded_approval is not None
                            else ()
                        )
                        return self._return(
                            status=CutoverStatus.DENIED,
                            reason=CutoverReason.APPROVAL_RECORD_CHANGED,
                            recovery="reuse the exact approval record bound to the completed cutover",
                            changed_fields=changed_fields,
                            recorded_fingerprint=recorded_receipt.approval_fingerprint,
                            candidate_fingerprint=approval.approval_fingerprint,
                        )
                    return CutoverDecision(
                        status=CutoverStatus.REPLAYED,
                        reason_code=None,
                        recovery="reuse the recorded cutover receipt",
                        receipt=recorded_receipt,
                    )
                return self._return(
                    status=CutoverStatus.RETURN_FOR_EVIDENCE,
                    reason=CutoverReason.REQUEST_IDENTITY_REUSED,
                    recovery="issue a new request identity for the changed cutover meaning",
                    changed_fields=_changed_fields(
                        recorded_request.to_document(), request.to_document()
                    ),
                    recorded_fingerprint=recorded_receipt.request_fingerprint,
                    candidate_fingerprint=request_fingerprint,
                )

            consumed_by = current.approval_consumptions.get(approval.approval_id)
            if consumed_by is not None and consumed_by != request_fingerprint:
                return self._return(
                    status=CutoverStatus.DENIED,
                    reason=CutoverReason.APPROVAL_IDENTITY_REUSED,
                    recovery="obtain approval with a new identity from an eligible approver distinct from the actor",
                    recorded_fingerprint=consumed_by,
                    candidate_fingerprint=request_fingerprint,
                )

            observed_at = _require_aware_utc("clock", self._clock())
            approval_scope = {
                "approval_id": (approval.approval_id, request.approval_id),
                "request_id": (approval.request_id, request.request_id),
                "request_fingerprint": (
                    approval.request_fingerprint,
                    request_fingerprint,
                ),
                "report_sha256": (approval.report_sha256, request.report_sha256),
                "operation_name": (approval.operation_name, request.operation_name),
                "operation_version": (
                    approval.operation_version,
                    request.operation_version,
                ),
                "operation_contract": (
                    approval.operation_contract,
                    request.operation_contract,
                ),
                "actor_id": (approval.actor_id, request.actor_id),
            }
            scope_changes = tuple(
                sorted(name for name, values in approval_scope.items() if values[0] != values[1])
            )
            if scope_changes:
                return self._return(
                    status=CutoverStatus.DENIED,
                    reason=CutoverReason.APPROVAL_SCOPE_MISMATCH,
                    recovery="obtain approval for the exact current cutover request",
                    changed_fields=scope_changes,
                    recorded_fingerprint=approval.request_fingerprint,
                    candidate_fingerprint=request_fingerprint,
                )
            if approval.approved_at < request.requested_at:
                return self._return(
                    status=CutoverStatus.DENIED,
                    reason=CutoverReason.APPROVAL_PRECEDES_REQUEST,
                    recovery="approve the exact request after its complete evidence packet exists",
                )
            if approval.revoked_at is not None and observed_at >= approval.revoked_at:
                return self._return(
                    status=CutoverStatus.DENIED,
                    reason=CutoverReason.APPROVAL_REVOKED,
                    recovery="obtain a current approval from an eligible approver distinct from the actor",
                )
            if observed_at < approval.approved_at:
                return self._return(
                    status=CutoverStatus.DENIED,
                    reason=CutoverReason.APPROVAL_NOT_YET_ACTIVE,
                    recovery="evaluate the request during its approved time window",
                )
            if observed_at >= approval.expires_at:
                return self._return(
                    status=CutoverStatus.DENIED,
                    reason=CutoverReason.APPROVAL_EXPIRED,
                    recovery="obtain current approval for the reconciled request from an eligible approver distinct from the actor",
                )

            candidate = current.candidate_generation
            stale = (
                request.migration_id != self.migration_id
                or request.expected_state_epoch != current.state_epoch
                or request.expected_active_generation_id != current.active_generation.generation_id
                or request.expected_active_generation_sha256
                != current.active_generation.generation_sha256
                or candidate is None
                or request.candidate_generation_id != candidate.generation_id
                or request.candidate_generation_sha256 != candidate.generation_sha256
            )
            if stale:
                return self._return(
                    status=CutoverStatus.RETURN_FOR_EVIDENCE,
                    reason=CutoverReason.STALE_STATE,
                    recovery="reconcile the current active and candidate generations, then request matching approval",
                )

            current_report = reconcile_generations(
                migration_id=self.migration_id,
                state_epoch=current.state_epoch,
                active_generation=current.active_generation,
                source_generation=current.active_generation,
                candidate_generation=candidate,
            )
            if current_report.report_sha256 != plan.report.report_sha256:
                return self._return(
                    status=CutoverStatus.RETURN_FOR_EVIDENCE,
                    reason=CutoverReason.STALE_STATE,
                    recovery="review the current reconciliation report and request matching approval",
                    recorded_fingerprint=plan.report.report_sha256,
                    candidate_fingerprint=current_report.report_sha256,
                )
            if not current_report.ready_for_approval:
                return self._return(
                    status=CutoverStatus.RETURN_FOR_EVIDENCE,
                    reason=CutoverReason.REPORT_NOT_READY,
                    recovery="resolve each missing, divergent, and extra identity, then reconcile again",
                )
            if not plan.restore_evidence.verified:
                return self._return(
                    status=CutoverStatus.RETURN_FOR_EVIDENCE,
                    reason=CutoverReason.RESTORE_NOT_VERIFIED,
                    recovery="supply a matching restore observation with distinct declared operator and witness identifiers and met objectives",
                )

            committed_epoch = current.state_epoch + 1
            event_id = "cutover-event:" + _digest(
                {
                    "migrationId": self.migration_id,
                    "requestId": request.request_id,
                }
            )
            receipt = CutoverReceipt(
                migration_id=self.migration_id,
                event_id=event_id,
                request_id=request.request_id,
                request_fingerprint=request_fingerprint,
                approval_id=approval.approval_id,
                approval_fingerprint=approval.approval_fingerprint,
                report_sha256=current_report.report_sha256,
                restore_evidence_sha256=plan.restore_evidence.evidence_sha256,
                prior_generation_id=current.active_generation.generation_id,
                prior_generation_sha256=current.active_generation.generation_sha256,
                accepted_generation_id=candidate.generation_id,
                accepted_generation_sha256=candidate.generation_sha256,
                prior_state_epoch=current.state_epoch,
                committed_state_epoch=committed_epoch,
                actor_id=request.actor_id,
                approved_by=approval.approved_by,
                committed_at=observed_at,
                operation_name=request.operation_name,
                operation_version=request.operation_version,
                operation_contract=request.operation_contract,
            )
            event = CutoverEvent(
                event_id=event_id,
                migration_id=self.migration_id,
                request_id=request.request_id,
                receipt_sha256=receipt.receipt_sha256,
                prior_generation_id=current.active_generation.generation_id,
                accepted_generation_id=candidate.generation_id,
                committed_state_epoch=committed_epoch,
                committed_at=observed_at,
            )

            # GUARD: every effect is detached until one state-reference publication.
            requests = dict(current.requests)
            requests[request.request_id] = request
            self._commit_probe(CommitStep.REQUEST_RECORDED)
            approvals = dict(current.approvals)
            approvals[approval.approval_id] = approval
            self._commit_probe(CommitStep.APPROVAL_RECORDED)
            consumptions = dict(current.approval_consumptions)
            consumptions[approval.approval_id] = request_fingerprint
            self._commit_probe(CommitStep.APPROVAL_CONSUMED)
            receipts = dict(current.receipts)
            receipts[request.request_id] = receipt
            self._commit_probe(CommitStep.RECEIPT_RECORDED)
            events = (*current.events, event)
            self._commit_probe(CommitStep.EVENT_RECORDED)
            candidate_state = CoordinatorSnapshot(
                state_epoch=committed_epoch,
                active_generation=candidate,
                candidate_generation=None,
                prior_generations=(*current.prior_generations, current.active_generation),
                generation_digests=current.generation_digests,
                requests=_freeze_map(requests),
                approvals=_freeze_map(approvals),
                approval_consumptions=_freeze_map(consumptions),
                receipts=_freeze_map(receipts),
                events=events,
            )
            self._commit_probe(CommitStep.BEFORE_PUBLICATION)
            if self._state is not current:
                return self._return(
                    status=CutoverStatus.RETURN_FOR_EVIDENCE,
                    reason=CutoverReason.STALE_STATE,
                    recovery="reconcile the state published during cutover preparation",
                )
            self._state = candidate_state
            decision = CutoverDecision(
                status=CutoverStatus.ACTIVATED,
                reason_code=None,
                recovery="retain the prior generation and use the exact original request-and-approval pair to replay the recorded receipt",
                receipt=receipt,
            )

        # CONTRAST: response delivery follows commit and does not retain the state lock.
        self._post_publication_probe(receipt)
        return decision


def _fixture_object(name: str, value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{name} requires an object")
    return value


def _fixture_text(name: str, value: object) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{name} requires text")
    return value


def _fixture_positive_integer(name: str, value: object) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise ValueError(f"{name} requires a positive integer")
    return value


def _fixture_number(name: str, value: object) -> float:
    return _require_nonnegative_number(name, value)


def _record_from_document(value: object) -> MigrationRecord:
    record = _fixture_object("fixture record", value)
    payload = record.get("payload")
    if not isinstance(payload, dict):
        raise ValueError("fixture record payload requires an object")
    artifact = record.get("artifactSha256")
    if artifact is not None and not isinstance(artifact, str):
        raise ValueError("fixture record artifactSha256 requires text or null")
    return MigrationRecord(
        tenant_id=_fixture_text("fixture record tenantId", record.get("tenantId")),
        canonical_identity=_fixture_text(
            "fixture record canonicalIdentity",
            record.get("canonicalIdentity"),
        ),
        revision=_fixture_positive_integer(
            "fixture record revision",
            record.get("revision"),
        ),
        payload=payload,
        artifact_sha256=artifact,
    )


def _generation_from_document(value: object) -> MigrationGeneration:
    generation = _fixture_object("fixture generation", value)
    records = generation.get("records")
    if not isinstance(records, list):
        raise ValueError("fixture generation records require a list")
    return MigrationGeneration(
        generation_id=_fixture_text(
            "fixture generation generationId",
            generation.get("generationId"),
        ),
        records=tuple(_record_from_document(record) for record in records),
    )


def _instant(value: object) -> datetime:
    if not isinstance(value, str):
        raise ValueError("fixture instant requires ISO-8601 text")
    return _require_aware_utc("fixture instant", datetime.fromisoformat(value))


def _load_object(path: Path) -> dict[str, object]:
    value = json.loads(path.read_bytes())
    if not isinstance(value, dict):
        raise ValueError("fixture requires one JSON object")
    return value


def run_fixture(reconciled_path: Path, returned_path: Path) -> dict[str, object]:
    reconciled = _load_object(reconciled_path)
    returned = _load_object(returned_path)
    active = _generation_from_document(reconciled.get("activeGeneration"))
    candidate = _generation_from_document(reconciled.get("candidateGeneration"))
    restored = _generation_from_document(reconciled.get("restoredGeneration"))
    request_values = _fixture_object("fixture request", reconciled.get("request"))
    restore_values = _fixture_object("fixture restore", reconciled.get("restore"))
    approval_values = _fixture_object("fixture approval", reconciled.get("approval"))
    clock_state = {"now": _instant(reconciled.get("evaluatedAt"))}
    coordinator = MigrationCoordinator(
        migration_id=_fixture_text("fixture migrationId", reconciled.get("migrationId")),
        active_generation=active,
        clock=lambda: clock_state["now"],
    )
    coordinator.stage_candidate(candidate, expected_state_epoch=0)
    restore = RestoreEvidence.observe(
        restore_id=_fixture_text("fixture restoreId", restore_values.get("restoreId")),
        source=active,
        restored=restored,
        observed_rto_seconds=_fixture_number(
            "fixture observedRtoSeconds",
            restore_values.get("observedRtoSeconds"),
        ),
        observed_rpo_seconds=_fixture_number(
            "fixture observedRpoSeconds",
            restore_values.get("observedRpoSeconds"),
        ),
        rto_objective_seconds=_fixture_number(
            "fixture rtoObjectiveSeconds",
            restore_values.get("rtoObjectiveSeconds"),
        ),
        rpo_objective_seconds=_fixture_number(
            "fixture rpoObjectiveSeconds",
            restore_values.get("rpoObjectiveSeconds"),
        ),
        operator_id=_fixture_text(
            "fixture restore operatorId",
            restore_values.get("operatorId"),
        ),
        witness_id=_fixture_text(
            "fixture restore witnessId",
            restore_values.get("witnessId"),
        ),
        completed_at=_instant(restore_values.get("completedAt")),
    )
    plan = coordinator.prepare_cutover(
        request_id=_fixture_text("fixture requestId", request_values.get("requestId")),
        approval_id=_fixture_text("fixture approvalId", request_values.get("approvalId")),
        actor_id=_fixture_text("fixture actorId", request_values.get("actorId")),
        restore_evidence=restore,
        requested_at=_instant(request_values.get("requestedAt")),
    )
    approval = CutoverApproval.for_request(
        plan.request,
        approved_by=_fixture_text(
            "fixture approvedBy",
            approval_values.get("approvedBy"),
        ),
        approved_at=_instant(approval_values.get("approvedAt")),
        expires_at=_instant(approval_values.get("expiresAt")),
    )
    activated = coordinator.cutover(plan, approval)
    clock_state["now"] = _instant(reconciled.get("replayedAt"))
    replayed = coordinator.cutover(plan, approval)

    returned_candidate = _generation_from_document(returned.get("candidateGeneration"))
    returned_clock = _instant(reconciled.get("evaluatedAt"))
    returned_coordinator = MigrationCoordinator(
        migration_id=_fixture_text("fixture migrationId", reconciled.get("migrationId")),
        active_generation=active,
        clock=lambda: returned_clock,
    )
    returned_coordinator.stage_candidate(returned_candidate, expected_state_epoch=0)
    returned_plan = returned_coordinator.prepare_cutover(
        request_id=_fixture_text("fixture returned requestId", returned.get("requestId")),
        approval_id=_fixture_text(
            "fixture returned approvalId",
            returned.get("approvalId"),
        ),
        actor_id=_fixture_text("fixture actorId", request_values.get("actorId")),
        restore_evidence=restore,
        requested_at=_instant(request_values.get("requestedAt")),
    )
    returned_approval = CutoverApproval.for_request(
        returned_plan.request,
        approved_by=_fixture_text(
            "fixture approvedBy",
            approval_values.get("approvedBy"),
        ),
        approved_at=_instant(approval_values.get("approvedAt")),
        expires_at=_instant(approval_values.get("expiresAt")),
    )
    returned_decision = returned_coordinator.cutover(returned_plan, returned_approval)
    committed_event = coordinator.snapshot().events[-1]

    return {
        "reconciliation": {
            **plan.report.to_document(),
            "reportSha256": plan.report.report_sha256,
        },
        "restore": {
            **restore.to_document(),
            "evidenceSha256": restore.evidence_sha256,
        },
        "request": {
            **plan.request.to_document(),
            "requestFingerprint": plan.request.request_fingerprint,
        },
        "approval": {
            **approval.to_document(),
            "approvalFingerprint": approval.approval_fingerprint,
        },
        "activation": activated.to_document(),
        "event": committed_event.to_document(),
        "replay": replayed.to_document(),
        "returnedForEvidence": {
            "report": {
                **returned_plan.report.to_document(),
                "reportSha256": returned_plan.report.report_sha256,
            },
            "decision": returned_decision.to_document(),
            "state": returned_coordinator.snapshot().to_document(),
        },
        "finalState": coordinator.snapshot().to_document(),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reconciled_fixture", type=Path)
    parser.add_argument("returned_for_evidence_fixture", type=Path)
    args = parser.parse_args(argv)
    result = run_fixture(args.reconciled_fixture, args.returned_for_evidence_fixture)
    print(json.dumps(result, indent=2, sort_keys=True, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
