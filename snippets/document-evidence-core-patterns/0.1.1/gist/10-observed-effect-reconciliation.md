# Pattern 1 — Reconcile the effect that is actually present

The transition names semantic filesystem operations and observes all three
coordinates after an operation returns or raises. A recovered path keeps the
original event object; an unresolved path carries every cause, coordinate,
phase, and observed occupancy in `PromotionRecoveryError`.

## Semantic operations and typed re-entry state

From `filesystem_promotion.py::PromotionOperation`:

```python
class PromotionOperation(StrEnum):
    """Semantic filesystem boundaries available to focused fault injection."""

    MOVE_PRIOR = "move_prior"
    ACTIVATE_SUCCESSOR = "activate_successor"
    RETAIN_SUCCESSOR = "retain_successor"
    RESTORE_PRIOR = "restore_prior"
    REMOVE_PRIOR = "remove_prior"
```

From `filesystem_promotion.py::PromotionState` and
`PromotionRecoveryError`:

```python
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
```

## Observe, retain, and report

These helpers treat a broken symbolic link as occupied, read each named
coordinate once per observation, preserve the original event identity after a
successful recovery, and construct a typed error when recovery needs re-entry.

```python
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
```

## Classify activation and run the transition

The activation reconciler distinguishes the ready staged successor from an
already activated successor. The complete source owns the called retention
and restoration helpers; this selection shows where their results enter the
control path.

```python
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
```

```python
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
```

## Specification by example

A post-effect activation event first leaves the successor at the target. The
transition returns the successor to its stage, restores the prior generation,
and propagates the identical interruption.

```python
    def test_activation_post_effect_event_reverses_successor_before_restoration(
        self,
    ) -> None:
        for carrier in self.carriers():
            with self.subTest(carrier=carrier), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                target = root / "accepted"
                staged = root / "staged"
                write_generation(target, carrier, b"prior")
                write_generation(staged, carrier, b"successor")
                interruption = InjectedInterruption("after successor activation")
                operations = FaultingOperations(
                    {},
                    after_failures={
                        filesystem_promotion.PromotionOperation.ACTIVATE_SUCCESSOR: [interruption]
                    },
                )

                with self.assertRaises(InjectedInterruption) as caught:
                    filesystem_promotion.promote_staged(
                        staged,
                        target,
                        carrier=carrier,
                        prior_present=True,
                        operations=operations,
                        recovery_id=self.recovery_id,
                    )

                self.assertIs(caught.exception, interruption)
                self.assertEqual(read_generation(target, carrier), b"prior")
                self.assertEqual(read_generation(staged, carrier), b"successor")
```

When activation and restoration both stop before their effects, the typed
error retains the two causes and the two generations at explicit coordinates.

```python
    def test_dual_failure_retains_both_causes_and_generations(self) -> None:
        for carrier in self.carriers():
            with self.subTest(carrier=carrier), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                target = root / "accepted"
                staged = root / "staged"
                write_generation(target, carrier, b"prior")
                write_generation(staged, carrier, b"successor")
                activation = OSError("activation stopped")
                restoration = OSError("restoration stopped")
                operations = FaultingOperations(
                    {
                        filesystem_promotion.PromotionOperation.ACTIVATE_SUCCESSOR: [activation],
                        filesystem_promotion.PromotionOperation.RESTORE_PRIOR: [restoration],
                    }
                )

                with self.assertRaises(filesystem_promotion.PromotionRecoveryError) as caught:
                    filesystem_promotion.promote_staged(
                        staged,
                        target,
                        carrier=carrier,
                        prior_present=True,
                        operations=operations,
                        recovery_id=self.recovery_id,
                    )

                error = caught.exception
                prior = filesystem_promotion.recovery_path_for(target, self.recovery_id)
                self.assertIs(error.primary_error, activation)
                self.assertIs(error.recovery_error, restoration)
                self.assertEqual(error.phase, filesystem_promotion.PromotionOperation.RESTORE_PRIOR)
                self.assertEqual(error.staged, staged)
                self.assertEqual(error.target, target)
                self.assertEqual(error.prior, prior)
                self.assertTrue(error.retains_staged(staged))
                self.assertFalse(target.exists())
                self.assertEqual(read_generation(staged, carrier), b"successor")
                self.assertEqual(read_generation(prior, carrier), b"prior")
```

These observations establish event classification and retained re-entry state
for the cooperative single-writer model. The complete artifact owns the
retention and restoration helper implementations and the broader failpoint
matrix.
