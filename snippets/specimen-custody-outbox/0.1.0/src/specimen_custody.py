"""Replay-safe specimen custody and transactional outbox conformance model.

The repository holds one immutable accepted snapshot. A transfer prepares its
custody state, event, outbox message, and replay record in private working
maps, then publishes all four through one process-local state swap.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from threading import RLock
from types import MappingProxyType
from typing import Any

TRANSFER_CAPABILITY = "transfer_specimen"
DEFAULT_ROLE_CAPABILITIES: Mapping[str, frozenset[str]] = MappingProxyType(
    {
        "custody_coordinator": frozenset({TRANSFER_CAPABILITY}),
        "laboratory_observer": frozenset(),
    }
)


def _require_text(value: str, label: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must contain text")


def _canonical_json(value: Mapping[str, Any]) -> bytes:
    return json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def _utc_text(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("aware_at must carry an explicit UTC offset")
    return (
        value.astimezone(UTC)
        .isoformat(timespec="microseconds")
        .replace(
            "+00:00",
            "Z",
        )
    )


@dataclass(frozen=True, slots=True)
class ActorContext:
    """Trusted execution context resolved before the domain operation."""

    tenant_id: str
    actor_id: str
    role: str

    def __post_init__(self) -> None:
        _require_text(self.tenant_id, "tenant_id")
        _require_text(self.actor_id, "actor_id")
        _require_text(self.role, "role")


@dataclass(frozen=True, slots=True)
class TransferCommand:
    """Complete attributable meaning assigned to one transfer identity."""

    transfer_id: str
    tenant_id: str
    specimen_id: str
    actor_id: str
    actor_role: str
    reason: str
    aware_at: datetime
    current_source: str
    expected_version: int
    destination: str
    payload: bytes

    def __post_init__(self) -> None:
        for field_name in (
            "transfer_id",
            "tenant_id",
            "specimen_id",
            "actor_id",
            "actor_role",
            "reason",
            "current_source",
            "destination",
        ):
            _require_text(getattr(self, field_name), field_name)
        _utc_text(self.aware_at)
        if not isinstance(self.expected_version, int) or isinstance(
            self.expected_version,
            bool,
        ):
            raise ValueError("expected_version must be an integer")
        if self.expected_version < 0:
            raise ValueError("expected_version must be zero or greater")
        if self.current_source == self.destination:
            raise ValueError("destination must identify a new custody position")
        payload = bytes(self.payload)
        decoded_payload = json.loads(payload)
        if not isinstance(decoded_payload, dict):
            raise ValueError("payload must encode one JSON object")
        if _canonical_json(decoded_payload) != payload:
            raise ValueError("payload must use the canonical JSON encoding")
        object.__setattr__(self, "payload", payload)

    @classmethod
    def capture(
        cls,
        *,
        payload: Mapping[str, Any],
        **fields: Any,
    ) -> TransferCommand:
        """Snapshot a JSON-object payload before the command enters the repository."""

        return cls(payload=_canonical_json(payload), **fields)

    def canonical_fields(self) -> dict[str, object]:
        """Return every field that gives this transfer identity its meaning."""

        return {
            "actorId": self.actor_id,
            "actorRole": self.actor_role,
            "awareAt": _utc_text(self.aware_at),
            "currentSource": self.current_source,
            "destination": self.destination,
            "expectedVersion": self.expected_version,
            "reason": self.reason,
            "specimenId": self.specimen_id,
            "tenantId": self.tenant_id,
            "transferId": self.transfer_id,
            "payload": json.loads(self.payload),
        }

    @property
    def fingerprint(self) -> str:
        return hashlib.sha256(_canonical_json(self.canonical_fields())).hexdigest()


@dataclass(frozen=True, slots=True)
class CustodyRecord:
    specimen_id: str
    tenant_id: str
    current_source: str
    version: int

    def __post_init__(self) -> None:
        _require_text(self.specimen_id, "specimen_id")
        _require_text(self.tenant_id, "tenant_id")
        _require_text(self.current_source, "current_source")
        if not isinstance(self.version, int) or isinstance(self.version, bool):
            raise ValueError("version must be an integer")
        if self.version < 0:
            raise ValueError("version must be zero or greater")


@dataclass(frozen=True, slots=True)
class CustodyEvent:
    event_id: str
    transfer_id: str
    tenant_id: str
    specimen_id: str
    actor_id: str
    actor_role: str
    reason: str
    aware_at: str
    prior_source: str
    destination: str
    prior_version: int
    accepted_version: int
    command_fingerprint: str


@dataclass(frozen=True, slots=True)
class OutboxMessage:
    message_id: str
    tenant_id: str
    topic: str
    payload: bytes

    def __post_init__(self) -> None:
        _require_text(self.message_id, "message_id")
        _require_text(self.tenant_id, "tenant_id")
        _require_text(self.topic, "topic")
        payload = bytes(self.payload)
        decoded_payload = json.loads(payload)
        if not isinstance(decoded_payload, dict):
            raise ValueError("outbox payload must encode one JSON object")
        if _canonical_json(decoded_payload) != payload:
            raise ValueError("outbox payload must use the canonical JSON encoding")
        object.__setattr__(self, "payload", payload)

    @property
    def content_sha256(self) -> str:
        return hashlib.sha256(self.payload).hexdigest()


@dataclass(frozen=True, slots=True)
class TransferReceipt:
    command_fingerprint: str
    custody: CustodyRecord
    event: CustodyEvent
    outbox: OutboxMessage


@dataclass(frozen=True, slots=True)
class TransferRecord:
    tenant_id: str
    transfer_id: str
    command_fingerprint: str
    command: TransferCommand
    receipt: TransferReceipt


class TransferStatus(StrEnum):
    APPLIED = "applied"
    REPLAYED = "replayed"
    RECONCILIATION_REQUIRED = "reconciliation_required"


class ReconciliationReason(StrEnum):
    TENANT_CONTEXT_MISMATCH = "tenant_context_mismatch"
    ACTOR_CONTEXT_MISMATCH = "actor_context_mismatch"
    TRANSFER_IDENTITY_REUSED = "transfer_identity_reused"
    CAPABILITY_REQUIRED = "capability_required"
    CUSTODY_UNAVAILABLE = "custody_unavailable"
    STALE_VERSION = "stale_version"
    STALE_SOURCE = "stale_source"
    OUTBOX_IDENTITY_OCCUPIED = "outbox_identity_occupied"
    OUTBOX_CONTENT_COLLISION = "outbox_content_collision"


@dataclass(frozen=True, slots=True)
class TransferDecision:
    status: TransferStatus
    transfer_id: str
    receipt: TransferReceipt | None = None
    reason: ReconciliationReason | None = None
    changed_fields: tuple[str, ...] = ()
    recorded_fingerprint: str | None = None
    candidate_fingerprint: str | None = None

    def __post_init__(self) -> None:
        successful = self.status in {TransferStatus.APPLIED, TransferStatus.REPLAYED}
        if successful != (self.receipt is not None):
            raise ValueError("successful decisions require one transfer receipt")
        if (self.status is TransferStatus.RECONCILIATION_REQUIRED) != (self.reason is not None):
            raise ValueError("reconciliation decisions require one reason")
        identity_reused = self.reason is ReconciliationReason.TRANSFER_IDENTITY_REUSED
        has_any_comparison = bool(
            self.changed_fields
            or self.recorded_fingerprint is not None
            or self.candidate_fingerprint is not None
        )
        has_complete_comparison = bool(
            self.changed_fields and self.recorded_fingerprint and self.candidate_fingerprint
        )
        if (identity_reused and not has_complete_comparison) or (
            not identity_reused and has_any_comparison
        ):
            raise ValueError("changed transfer meaning requires fields and both fingerprints")


class CommitStep(StrEnum):
    CUSTODY_WRITE = "custody_write"
    EVENT_WRITE = "event_write"
    OUTBOX_WRITE = "outbox_write"
    REPLAY_RECORD_WRITE = "replay_record_write"


@dataclass(frozen=True, slots=True)
class RepositorySnapshot:
    custody: tuple[CustodyRecord, ...]
    events: tuple[CustodyEvent, ...]
    outbox: tuple[OutboxMessage, ...]
    transfers: tuple[TransferRecord, ...]


@dataclass(frozen=True, slots=True)
class _RepositoryState:
    custody: Mapping[tuple[str, str], CustodyRecord]
    events: Mapping[tuple[str, str], CustodyEvent]
    outbox: Mapping[tuple[str, str], OutboxMessage]
    transfers: Mapping[tuple[str, str], TransferRecord]


def _unique_map[T, K](
    values: Iterable[T],
    key_for: Callable[[T], K],
    label: str,
) -> Mapping[K, T]:
    result: dict[K, T] = {}
    for value in values:
        key = key_for(value)
        if key in result:
            raise ValueError(f"{label} repeats identity {key!r}")
        result[key] = value
    return MappingProxyType(result)


def _frozen_state(
    *,
    custody: Mapping[tuple[str, str], CustodyRecord],
    events: Mapping[tuple[str, str], CustodyEvent],
    outbox: Mapping[tuple[str, str], OutboxMessage],
    transfers: Mapping[tuple[str, str], TransferRecord],
) -> _RepositoryState:
    return _RepositoryState(
        custody=MappingProxyType(dict(custody)),
        events=MappingProxyType(dict(events)),
        outbox=MappingProxyType(dict(outbox)),
        transfers=MappingProxyType(dict(transfers)),
    )


class InMemorySpecimenCustody:
    """Process-local conformance model with one copy-on-write commit point."""

    def __init__(
        self,
        custody: Iterable[CustodyRecord],
        *,
        outbox: Iterable[OutboxMessage] = (),
        role_capabilities: Mapping[str, frozenset[str]] = DEFAULT_ROLE_CAPABILITIES,
    ) -> None:
        self._lock = RLock()
        self._transfer_in_progress = False
        self._role_capabilities = MappingProxyType(
            {role: frozenset(capabilities) for role, capabilities in role_capabilities.items()}
        )
        self._state = _RepositoryState(
            custody=_unique_map(
                custody,
                lambda record: (record.tenant_id, record.specimen_id),
                "custody",
            ),
            events=MappingProxyType({}),
            outbox=_unique_map(
                outbox,
                lambda message: (message.tenant_id, message.message_id),
                "outbox",
            ),
            transfers=MappingProxyType({}),
        )

    def snapshot(self) -> RepositorySnapshot:
        """Return a detached, deterministic view of the accepted state."""

        with self._lock:
            state = self._state
            return RepositorySnapshot(
                custody=tuple(state.custody[key] for key in sorted(state.custody)),
                events=tuple(state.events[key] for key in sorted(state.events)),
                outbox=tuple(state.outbox[key] for key in sorted(state.outbox)),
                transfers=tuple(state.transfers[key] for key in sorted(state.transfers)),
            )

    @staticmethod
    def _reconciliation(
        command: TransferCommand,
        reason: ReconciliationReason,
        *,
        changed_fields: tuple[str, ...] = (),
        recorded_fingerprint: str | None = None,
    ) -> TransferDecision:
        return TransferDecision(
            status=TransferStatus.RECONCILIATION_REQUIRED,
            transfer_id=command.transfer_id,
            reason=reason,
            changed_fields=changed_fields,
            recorded_fingerprint=recorded_fingerprint,
            candidate_fingerprint=(command.fingerprint if changed_fields else None),
        )

    @staticmethod
    def _changed_fields(
        recorded: TransferCommand,
        candidate: TransferCommand,
    ) -> tuple[str, ...]:
        recorded_fields = recorded.canonical_fields()
        candidate_fields = candidate.canonical_fields()
        return tuple(
            field
            for field in sorted(recorded_fields)
            if _canonical_json({"value": recorded_fields[field]})
            != _canonical_json({"value": candidate_fields[field]})
        )

    def transfer(
        self,
        command: TransferCommand,
        actor: ActorContext,
        *,
        fault_injector: Callable[[CommitStep], None] | None = None,
    ) -> TransferDecision:
        """Apply, replay, or reconcile one attributable custody transfer."""

        with self._lock:
            if self._transfer_in_progress:
                raise RuntimeError("one repository instance accepts one transfer call at a time")
            self._transfer_in_progress = True
            try:
                return self._transfer_locked(command, actor, fault_injector)
            finally:
                self._transfer_in_progress = False

    def _transfer_locked(
        self,
        command: TransferCommand,
        actor: ActorContext,
        fault_injector: Callable[[CommitStep], None] | None,
    ) -> TransferDecision:
        state = self._state

        if actor.tenant_id != command.tenant_id:
            return self._reconciliation(
                command,
                ReconciliationReason.TENANT_CONTEXT_MISMATCH,
            )
        if actor.actor_id != command.actor_id or actor.role != command.actor_role:
            return self._reconciliation(
                command,
                ReconciliationReason.ACTOR_CONTEXT_MISMATCH,
            )

        capabilities = self._role_capabilities.get(actor.role, frozenset())
        if TRANSFER_CAPABILITY not in capabilities:
            return self._reconciliation(
                command,
                ReconciliationReason.CAPABILITY_REQUIRED,
            )

        transfer_key = (command.tenant_id, command.transfer_id)
        prior_transfer = state.transfers.get(transfer_key)

        # GUARD: one tenant-scoped transfer identity keeps one complete command meaning.
        if prior_transfer is not None:
            if prior_transfer.command_fingerprint == command.fingerprint:
                return TransferDecision(
                    status=TransferStatus.REPLAYED,
                    transfer_id=command.transfer_id,
                    receipt=prior_transfer.receipt,
                )
            return self._reconciliation(
                command,
                ReconciliationReason.TRANSFER_IDENTITY_REUSED,
                changed_fields=self._changed_fields(prior_transfer.command, command),
                recorded_fingerprint=prior_transfer.command_fingerprint,
            )

        custody_key = (command.tenant_id, command.specimen_id)
        accepted = state.custody.get(custody_key)
        if accepted is None:
            return self._reconciliation(
                command,
                ReconciliationReason.CUSTODY_UNAVAILABLE,
            )
        if accepted.version != command.expected_version:
            return self._reconciliation(command, ReconciliationReason.STALE_VERSION)
        if accepted.current_source != command.current_source:
            return self._reconciliation(command, ReconciliationReason.STALE_SOURCE)

        successor = CustodyRecord(
            specimen_id=accepted.specimen_id,
            tenant_id=accepted.tenant_id,
            current_source=command.destination,
            version=accepted.version + 1,
        )
        event_id = f"custody-transfer:{command.transfer_id}"
        event = CustodyEvent(
            event_id=event_id,
            transfer_id=command.transfer_id,
            tenant_id=command.tenant_id,
            specimen_id=command.specimen_id,
            actor_id=command.actor_id,
            actor_role=command.actor_role,
            reason=command.reason,
            aware_at=_utc_text(command.aware_at),
            prior_source=accepted.current_source,
            destination=successor.current_source,
            prior_version=accepted.version,
            accepted_version=successor.version,
            command_fingerprint=command.fingerprint,
        )
        payload = _canonical_json(
            {
                "acceptedVersion": event.accepted_version,
                "actor": {"id": event.actor_id, "role": event.actor_role},
                "awareAt": event.aware_at,
                "commandFingerprint": event.command_fingerprint,
                "destination": event.destination,
                "eventId": event.event_id,
                "eventType": "specimen.custody.transferred.v1",
                "priorSource": event.prior_source,
                "priorVersion": event.prior_version,
                "reason": event.reason,
                "payload": json.loads(command.payload),
                "specimenId": event.specimen_id,
                "tenantId": event.tenant_id,
                "transferId": event.transfer_id,
            }
        )
        message = OutboxMessage(
            message_id=event_id,
            tenant_id=command.tenant_id,
            topic="specimen.custody.transferred.v1",
            payload=payload,
        )
        receipt = TransferReceipt(
            command_fingerprint=command.fingerprint,
            custody=successor,
            event=event,
            outbox=message,
        )
        record = TransferRecord(
            tenant_id=command.tenant_id,
            transfer_id=command.transfer_id,
            command_fingerprint=command.fingerprint,
            command=command,
            receipt=receipt,
        )

        event_key = (event.tenant_id, event.event_id)
        outbox_key = (message.tenant_id, message.message_id)
        occupied_message = state.outbox.get(outbox_key)
        if occupied_message is not None:
            same_envelope = (
                occupied_message.topic == message.topic
                and occupied_message.payload == message.payload
            )
            reason = (
                ReconciliationReason.OUTBOX_IDENTITY_OCCUPIED
                if same_envelope
                else ReconciliationReason.OUTBOX_CONTENT_COLLISION
            )
            return self._reconciliation(command, reason)

        custody_working = dict(state.custody)
        event_working = dict(state.events)
        outbox_working = dict(state.outbox)
        transfer_working = dict(state.transfers)

        # TARGET: all four candidate writes become accepted through one final state swap.
        custody_working[custody_key] = successor
        if fault_injector is not None:
            fault_injector(CommitStep.CUSTODY_WRITE)
        event_working[event_key] = event
        if fault_injector is not None:
            fault_injector(CommitStep.EVENT_WRITE)
        outbox_working[outbox_key] = message
        if fault_injector is not None:
            fault_injector(CommitStep.OUTBOX_WRITE)
        transfer_working[transfer_key] = record
        if fault_injector is not None:
            fault_injector(CommitStep.REPLAY_RECORD_WRITE)

        self._state = _frozen_state(
            custody=custody_working,
            events=event_working,
            outbox=outbox_working,
            transfers=transfer_working,
        )
        return TransferDecision(
            status=TransferStatus.APPLIED,
            transfer_id=command.transfer_id,
            receipt=receipt,
        )


def decision_document(decision: TransferDecision) -> dict[str, object]:
    """Render one deterministic human-reviewable decision document."""

    document: dict[str, object] = {
        "status": decision.status.value,
        "transferId": decision.transfer_id,
    }
    if decision.reason is not None:
        document["reason"] = decision.reason.value
    if decision.changed_fields:
        document["changedFields"] = list(decision.changed_fields)
        document["recordedFingerprint"] = decision.recorded_fingerprint
        document["candidateFingerprint"] = decision.candidate_fingerprint
    if decision.receipt is None:
        return document

    receipt = decision.receipt
    document["commandFingerprint"] = receipt.command_fingerprint
    document["custody"] = {
        "currentSource": receipt.custody.current_source,
        "specimenId": receipt.custody.specimen_id,
        "tenantId": receipt.custody.tenant_id,
        "version": receipt.custody.version,
    }
    document["event"] = {
        "acceptedVersion": receipt.event.accepted_version,
        "actorId": receipt.event.actor_id,
        "actorRole": receipt.event.actor_role,
        "awareAt": receipt.event.aware_at,
        "commandFingerprint": receipt.event.command_fingerprint,
        "destination": receipt.event.destination,
        "eventId": receipt.event.event_id,
        "priorSource": receipt.event.prior_source,
        "priorVersion": receipt.event.prior_version,
        "reason": receipt.event.reason,
        "specimenId": receipt.event.specimen_id,
        "tenantId": receipt.event.tenant_id,
        "transferId": receipt.event.transfer_id,
    }
    document["outbox"] = {
        "contentSha256": receipt.outbox.content_sha256,
        "messageId": receipt.outbox.message_id,
        "payload": json.loads(receipt.outbox.payload),
        "tenantId": receipt.outbox.tenant_id,
        "topic": receipt.outbox.topic,
    }
    return document


def run_fixture(path: Path) -> dict[str, object]:
    """Run one realistic synthetic transfer fixture."""

    fixture = json.loads(path.read_text(encoding="utf-8"))
    actor = ActorContext(
        tenant_id=fixture["actor"]["tenantId"],
        actor_id=fixture["actor"]["actorId"],
        role=fixture["actor"]["role"],
    )
    custody = CustodyRecord(
        specimen_id=fixture["custody"]["specimenId"],
        tenant_id=fixture["custody"]["tenantId"],
        current_source=fixture["custody"]["currentSource"],
        version=fixture["custody"]["version"],
    )
    command_data = fixture["command"]
    command = TransferCommand.capture(
        transfer_id=command_data["transferId"],
        tenant_id=command_data["tenantId"],
        specimen_id=command_data["specimenId"],
        actor_id=command_data["actorId"],
        actor_role=command_data["actorRole"],
        reason=command_data["reason"],
        aware_at=datetime.fromisoformat(command_data["awareAt"].replace("Z", "+00:00")),
        current_source=command_data["currentSource"],
        expected_version=command_data["expectedVersion"],
        destination=command_data["destination"],
        payload=command_data["payload"],
    )
    repository = InMemorySpecimenCustody([custody])
    return decision_document(repository.transfer(command, actor))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run the specimen-custody transactional outbox fixture.",
    )
    parser.add_argument("fixture", type=Path)
    arguments = parser.parse_args()
    print(json.dumps(run_fixture(arguments.fixture), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
