"""Shared staged-file and staged-directory promotion for one trusted writer.

This module owns the mutation-critical transition only. Callers retain
authority checks, artifact validation, and build-stage cleanup.
"""

from __future__ import annotations

import os
import re
import shutil
import warnings
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import NoReturn, Protocol
from uuid import uuid4


class PromotionOperation(StrEnum):
    """Semantic filesystem boundaries available to focused fault injection."""

    MOVE_PRIOR = "move_prior"
    ACTIVATE_SUCCESSOR = "activate_successor"
    RETAIN_SUCCESSOR = "retain_successor"
    RESTORE_PRIOR = "restore_prior"
    REMOVE_PRIOR = "remove_prior"


class PromotionCarrier(StrEnum):
    """Removal behavior for the two carrier shapes used by the workflow."""

    DIRECTORY = "directory"
    FILE = "file"


class PromotionError(RuntimeError):
    """Base error for a staged-promotion contract."""


class PromotionConflictError(PromotionError):
    """Raised when retained coordinates no longer describe one safe transition."""


class PromotionOperations(Protocol):
    """Narrow semantic adapter shared by production code and fault-injection tests."""

    def move(
        self,
        operation: PromotionOperation,
        source: Path,
        destination: Path,
    ) -> None: ...

    def remove(
        self,
        operation: PromotionOperation,
        path: Path,
        carrier: PromotionCarrier,
    ) -> None: ...


class LocalPromotionOperations:
    """Use portable same-filesystem rename and carrier-specific removal."""

    def move(
        self,
        _operation: PromotionOperation,
        source: Path,
        destination: Path,
    ) -> None:
        source.rename(destination)

    def remove(
        self,
        _operation: PromotionOperation,
        path: Path,
        carrier: PromotionCarrier,
    ) -> None:
        if carrier is PromotionCarrier.DIRECTORY:
            shutil.rmtree(path)
        else:
            path.unlink()


DEFAULT_PROMOTION_OPERATIONS = LocalPromotionOperations()
_STAGED_RECOVERY_ATTRIBUTE = "_document_evidence_staged_recovery"
_RECOVERY_EVENTS_ATTRIBUTE = "_document_evidence_recovery_events"


@dataclass(frozen=True)
class PromotionOutcome:
    """The accepted target and the prior coordinate awaiting retirement."""

    target: Path
    prior: Path | None


@dataclass(frozen=True)
class PromotionState:
    """One trusted-parent observation after a semantic move returned or raised."""

    staged_occupied: bool
    target_occupied: bool
    prior_occupied: bool | None


class PromotionRecoveryError(PromotionError):
    """Retain every event, coordinate, and observed state that needs re-entry."""

    def __init__(
        self,
        *,
        primary_error: BaseException,
        recovery_errors: tuple[BaseException, ...],
        phase: PromotionOperation,
        staged: Path,
        target: Path,
        prior: Path | None,
        state: PromotionState,
    ) -> None:
        if not recovery_errors:
            raise ValueError("recovery_errors must contain at least one event")
        super().__init__(
            f"promotion recovery requires re-entry during {phase}; observed "
            f"staged={state.staged_occupied}, target={state.target_occupied}, "
            f"prior={state.prior_occupied}; inspect {staged}, {target}, and {prior}"
        )
        self.primary_error = primary_error
        self.recovery_errors = recovery_errors
        self.recovery_error = recovery_errors[-1]
        self.staged = staged
        self.target = target
        self.prior = prior
        self.phase = phase
        self.state = state

    def retains_staged(self, path: Path) -> bool:
        return path == self.staged and self.state.staged_occupied


def path_is_occupied(path: Path) -> bool:
    """Treat a broken symbolic link as an occupied coordinate."""

    return os.path.lexists(path)


def observe_promotion_state(
    staged: Path,
    target: Path,
    prior: Path | None,
) -> PromotionState:
    """Read each named coordinate once after an operation boundary."""

    return PromotionState(
        staged_occupied=path_is_occupied(staged),
        target_occupied=path_is_occupied(target),
        prior_occupied=path_is_occupied(prior) if prior is not None else None,
    )


def recovery_path_for(target: Path, recovery_id: str | None = None) -> Path:
    """Create a transaction-specific sibling coordinate for the prior generation."""

    identifier = recovery_id or uuid4().hex
    if not re.fullmatch(r"[a-f0-9]{32}", identifier):
        raise PromotionError("recovery identity must contain 32 lowercase hexadecimal characters")
    return target.with_name(f".{target.name}.recovery-{identifier}")


def retains_staged_recovery(error: BaseException, staged: Path) -> bool:
    """Tell a caller when promotion has transferred staged cleanup ownership."""

    if isinstance(error, PromotionRecoveryError):
        return error.retains_staged(staged)
    return getattr(error, _STAGED_RECOVERY_ATTRIBUTE, None) == staged


def recovery_events_for(error: BaseException) -> tuple[BaseException, ...]:
    """Return operation events observed after their filesystem effects."""

    return getattr(error, _RECOVERY_EVENTS_ATTRIBUTE, ())


def _retain_staged_with(
    error: BaseException,
    staged: Path,
    recovery_events: tuple[BaseException, ...] = (),
) -> None:
    """Attach recovery ownership while preserving the original event identity."""

    setattr(error, _STAGED_RECOVERY_ATTRIBUTE, staged)
    setattr(error, _RECOVERY_EVENTS_ATTRIBUTE, recovery_events)
    error.add_note(f"staged successor remains available for re-entry at {staged}")
    if recovery_events:
        error.add_note(
            f"{len(recovery_events)} recovery operation event(s) arrived after "
            "their filesystem effects were observed"
        )


def _raise_recovery_error(
    *,
    primary_error: BaseException,
    recovery_errors: tuple[BaseException, ...],
    phase: PromotionOperation,
    staged: Path,
    target: Path,
    prior: Path | None,
) -> NoReturn:
    state = observe_promotion_state(staged, target, prior)
    raise PromotionRecoveryError(
        primary_error=primary_error,
        recovery_errors=recovery_errors,
        phase=phase,
        staged=staged,
        target=target,
        prior=prior,
        state=state,
    ) from recovery_errors[-1]


def _unexpected_state_error(
    phase: PromotionOperation,
    state: PromotionState,
) -> PromotionConflictError:
    return PromotionConflictError(
        f"{phase} reached an unrecognized trusted-parent state: "
        f"staged={state.staged_occupied}, target={state.target_occupied}, "
        f"prior={state.prior_occupied}"
    )


def _retain_activated_successor(
    *,
    primary_error: BaseException,
    staged: Path,
    target: Path,
    prior: Path | None,
    operations: PromotionOperations,
    recovery_events: tuple[BaseException, ...] = (),
) -> tuple[BaseException, ...]:
    """Move an activated successor back to its stage before prior restoration."""

    try:
        operations.move(PromotionOperation.RETAIN_SUCCESSOR, target, staged)
    except BaseException as retain_error:
        state = observe_promotion_state(staged, target, prior)
        expected_prior = True if prior is not None else None
        if (
            state.staged_occupied
            and not state.target_occupied
            and state.prior_occupied is expected_prior
        ):
            return (*recovery_events, retain_error)
        _raise_recovery_error(
            primary_error=primary_error,
            recovery_errors=(*recovery_events, retain_error),
            phase=PromotionOperation.RETAIN_SUCCESSOR,
            staged=staged,
            target=target,
            prior=prior,
        )
    state = observe_promotion_state(staged, target, prior)
    expected_prior = True if prior is not None else None
    if (
        state.staged_occupied
        and not state.target_occupied
        and state.prior_occupied is expected_prior
    ):
        return recovery_events
    conflict = _unexpected_state_error(PromotionOperation.RETAIN_SUCCESSOR, state)
    _raise_recovery_error(
        primary_error=primary_error,
        recovery_errors=(*recovery_events, conflict),
        phase=PromotionOperation.RETAIN_SUCCESSOR,
        staged=staged,
        target=target,
        prior=prior,
    )


def _restore_prior(
    *,
    primary_error: BaseException,
    staged: Path,
    target: Path,
    prior: Path,
    operations: PromotionOperations,
    recovery_events: tuple[BaseException, ...] = (),
) -> tuple[BaseException, ...]:
    """Restore the prior generation and classify an event by observed effect."""

    try:
        operations.move(PromotionOperation.RESTORE_PRIOR, prior, target)
    except BaseException as restore_error:
        state = observe_promotion_state(staged, target, prior)
        if state.staged_occupied and state.target_occupied and not state.prior_occupied:
            return (*recovery_events, restore_error)
        _raise_recovery_error(
            primary_error=primary_error,
            recovery_errors=(*recovery_events, restore_error),
            phase=PromotionOperation.RESTORE_PRIOR,
            staged=staged,
            target=target,
            prior=prior,
        )
    state = observe_promotion_state(staged, target, prior)
    if state.staged_occupied and state.target_occupied and not state.prior_occupied:
        return recovery_events
    conflict = _unexpected_state_error(PromotionOperation.RESTORE_PRIOR, state)
    _raise_recovery_error(
        primary_error=primary_error,
        recovery_errors=(*recovery_events, conflict),
        phase=PromotionOperation.RESTORE_PRIOR,
        staged=staged,
        target=target,
        prior=prior,
    )


def _reconcile_activation_event(
    *,
    primary_error: BaseException,
    staged: Path,
    target: Path,
    prior: Path | None,
    operations: PromotionOperations,
) -> tuple[BaseException, ...]:
    """Return the pre-activation state whether an event arrived before or after effect."""

    state = observe_promotion_state(staged, target, prior)
    expected_prior = True if prior is not None else None
    if state.staged_occupied and not state.target_occupied:
        if state.prior_occupied is expected_prior:
            recovery_events: tuple[BaseException, ...] = ()
        else:
            conflict = _unexpected_state_error(PromotionOperation.ACTIVATE_SUCCESSOR, state)
            _raise_recovery_error(
                primary_error=primary_error,
                recovery_errors=(conflict,),
                phase=PromotionOperation.ACTIVATE_SUCCESSOR,
                staged=staged,
                target=target,
                prior=prior,
            )
    elif not state.staged_occupied and state.target_occupied:
        if state.prior_occupied is expected_prior:
            recovery_events = _retain_activated_successor(
                primary_error=primary_error,
                staged=staged,
                target=target,
                prior=prior,
                operations=operations,
            )
        else:
            conflict = _unexpected_state_error(PromotionOperation.ACTIVATE_SUCCESSOR, state)
            _raise_recovery_error(
                primary_error=primary_error,
                recovery_errors=(conflict,),
                phase=PromotionOperation.ACTIVATE_SUCCESSOR,
                staged=staged,
                target=target,
                prior=prior,
            )
    else:
        conflict = _unexpected_state_error(PromotionOperation.ACTIVATE_SUCCESSOR, state)
        _raise_recovery_error(
            primary_error=primary_error,
            recovery_errors=(conflict,),
            phase=PromotionOperation.ACTIVATE_SUCCESSOR,
            staged=staged,
            target=target,
            prior=prior,
        )

    if prior is None:
        return recovery_events
    return _restore_prior(
        primary_error=primary_error,
        staged=staged,
        target=target,
        prior=prior,
        operations=operations,
        recovery_events=recovery_events,
    )


def promote_staged(
    staged: Path,
    target: Path,
    *,
    carrier: PromotionCarrier,
    prior_present: bool,
    operations: PromotionOperations = DEFAULT_PROMOTION_OPERATIONS,
    recovery_id: str | None = None,
) -> PromotionOutcome:
    """Promote one complete sibling stage under a trusted-parent, one-writer model.

    Each rename may supply one atomic directory-entry transition on a supporting
    filesystem. The complete sequence remains a recovery protocol with an
    intermediate target-absent state.
    """

    if staged.parent != target.parent:
        raise PromotionError("staged and target coordinates must share one trusted parent")

    # TARGET: the operation nearest each state transition observes current
    # filesystem state; earlier path observations remain descriptive.
    if not prior_present:
        try:
            operations.move(PromotionOperation.ACTIVATE_SUCCESSOR, staged, target)
        except BaseException as activation_error:
            recovery_events = _reconcile_activation_event(
                primary_error=activation_error,
                staged=staged,
                target=target,
                prior=None,
                operations=operations,
            )
            _retain_staged_with(activation_error, staged, recovery_events)
            raise
        return PromotionOutcome(target=target, prior=None)

    prior = recovery_path_for(target, recovery_id)
    if path_is_occupied(prior):
        raise PromotionConflictError(
            f"recovery coordinate is already occupied; preserve it for review: {prior}"
        )

    try:
        operations.move(PromotionOperation.MOVE_PRIOR, target, prior)
    except BaseException as move_error:
        state = observe_promotion_state(staged, target, prior)
        if state.staged_occupied and state.target_occupied and not state.prior_occupied:
            recovery_events = ()
        elif state.staged_occupied and not state.target_occupied and state.prior_occupied:
            recovery_events = _restore_prior(
                primary_error=move_error,
                staged=staged,
                target=target,
                prior=prior,
                operations=operations,
            )
        else:
            conflict = _unexpected_state_error(PromotionOperation.MOVE_PRIOR, state)
            _raise_recovery_error(
                primary_error=move_error,
                recovery_errors=(conflict,),
                phase=PromotionOperation.MOVE_PRIOR,
                staged=staged,
                target=target,
                prior=prior,
            )
        _retain_staged_with(move_error, staged, recovery_events)
        raise
    try:
        operations.move(PromotionOperation.ACTIVATE_SUCCESSOR, staged, target)
    except BaseException as primary_error:
        # GUARD: the observed coordinates classify an event that arrives on
        # either side of the rename effect. Reconciliation returns the accepted
        # prior and ready stage before the original event propagates.
        recovery_events = _reconcile_activation_event(
            primary_error=primary_error,
            staged=staged,
            target=target,
            prior=prior,
            operations=operations,
        )
        _retain_staged_with(primary_error, staged, recovery_events)
        raise

    # CONTRAST: fewer status calls can improve measured lookup cost, while the
    # trusted-parent operating model—not a cached observation—bounds mutation.
    return PromotionOutcome(target=target, prior=prior)


def retire_prior(
    outcome: PromotionOutcome,
    *,
    carrier: PromotionCarrier,
    operations: PromotionOperations = DEFAULT_PROMOTION_OPERATIONS,
) -> Path | None:
    """Retire prior material after the successor has become accepted.

    A recursive directory removal can partially complete before reporting an
    error. The returned coordinate therefore identifies material available for
    inspection rather than promising a complete recoverable generation.
    """

    if outcome.prior is None:
        return None
    try:
        operations.remove(PromotionOperation.REMOVE_PRIOR, outcome.prior, carrier)
    except OSError as error:
        warnings.warn(
            f"replacement completed; prior-generation cleanup stopped at {outcome.prior}; "
            f"any remaining material is available for inspection: {error}",
            RuntimeWarning,
            stacklevel=2,
        )
        return outcome.prior
    return None
