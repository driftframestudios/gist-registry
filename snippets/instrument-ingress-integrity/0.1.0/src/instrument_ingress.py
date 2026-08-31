"""Raw-byte-preserving instrument ingress with reviewable quarantine evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from enum import StrEnum
from pathlib import Path
from threading import RLock
from types import MappingProxyType
from typing import Any

PARSER_CONTRACT = "strict-json-measurement/1.0.0"
MAPPER_CONTRACT = "synthetic-ucum-profile/1.0.0"
MAX_PAYLOAD_BYTES = 1024 * 1024
RELEASED_FIELDS = frozenset({"analyte", "value", "unit"})
UNIT_PROFILE = MappingProxyType(
    {
        "ng/uL": ("ng/uL", "http://unitsofmeasure.org"),
        "copies/uL": ("{copies}/uL", "http://unitsofmeasure.org"),
        "{copies}/uL": ("{copies}/uL", "http://unitsofmeasure.org"),
    }
)


class DecisionStatus(StrEnum):
    ACCEPTED = "accepted"
    QUARANTINED = "quarantined"
    DUPLICATE_DELIVERY = "duplicate_delivery"
    REPLAYED = "replayed"
    RECONCILIATION_REQUIRED = "reconciliation_required"


class OutcomeDisposition(StrEnum):
    ACCEPTED = "accepted"
    QUARANTINED = "quarantined"


class QuarantineStage(StrEnum):
    INTAKE = "intake"
    PARSE = "parse"
    MAPPING = "mapping"
    ACQUISITION = "acquisition"


class CommitStep(StrEnum):
    RAW_CAPTURE = "raw_capture"
    DELIVERY_RECEIPT = "delivery_receipt"
    ACQUISITION = "acquisition"
    OUTCOME = "outcome"
    BEFORE_PUBLICATION = "before_publication"


class DuplicateJsonMember(ValueError):
    def __init__(self, member: str) -> None:
        super().__init__(member)
        self.member = member


class NonFiniteJsonConstant(ValueError):
    pass


def _canonical_json_bytes(value: object) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
        allow_nan=False,
    ).encode("ascii")


def _canonical_sha256(value: object) -> str:
    return hashlib.sha256(_canonical_json_bytes(value)).hexdigest()


def _raw_sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _comparison_sha256(raw: bytes) -> str:
    return hashlib.sha256(b"instrument-ingress-comparison\0" + raw).hexdigest()


def _aware_utc(value: datetime, label: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{label} requires an explicit timezone")
    return value.astimezone(UTC)


def _required_text(value: str, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} is required")
    return value.strip()


def _bound_contract(
    implementation: Callable[..., object],
    released_implementation: Callable[..., object],
    supplied_contract: str | None,
    released_contract: str,
    label: str,
) -> str:
    if supplied_contract is None:
        if implementation is released_implementation:
            return released_contract
        raise ValueError(f"custom {label} requires an explicit {label}_contract")
    contract = _required_text(supplied_contract, f"{label}_contract")
    if implementation is released_implementation and contract != released_contract:
        raise ValueError(f"released {label} is bound to contract {released_contract!r}")
    return contract


@dataclass(frozen=True, slots=True)
class InstrumentDelivery:
    tenant_id: str
    delivery_id: str
    acquisition_id: str
    instrument_id: str
    specimen_id: str
    purpose: str
    captured_at: datetime
    received_at: datetime
    media_type: str
    raw_bytes: bytes
    vendor_message_id: str | None = None

    def __post_init__(self) -> None:
        for field_name in (
            "tenant_id",
            "delivery_id",
            "acquisition_id",
            "instrument_id",
            "specimen_id",
            "purpose",
            "media_type",
        ):
            object.__setattr__(
                self,
                field_name,
                _required_text(getattr(self, field_name), field_name),
            )
        object.__setattr__(
            self,
            "captured_at",
            _aware_utc(self.captured_at, "captured_at"),
        )
        object.__setattr__(
            self,
            "received_at",
            _aware_utc(self.received_at, "received_at"),
        )
        object.__setattr__(self, "raw_bytes", memoryview(self.raw_bytes).tobytes())
        if self.vendor_message_id is not None:
            object.__setattr__(
                self,
                "vendor_message_id",
                _required_text(self.vendor_message_id, "vendor_message_id"),
            )

    @classmethod
    def capture(
        cls,
        *,
        tenant_id: str,
        delivery_id: str,
        acquisition_id: str,
        instrument_id: str,
        specimen_id: str,
        purpose: str,
        captured_at: datetime,
        received_at: datetime,
        media_type: str,
        raw_bytes: bytes | bytearray | memoryview,
        vendor_message_id: str | None = None,
    ) -> InstrumentDelivery:
        return cls(
            tenant_id=_required_text(tenant_id, "tenant_id"),
            delivery_id=_required_text(delivery_id, "delivery_id"),
            acquisition_id=_required_text(acquisition_id, "acquisition_id"),
            instrument_id=_required_text(instrument_id, "instrument_id"),
            specimen_id=_required_text(specimen_id, "specimen_id"),
            purpose=_required_text(purpose, "purpose"),
            captured_at=_aware_utc(captured_at, "captured_at"),
            received_at=_aware_utc(received_at, "received_at"),
            media_type=_required_text(media_type, "media_type"),
            raw_bytes=memoryview(raw_bytes).tobytes(),
            vendor_message_id=(
                _required_text(vendor_message_id, "vendor_message_id")
                if vendor_message_id is not None
                else None
            ),
        )

    def acquisition_meaning(
        self,
        raw_digest: str,
        *,
        parser_contract: str = PARSER_CONTRACT,
        mapper_contract: str = MAPPER_CONTRACT,
    ) -> dict[str, object]:
        return {
            "tenantId": self.tenant_id,
            "acquisitionId": self.acquisition_id,
            "instrumentId": self.instrument_id,
            "specimenId": self.specimen_id,
            "purpose": self.purpose,
            "capturedAt": self.captured_at.isoformat(),
            "mediaType": self.media_type,
            "rawSha256": raw_digest,
            "vendorMessageId": self.vendor_message_id,
            "parserContract": parser_contract,
            "mapperContract": mapper_contract,
        }

    def delivery_meaning(
        self,
        raw_digest: str,
        *,
        parser_contract: str = PARSER_CONTRACT,
        mapper_contract: str = MAPPER_CONTRACT,
    ) -> dict[str, object]:
        return {
            **self.acquisition_meaning(
                raw_digest,
                parser_contract=parser_contract,
                mapper_contract=mapper_contract,
            ),
            "deliveryId": self.delivery_id,
            "receivedAt": self.received_at.isoformat(),
        }


@dataclass(frozen=True, slots=True)
class RawArtifact:
    tenant_id: str
    raw_sha256: str
    byte_length: int
    content: bytes

    def to_document(self) -> dict[str, object]:
        return {
            "tenantId": self.tenant_id,
            "rawSha256": self.raw_sha256,
            "byteLength": self.byte_length,
        }


@dataclass(frozen=True, slots=True)
class ParsedMeasurement:
    analyte: str
    quantity: Decimal
    source_unit: str


@dataclass(frozen=True, slots=True)
class IngressRejection:
    stage: QuarantineStage
    reason_code: str
    recovery: str
    details: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class NormalizedObservation:
    tenant_id: str
    acquisition_id: str
    instrument_id: str
    specimen_id: str
    purpose: str
    captured_at: datetime
    analyte: str
    decimal_value: str
    precision: int
    scale: int
    unit_code: str
    unit_system: str
    raw_sha256: str
    parser_contract: str = PARSER_CONTRACT
    mapper_contract: str = MAPPER_CONTRACT

    def to_document(self) -> dict[str, object]:
        return {
            "tenantId": self.tenant_id,
            "acquisitionId": self.acquisition_id,
            "instrumentId": self.instrument_id,
            "specimenId": self.specimen_id,
            "purpose": self.purpose,
            "capturedAt": self.captured_at.isoformat(),
            "analyte": self.analyte,
            "quantity": {
                "decimal": self.decimal_value,
                "precision": self.precision,
                "scale": self.scale,
                "unitCode": self.unit_code,
                "unitSystem": self.unit_system,
            },
            "rawSha256": self.raw_sha256,
            "pipeline": {
                "parser": self.parser_contract,
                "mapper": self.mapper_contract,
            },
        }

    @property
    def normalized_sha256(self) -> str:
        return _canonical_sha256(self.to_document())


@dataclass(frozen=True, slots=True)
class AcquisitionRecord:
    tenant_id: str
    instrument_id: str
    acquisition_id: str
    canonical_delivery_id: str
    acquisition_fingerprint: str
    acquisition_meaning_json: bytes
    raw_sha256: str
    outcome: OutcomeDisposition
    normalized_sha256: str | None


@dataclass(frozen=True, slots=True)
class DeliveryReceipt:
    tenant_id: str
    delivery_id: str
    acquisition_id: str
    instrument_id: str
    disposition: DecisionStatus
    outcome: OutcomeDisposition
    delivery_fingerprint: str
    acquisition_fingerprint: str
    delivery_meaning_json: bytes
    raw_sha256: str
    byte_length: int
    normalized_sha256: str | None
    reason_code: str | None
    recovery: str
    canonical_delivery_id: str
    parser_contract: str
    mapper_contract: str

    def to_document(self) -> dict[str, object]:
        return {
            "tenantId": self.tenant_id,
            "deliveryId": self.delivery_id,
            "acquisitionId": self.acquisition_id,
            "instrumentId": self.instrument_id,
            "disposition": self.disposition,
            "outcome": self.outcome,
            "deliveryFingerprint": self.delivery_fingerprint,
            "acquisitionFingerprint": self.acquisition_fingerprint,
            "rawSha256": self.raw_sha256,
            "byteLength": self.byte_length,
            "normalizedSha256": self.normalized_sha256,
            "reasonCode": self.reason_code,
            "recovery": self.recovery,
            "canonicalDeliveryId": self.canonical_delivery_id,
            "pipeline": {
                "parser": self.parser_contract,
                "mapper": self.mapper_contract,
            },
        }


@dataclass(frozen=True, slots=True)
class QuarantineRecord:
    tenant_id: str
    delivery_id: str
    acquisition_id: str
    instrument_id: str
    specimen_id: str
    raw_sha256: str
    byte_length: int
    stage: QuarantineStage
    reason_code: str
    recovery: str
    details: tuple[str, ...]
    acquisition_fingerprint: str
    canonical_acquisition_fingerprint: str | None
    parser_contract: str
    mapper_contract: str

    def to_document(self) -> dict[str, object]:
        return {
            "tenantId": self.tenant_id,
            "deliveryId": self.delivery_id,
            "acquisitionId": self.acquisition_id,
            "instrumentId": self.instrument_id,
            "specimenId": self.specimen_id,
            "rawSha256": self.raw_sha256,
            "byteLength": self.byte_length,
            "stage": self.stage,
            "reasonCode": self.reason_code,
            "recovery": self.recovery,
            "details": list(self.details),
            "acquisitionFingerprint": self.acquisition_fingerprint,
            "canonicalAcquisitionFingerprint": self.canonical_acquisition_fingerprint,
            "pipeline": {
                "parser": self.parser_contract,
                "mapper": self.mapper_contract,
            },
        }


@dataclass(frozen=True, slots=True)
class IngressDecision:
    status: DecisionStatus
    receipt: DeliveryReceipt | None
    reason_code: str | None = None
    recovery: str | None = None
    changed_fields: tuple[str, ...] = ()
    recorded_fingerprint: str | None = None
    candidate_fingerprint: str | None = None

    def to_document(self) -> dict[str, object]:
        return {
            "status": self.status,
            "receipt": self.receipt.to_document() if self.receipt else None,
            "reasonCode": self.reason_code,
            "recovery": self.recovery,
            "changedFields": list(self.changed_fields),
            "recordedFingerprint": self.recorded_fingerprint,
            "candidateFingerprint": self.candidate_fingerprint,
        }


@dataclass(frozen=True, slots=True)
class RepositorySnapshot:
    raw_artifacts: tuple[RawArtifact, ...]
    receipts: tuple[DeliveryReceipt, ...]
    acquisitions: tuple[AcquisitionRecord, ...]
    accepted: tuple[NormalizedObservation, ...]
    quarantines: tuple[QuarantineRecord, ...]

    def counts(self) -> dict[str, int]:
        return {
            "rawArtifacts": len(self.raw_artifacts),
            "receipts": len(self.receipts),
            "acquisitions": len(self.acquisitions),
            "accepted": len(self.accepted),
            "quarantines": len(self.quarantines),
        }


@dataclass(frozen=True, slots=True)
class _RepositoryState:
    raw: Mapping[tuple[str, str], RawArtifact]
    receipts: Mapping[tuple[str, str], DeliveryReceipt]
    acquisitions: Mapping[tuple[str, str, str], AcquisitionRecord]
    accepted: Mapping[tuple[str, str, str], NormalizedObservation]
    quarantines: Mapping[tuple[str, str], QuarantineRecord]


def _empty_state() -> _RepositoryState:
    empty: Mapping[Any, Any] = MappingProxyType({})
    return _RepositoryState(empty, empty, empty, empty, empty)


def _freeze_state(
    *,
    raw: Mapping[tuple[str, str], RawArtifact],
    receipts: Mapping[tuple[str, str], DeliveryReceipt],
    acquisitions: Mapping[tuple[str, str, str], AcquisitionRecord],
    accepted: Mapping[tuple[str, str, str], NormalizedObservation],
    quarantines: Mapping[tuple[str, str], QuarantineRecord],
) -> _RepositoryState:
    return _RepositoryState(
        raw=MappingProxyType(dict(raw)),
        receipts=MappingProxyType(dict(receipts)),
        acquisitions=MappingProxyType(dict(acquisitions)),
        accepted=MappingProxyType(dict(accepted)),
        quarantines=MappingProxyType(dict(quarantines)),
    )


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    document: dict[str, object] = {}
    for key, value in pairs:
        if key in document:
            raise DuplicateJsonMember(key)
        document[key] = value
    return document


def _reject_nonfinite(value: str) -> object:
    raise NonFiniteJsonConstant(value)


def parse_measurement(raw: bytes) -> ParsedMeasurement | IngressRejection:
    try:
        document = json.loads(
            raw,
            parse_float=Decimal,
            parse_int=Decimal,
            parse_constant=_reject_nonfinite,
            object_pairs_hook=_unique_object,
        )
    except DuplicateJsonMember as error:
        return IngressRejection(
            QuarantineStage.PARSE,
            "duplicate_json_member",
            "emit one value for each released field",
            (error.member,),
        )
    except NonFiniteJsonConstant as error:
        return IngressRejection(
            QuarantineStage.PARSE,
            "nonfinite_json_number",
            "emit a finite decimal quantity",
            (str(error),),
        )
    except (UnicodeDecodeError, json.JSONDecodeError):
        return IngressRejection(
            QuarantineStage.PARSE,
            "malformed_json",
            "repair the source export and submit it under a new delivery identity",
        )
    if not isinstance(document, dict):
        return IngressRejection(
            QuarantineStage.PARSE,
            "invalid_document_shape",
            "emit one JSON object through the released instrument profile",
        )
    missing = tuple(sorted(RELEASED_FIELDS.difference(document)))
    if missing:
        return IngressRejection(
            QuarantineStage.PARSE,
            "missing_required_fields",
            "supply each released field",
            missing,
        )
    additional = tuple(sorted(set(document).difference(RELEASED_FIELDS)))
    if additional:
        return IngressRejection(
            QuarantineStage.PARSE,
            "unreleased_fields",
            "map additional fields through a versioned instrument profile",
            additional,
        )
    analyte = document["analyte"]
    if not isinstance(analyte, str) or not analyte.strip() or len(analyte.strip()) > 128:
        return IngressRejection(
            QuarantineStage.MAPPING,
            "analyte_requires_mapping",
            "supply a 1..128 character analyte code from the released profile",
        )
    source_unit = document["unit"]
    if not isinstance(source_unit, str):
        return IngressRejection(
            QuarantineStage.MAPPING,
            "unit_requires_mapping",
            "supply a unit code from the released profile",
        )
    raw_quantity = document["value"]
    if isinstance(raw_quantity, bool) or not isinstance(raw_quantity, (str, Decimal)):
        return IngressRejection(
            QuarantineStage.MAPPING,
            "quantity_requires_mapping",
            "supply a finite decimal number or decimal string",
        )
    try:
        quantity = Decimal(raw_quantity.strip()) if isinstance(raw_quantity, str) else raw_quantity
    except (InvalidOperation, ValueError):
        return IngressRejection(
            QuarantineStage.MAPPING,
            "quantity_requires_mapping",
            "supply a finite decimal number or decimal string",
        )
    if not quantity.is_finite():
        return IngressRejection(
            QuarantineStage.MAPPING,
            "quantity_requires_mapping",
            "supply a finite decimal quantity",
        )
    return ParsedMeasurement(analyte.strip(), quantity, source_unit)


def map_measurement(
    delivery: InstrumentDelivery,
    parsed: ParsedMeasurement,
    raw_digest: str,
) -> NormalizedObservation | IngressRejection:
    unit_mapping = UNIT_PROFILE.get(parsed.source_unit)
    if unit_mapping is None:
        return IngressRejection(
            QuarantineStage.MAPPING,
            "unsupported_unit",
            "map the quantity through a reviewed scientific unit profile",
            (parsed.source_unit,),
        )
    quantity_tuple = parsed.quantity.as_tuple()
    precision = len(quantity_tuple.digits)
    scale = max(-quantity_tuple.exponent, 0)
    integer_digits = max(precision + quantity_tuple.exponent, 0)
    if precision > 38 or scale > 18 or integer_digits > 20:
        return IngressRejection(
            QuarantineStage.MAPPING,
            "quantity_precision_exceeded",
            "route the measurement through a reviewed wider decimal profile",
        )
    unit_code, unit_system = unit_mapping
    return NormalizedObservation(
        tenant_id=delivery.tenant_id,
        acquisition_id=delivery.acquisition_id,
        instrument_id=delivery.instrument_id,
        specimen_id=delivery.specimen_id,
        purpose=delivery.purpose,
        captured_at=delivery.captured_at,
        analyte=parsed.analyte.upper(),
        decimal_value=format(parsed.quantity, "f"),
        precision=precision,
        scale=scale,
        unit_code=unit_code,
        unit_system=unit_system,
        raw_sha256=raw_digest,
    )


class InstrumentIngressRepository:
    """Process-local conformance model with one copy-on-write publication point."""

    def __init__(
        self,
        *,
        parser: Callable[[bytes], ParsedMeasurement | IngressRejection] = parse_measurement,
        mapper: Callable[
            [InstrumentDelivery, ParsedMeasurement, str],
            NormalizedObservation | IngressRejection,
        ] = map_measurement,
        raw_digest: Callable[[bytes], str] = _raw_sha256,
        parser_contract: str | None = None,
        mapper_contract: str | None = None,
    ) -> None:
        self._lock = RLock()
        self._commit_in_progress = False
        self._state = _empty_state()
        self._parser = parser
        self._mapper = mapper
        self._raw_digest = raw_digest
        self._parser_contract = _bound_contract(
            parser,
            parse_measurement,
            parser_contract,
            PARSER_CONTRACT,
            "parser",
        )
        self._mapper_contract = _bound_contract(
            mapper,
            map_measurement,
            mapper_contract,
            MAPPER_CONTRACT,
            "mapper",
        )

    def snapshot(self) -> RepositorySnapshot:
        with self._lock:
            state = self._state
            return RepositorySnapshot(
                raw_artifacts=tuple(state.raw[key] for key in sorted(state.raw)),
                receipts=tuple(state.receipts[key] for key in sorted(state.receipts)),
                acquisitions=tuple(state.acquisitions[key] for key in sorted(state.acquisitions)),
                accepted=tuple(state.accepted[key] for key in sorted(state.accepted)),
                quarantines=tuple(state.quarantines[key] for key in sorted(state.quarantines)),
            )

    def raw_bytes(self, tenant_id: str, raw_digest: str) -> bytes | None:
        with self._lock:
            artifact = self._state.raw.get((tenant_id, raw_digest))
            return artifact.content if artifact is not None else None

    def ingest(
        self,
        delivery: InstrumentDelivery,
        *,
        fault_injector: Callable[[CommitStep], None] | None = None,
    ) -> IngressDecision:
        raw_digest = self._raw_digest(delivery.raw_bytes)
        acquisition_meaning = delivery.acquisition_meaning(
            raw_digest,
            parser_contract=self._parser_contract,
            mapper_contract=self._mapper_contract,
        )
        delivery_meaning = delivery.delivery_meaning(
            raw_digest,
            parser_contract=self._parser_contract,
            mapper_contract=self._mapper_contract,
        )
        acquisition_fingerprint = _canonical_sha256(acquisition_meaning)
        delivery_fingerprint = _canonical_sha256(delivery_meaning)

        with self._lock:
            if self._commit_in_progress:
                raise RuntimeError("one repository instance publishes one ingress commit at a time")
            existing = self._resolve_existing(
                delivery,
                raw_digest,
                acquisition_meaning,
                acquisition_fingerprint,
                delivery_meaning,
                delivery_fingerprint,
                fault_injector,
            )
            if existing is not None:
                return existing

        rejection: IngressRejection | None = self._intake_rejection(delivery)
        normalized: NormalizedObservation | None = None
        if rejection is None:
            parsed = self._parser(delivery.raw_bytes)
            if isinstance(parsed, IngressRejection):
                rejection = parsed
            else:
                mapped = self._mapper(delivery, parsed, raw_digest)
                if isinstance(mapped, IngressRejection):
                    rejection = mapped
                else:
                    normalized = self._bind_normalized(delivery, mapped, raw_digest)

        with self._lock:
            if self._commit_in_progress:
                raise RuntimeError("one repository instance publishes one ingress commit at a time")
            existing = self._resolve_existing(
                delivery,
                raw_digest,
                acquisition_meaning,
                acquisition_fingerprint,
                delivery_meaning,
                delivery_fingerprint,
                fault_injector,
            )
            if existing is not None:
                return existing
            assert (normalized is None) != (rejection is None)
            return self._commit_new_acquisition(
                delivery,
                raw_digest,
                acquisition_meaning,
                acquisition_fingerprint,
                delivery_meaning,
                delivery_fingerprint,
                normalized,
                rejection,
                fault_injector,
            )

    @staticmethod
    def _intake_rejection(delivery: InstrumentDelivery) -> IngressRejection | None:
        if delivery.media_type != "application/json":
            return IngressRejection(
                QuarantineStage.INTAKE,
                "unsupported_media_type",
                "transcode through the released JSON instrument profile",
                (delivery.media_type,),
            )
        if len(delivery.raw_bytes) > MAX_PAYLOAD_BYTES:
            return IngressRejection(
                QuarantineStage.INTAKE,
                "payload_limit_exceeded",
                "store the source artifact and submit one bounded measurement document",
                (str(len(delivery.raw_bytes)),),
            )
        return None

    def _bind_normalized(
        self,
        delivery: InstrumentDelivery,
        normalized: NormalizedObservation,
        raw_digest: str,
    ) -> NormalizedObservation:
        if not isinstance(normalized, NormalizedObservation):
            raise TypeError("mapper must return NormalizedObservation or IngressRejection")
        expected_lineage = {
            "tenant_id": delivery.tenant_id,
            "acquisition_id": delivery.acquisition_id,
            "instrument_id": delivery.instrument_id,
            "specimen_id": delivery.specimen_id,
            "purpose": delivery.purpose,
            "captured_at": delivery.captured_at,
            "raw_sha256": raw_digest,
        }
        changed = tuple(
            field_name
            for field_name, expected in expected_lineage.items()
            if getattr(normalized, field_name) != expected
        )
        if changed:
            raise ValueError("mapper result changed ingress lineage fields: " + ", ".join(changed))
        return replace(
            normalized,
            parser_contract=self._parser_contract,
            mapper_contract=self._mapper_contract,
        )

    @staticmethod
    def _changed_fields(recorded_json: bytes, candidate: Mapping[str, object]) -> tuple[str, ...]:
        recorded = json.loads(recorded_json)
        return tuple(
            key
            for key in sorted(set(recorded).union(candidate))
            if recorded.get(key) != candidate.get(key)
        )

    @staticmethod
    def _reconciliation(
        reason_code: str,
        recovery: str,
        *,
        changed_fields: tuple[str, ...],
        recorded_fingerprint: str,
        candidate_fingerprint: str,
    ) -> IngressDecision:
        return IngressDecision(
            status=DecisionStatus.RECONCILIATION_REQUIRED,
            receipt=None,
            reason_code=reason_code,
            recovery=recovery,
            changed_fields=changed_fields,
            recorded_fingerprint=recorded_fingerprint,
            candidate_fingerprint=candidate_fingerprint,
        )

    def _resolve_existing(
        self,
        delivery: InstrumentDelivery,
        raw_digest: str,
        acquisition_meaning: Mapping[str, object],
        acquisition_fingerprint: str,
        delivery_meaning: Mapping[str, object],
        delivery_fingerprint: str,
        fault_injector: Callable[[CommitStep], None] | None,
    ) -> IngressDecision | None:
        state = self._state
        raw_key = (delivery.tenant_id, raw_digest)
        existing_raw = state.raw.get(raw_key)
        if existing_raw is not None and existing_raw.content != delivery.raw_bytes:
            return self._reconciliation(
                "raw_digest_collision",
                "route both byte sequences to cryptographic-integrity review",
                changed_fields=("rawBytes",),
                recorded_fingerprint=_comparison_sha256(existing_raw.content),
                candidate_fingerprint=_comparison_sha256(delivery.raw_bytes),
            )

        delivery_key = (delivery.tenant_id, delivery.delivery_id)
        prior_receipt = state.receipts.get(delivery_key)
        if prior_receipt is not None:
            if prior_receipt.delivery_fingerprint == delivery_fingerprint:
                return IngressDecision(DecisionStatus.REPLAYED, prior_receipt)
            return self._reconciliation(
                "delivery_identity_reused",
                "allocate a new delivery identity after transport-level review",
                changed_fields=self._changed_fields(
                    prior_receipt.delivery_meaning_json,
                    delivery_meaning,
                ),
                recorded_fingerprint=prior_receipt.delivery_fingerprint,
                candidate_fingerprint=delivery_fingerprint,
            )

        acquisition_key = (
            delivery.tenant_id,
            delivery.instrument_id,
            delivery.acquisition_id,
        )
        prior_acquisition = state.acquisitions.get(acquisition_key)
        if prior_acquisition is None:
            return None
        if prior_acquisition.acquisition_fingerprint == acquisition_fingerprint:
            receipt = DeliveryReceipt(
                tenant_id=delivery.tenant_id,
                delivery_id=delivery.delivery_id,
                acquisition_id=delivery.acquisition_id,
                instrument_id=delivery.instrument_id,
                disposition=DecisionStatus.DUPLICATE_DELIVERY,
                outcome=prior_acquisition.outcome,
                delivery_fingerprint=delivery_fingerprint,
                acquisition_fingerprint=acquisition_fingerprint,
                delivery_meaning_json=_canonical_json_bytes(delivery_meaning),
                raw_sha256=raw_digest,
                byte_length=len(delivery.raw_bytes),
                normalized_sha256=prior_acquisition.normalized_sha256,
                reason_code="acquisition_already_recorded",
                recovery="reuse the canonical acquisition outcome",
                canonical_delivery_id=prior_acquisition.canonical_delivery_id,
                parser_contract=self._parser_contract,
                mapper_contract=self._mapper_contract,
            )
            self._publish_candidate(
                delivery,
                raw_digest,
                receipt,
                acquisition=None,
                normalized=None,
                quarantine=None,
                fault_injector=fault_injector,
            )
            return IngressDecision(DecisionStatus.DUPLICATE_DELIVERY, receipt)

        rejection = IngressRejection(
            QuarantineStage.ACQUISITION,
            "acquisition_identity_reused",
            "allocate a new acquisition identity after instrument-source review",
            self._changed_fields(
                prior_acquisition.acquisition_meaning_json,
                acquisition_meaning,
            ),
        )
        receipt, quarantine = self._quarantine_values(
            delivery,
            raw_digest,
            acquisition_fingerprint,
            delivery_meaning,
            delivery_fingerprint,
            rejection,
            canonical_delivery_id=prior_acquisition.canonical_delivery_id,
            canonical_acquisition_fingerprint=prior_acquisition.acquisition_fingerprint,
        )
        self._publish_candidate(
            delivery,
            raw_digest,
            receipt,
            acquisition=None,
            normalized=None,
            quarantine=quarantine,
            fault_injector=fault_injector,
        )
        return IngressDecision(DecisionStatus.QUARANTINED, receipt)

    def _commit_new_acquisition(
        self,
        delivery: InstrumentDelivery,
        raw_digest: str,
        acquisition_meaning: Mapping[str, object],
        acquisition_fingerprint: str,
        delivery_meaning: Mapping[str, object],
        delivery_fingerprint: str,
        normalized: NormalizedObservation | None,
        rejection: IngressRejection | None,
        fault_injector: Callable[[CommitStep], None] | None,
    ) -> IngressDecision:
        outcome = (
            OutcomeDisposition.ACCEPTED
            if normalized is not None
            else OutcomeDisposition.QUARANTINED
        )
        acquisition = AcquisitionRecord(
            tenant_id=delivery.tenant_id,
            instrument_id=delivery.instrument_id,
            acquisition_id=delivery.acquisition_id,
            canonical_delivery_id=delivery.delivery_id,
            acquisition_fingerprint=acquisition_fingerprint,
            acquisition_meaning_json=_canonical_json_bytes(acquisition_meaning),
            raw_sha256=raw_digest,
            outcome=outcome,
            normalized_sha256=(normalized.normalized_sha256 if normalized else None),
        )
        quarantine: QuarantineRecord | None = None
        if rejection is None:
            assert normalized is not None
            receipt = DeliveryReceipt(
                tenant_id=delivery.tenant_id,
                delivery_id=delivery.delivery_id,
                acquisition_id=delivery.acquisition_id,
                instrument_id=delivery.instrument_id,
                disposition=DecisionStatus.ACCEPTED,
                outcome=OutcomeDisposition.ACCEPTED,
                delivery_fingerprint=delivery_fingerprint,
                acquisition_fingerprint=acquisition_fingerprint,
                delivery_meaning_json=_canonical_json_bytes(delivery_meaning),
                raw_sha256=raw_digest,
                byte_length=len(delivery.raw_bytes),
                normalized_sha256=normalized.normalized_sha256,
                reason_code=None,
                recovery="continue to scientific review",
                canonical_delivery_id=delivery.delivery_id,
                parser_contract=self._parser_contract,
                mapper_contract=self._mapper_contract,
            )
        else:
            receipt, quarantine = self._quarantine_values(
                delivery,
                raw_digest,
                acquisition_fingerprint,
                delivery_meaning,
                delivery_fingerprint,
                rejection,
                canonical_delivery_id=delivery.delivery_id,
                canonical_acquisition_fingerprint=None,
            )
        self._publish_candidate(
            delivery,
            raw_digest,
            receipt,
            acquisition=acquisition,
            normalized=normalized,
            quarantine=quarantine,
            fault_injector=fault_injector,
        )
        return IngressDecision(receipt.disposition, receipt)

    def _quarantine_values(
        self,
        delivery: InstrumentDelivery,
        raw_digest: str,
        acquisition_fingerprint: str,
        delivery_meaning: Mapping[str, object],
        delivery_fingerprint: str,
        rejection: IngressRejection,
        *,
        canonical_delivery_id: str,
        canonical_acquisition_fingerprint: str | None,
    ) -> tuple[DeliveryReceipt, QuarantineRecord]:
        recovery = (
            f"{rejection.recovery}; then submit reviewed content under new delivery "
            "and acquisition identities"
        )
        receipt = DeliveryReceipt(
            tenant_id=delivery.tenant_id,
            delivery_id=delivery.delivery_id,
            acquisition_id=delivery.acquisition_id,
            instrument_id=delivery.instrument_id,
            disposition=DecisionStatus.QUARANTINED,
            outcome=OutcomeDisposition.QUARANTINED,
            delivery_fingerprint=delivery_fingerprint,
            acquisition_fingerprint=acquisition_fingerprint,
            delivery_meaning_json=_canonical_json_bytes(delivery_meaning),
            raw_sha256=raw_digest,
            byte_length=len(delivery.raw_bytes),
            normalized_sha256=None,
            reason_code=rejection.reason_code,
            recovery=recovery,
            canonical_delivery_id=canonical_delivery_id,
            parser_contract=self._parser_contract,
            mapper_contract=self._mapper_contract,
        )
        quarantine = QuarantineRecord(
            tenant_id=delivery.tenant_id,
            delivery_id=delivery.delivery_id,
            acquisition_id=delivery.acquisition_id,
            instrument_id=delivery.instrument_id,
            specimen_id=delivery.specimen_id,
            raw_sha256=raw_digest,
            byte_length=len(delivery.raw_bytes),
            stage=rejection.stage,
            reason_code=rejection.reason_code,
            recovery=recovery,
            details=rejection.details,
            acquisition_fingerprint=acquisition_fingerprint,
            canonical_acquisition_fingerprint=canonical_acquisition_fingerprint,
            parser_contract=self._parser_contract,
            mapper_contract=self._mapper_contract,
        )
        return receipt, quarantine

    def _publish_candidate(
        self,
        delivery: InstrumentDelivery,
        raw_digest: str,
        receipt: DeliveryReceipt,
        *,
        acquisition: AcquisitionRecord | None,
        normalized: NormalizedObservation | None,
        quarantine: QuarantineRecord | None,
        fault_injector: Callable[[CommitStep], None] | None,
    ) -> None:
        state = self._state
        raw = dict(state.raw)
        receipts = dict(state.receipts)
        acquisitions = dict(state.acquisitions)
        accepted = dict(state.accepted)
        quarantines = dict(state.quarantines)
        acquisition_key = (
            delivery.tenant_id,
            delivery.instrument_id,
            delivery.acquisition_id,
        )

        self._commit_in_progress = True
        try:
            raw.setdefault(
                (delivery.tenant_id, raw_digest),
                RawArtifact(
                    tenant_id=delivery.tenant_id,
                    raw_sha256=raw_digest,
                    byte_length=len(delivery.raw_bytes),
                    content=delivery.raw_bytes,
                ),
            )
            self._inject(fault_injector, CommitStep.RAW_CAPTURE)
            receipts[(delivery.tenant_id, delivery.delivery_id)] = receipt
            self._inject(fault_injector, CommitStep.DELIVERY_RECEIPT)
            if acquisition is not None:
                acquisitions[acquisition_key] = acquisition
            self._inject(fault_injector, CommitStep.ACQUISITION)
            if normalized is not None:
                accepted[acquisition_key] = normalized
            if quarantine is not None:
                quarantines[(delivery.tenant_id, delivery.delivery_id)] = quarantine
            self._inject(fault_injector, CommitStep.OUTCOME)
            candidate = _freeze_state(
                raw=raw,
                receipts=receipts,
                acquisitions=acquisitions,
                accepted=accepted,
                quarantines=quarantines,
            )
            self._inject(fault_injector, CommitStep.BEFORE_PUBLICATION)
            self._state = candidate
        finally:
            self._commit_in_progress = False

    @staticmethod
    def _inject(
        fault_injector: Callable[[CommitStep], None] | None,
        step: CommitStep,
    ) -> None:
        if fault_injector is not None:
            fault_injector(step)


def _fixture_delivery(
    raw: bytes,
    *,
    delivery_id: str,
    acquisition_id: str,
    captured_at: datetime,
    received_at: datetime,
) -> InstrumentDelivery:
    return InstrumentDelivery.capture(
        tenant_id="tenant-north",
        delivery_id=delivery_id,
        acquisition_id=acquisition_id,
        instrument_id="instrument-synthetic-07",
        specimen_id="specimen-control-042",
        purpose="synthetic-quantity-observation",
        captured_at=captured_at,
        received_at=received_at,
        media_type="application/json",
        raw_bytes=raw,
        vendor_message_id="vendor-message-synthetic-042",
    )


def run_fixtures(accepted_path: Path, quarantined_path: Path) -> dict[str, object]:
    accepted_raw = accepted_path.read_bytes()
    quarantined_raw = quarantined_path.read_bytes()
    repository = InstrumentIngressRepository()
    accepted_delivery = _fixture_delivery(
        accepted_raw,
        delivery_id="delivery-accepted-001",
        acquisition_id="acquisition-accepted-001",
        captured_at=datetime(2026, 8, 31, 14, 30, tzinfo=UTC),
        received_at=datetime(2026, 8, 31, 14, 30, 2, tzinfo=UTC),
    )
    quarantined_delivery = _fixture_delivery(
        quarantined_raw,
        delivery_id="delivery-quarantined-001",
        acquisition_id="acquisition-quarantined-001",
        captured_at=datetime(2026, 8, 31, 14, 31, tzinfo=UTC),
        received_at=datetime(2026, 8, 31, 14, 31, 2, tzinfo=UTC),
    )
    accepted = repository.ingest(accepted_delivery)
    quarantined = repository.ingest(quarantined_delivery)
    accepted_replay = repository.ingest(accepted_delivery)
    quarantined_replay = repository.ingest(quarantined_delivery)
    snapshot = repository.snapshot()
    return {
        "accepted": accepted.to_document(),
        "quarantined": quarantined.to_document(),
        "acceptedReplay": accepted_replay.to_document(),
        "quarantinedReplay": quarantined_replay.to_document(),
        "retainedRawBytes": {
            "accepted": repository.raw_bytes(
                accepted_delivery.tenant_id,
                accepted.receipt.raw_sha256 if accepted.receipt else "",
            )
            == accepted_raw,
            "quarantined": repository.raw_bytes(
                quarantined_delivery.tenant_id,
                quarantined.receipt.raw_sha256 if quarantined.receipt else "",
            )
            == quarantined_raw,
        },
        "stateCounts": snapshot.counts(),
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("accepted_fixture", type=Path)
    parser.add_argument("quarantined_fixture", type=Path)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    result = run_fixtures(arguments.accepted_fixture, arguments.quarantined_fixture)
    print(json.dumps(result, indent=2, sort_keys=True, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
