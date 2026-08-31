from __future__ import annotations

import hashlib
import os
import sys
import tempfile
import unittest
from collections.abc import Mapping
from pathlib import Path

SOURCE_ROOT = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SOURCE_ROOT))

import filesystem_promotion  # noqa: E402


class InjectedInterruption(BaseException):
    """A test-only non-Exception event at the mutation boundary."""


class FaultingOperations(filesystem_promotion.LocalPromotionOperations):
    def __init__(
        self,
        failures: Mapping[filesystem_promotion.PromotionOperation, list[BaseException]],
        *,
        after_failures: Mapping[
            filesystem_promotion.PromotionOperation,
            list[BaseException],
        ]
        | None = None,
    ) -> None:
        self.failures_before = {operation: list(events) for operation, events in failures.items()}
        self.failures_after = {
            operation: list(events) for operation, events in (after_failures or {}).items()
        }

    def _raise_next(
        self,
        failures: dict[
            filesystem_promotion.PromotionOperation,
            list[BaseException],
        ],
        operation: filesystem_promotion.PromotionOperation,
    ) -> None:
        events = failures.get(operation, [])
        if events:
            raise events.pop(0)

    def move(
        self,
        operation: filesystem_promotion.PromotionOperation,
        source: Path,
        destination: Path,
    ) -> None:
        self._raise_next(self.failures_before, operation)
        super().move(operation, source, destination)
        self._raise_next(self.failures_after, operation)

    def remove(
        self,
        operation: filesystem_promotion.PromotionOperation,
        path: Path,
        carrier: filesystem_promotion.PromotionCarrier,
    ) -> None:
        self._raise_next(self.failures_before, operation)
        super().remove(operation, path, carrier)
        self._raise_next(self.failures_after, operation)


class PartiallyRemovingDirectoryOperations(filesystem_promotion.LocalPromotionOperations):
    """Model a recursive cleanup that changes prior material before stopping."""

    def remove(
        self,
        operation: filesystem_promotion.PromotionOperation,
        path: Path,
        carrier: filesystem_promotion.PromotionCarrier,
    ) -> None:
        if operation is filesystem_promotion.PromotionOperation.REMOVE_PRIOR:
            (path / "removed-before-error.bin").unlink()
            raise OSError("cleanup stopped after partial removal")
        super().remove(operation, path, carrier)


def write_generation(
    path: Path,
    carrier: filesystem_promotion.PromotionCarrier,
    value: bytes,
) -> None:
    if carrier is filesystem_promotion.PromotionCarrier.DIRECTORY:
        path.mkdir()
        (path / "generation.bin").write_bytes(value)
    else:
        path.write_bytes(value)


def read_generation(path: Path, carrier: filesystem_promotion.PromotionCarrier) -> bytes:
    if carrier is filesystem_promotion.PromotionCarrier.DIRECTORY:
        return (path / "generation.bin").read_bytes()
    return path.read_bytes()


def tree_snapshot(root: Path) -> tuple[tuple[str, str, str], ...]:
    """Record entry kind and content without following symbolic links."""

    rows: list[tuple[str, str, str]] = []

    def visit(path: Path) -> None:
        for child in sorted(path.iterdir(), key=lambda item: item.name):
            relative = child.relative_to(root).as_posix()
            if child.is_symlink():
                rows.append((relative, "symlink", os.readlink(child)))
            elif child.is_dir():
                rows.append((relative, "directory", ""))
                visit(child)
            elif child.is_file():
                rows.append(
                    (
                        relative,
                        "file",
                        hashlib.sha256(child.read_bytes()).hexdigest(),
                    )
                )
            else:
                rows.append((relative, "special", ""))

    visit(root)
    return tuple(rows)


class FilesystemPromotionTests(unittest.TestCase):
    recovery_id = "a" * 32

    def carriers(self) -> tuple[filesystem_promotion.PromotionCarrier, ...]:
        return (
            filesystem_promotion.PromotionCarrier.DIRECTORY,
            filesystem_promotion.PromotionCarrier.FILE,
        )

    def test_failure_before_prior_move_preserves_both_named_generations(self) -> None:
        for carrier in self.carriers():
            with self.subTest(carrier=carrier), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                target = root / "accepted"
                staged = root / "staged"
                write_generation(target, carrier, b"prior")
                write_generation(staged, carrier, b"successor")
                before = tree_snapshot(root)
                failure = OSError("move prior stopped")
                operations = FaultingOperations(
                    {filesystem_promotion.PromotionOperation.MOVE_PRIOR: [failure]}
                )

                with self.assertRaises(OSError) as caught:
                    filesystem_promotion.promote_staged(
                        staged,
                        target,
                        carrier=carrier,
                        prior_present=True,
                        operations=operations,
                        recovery_id=self.recovery_id,
                    )

                self.assertIs(caught.exception, failure)
                self.assertTrue(filesystem_promotion.retains_staged_recovery(failure, staged))
                self.assertEqual(tree_snapshot(root), before)

    def test_occupied_recovery_symlink_preserves_every_named_coordinate(self) -> None:
        for carrier in self.carriers():
            with self.subTest(carrier=carrier), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                target = root / "accepted"
                staged = root / "staged"
                write_generation(target, carrier, b"prior")
                write_generation(staged, carrier, b"successor")
                recovery = filesystem_promotion.recovery_path_for(
                    target,
                    self.recovery_id,
                )
                recovery.symlink_to(root / "unavailable-generation")
                before = tree_snapshot(root)

                with self.assertRaises(filesystem_promotion.PromotionConflictError):
                    filesystem_promotion.promote_staged(
                        staged,
                        target,
                        carrier=carrier,
                        prior_present=True,
                        recovery_id=self.recovery_id,
                    )

                self.assertEqual(tree_snapshot(root), before)

    def test_activation_failure_restores_prior_and_reraises_original_event(self) -> None:
        for carrier in self.carriers():
            with self.subTest(carrier=carrier), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                target = root / "accepted"
                staged = root / "staged"
                write_generation(target, carrier, b"prior")
                write_generation(staged, carrier, b"successor")
                failure = OSError("activation stopped")
                operations = FaultingOperations(
                    {filesystem_promotion.PromotionOperation.ACTIVATE_SUCCESSOR: [failure]}
                )

                with self.assertRaises(OSError) as caught:
                    filesystem_promotion.promote_staged(
                        staged,
                        target,
                        carrier=carrier,
                        prior_present=True,
                        operations=operations,
                        recovery_id=self.recovery_id,
                    )

                self.assertIs(caught.exception, failure)
                self.assertTrue(filesystem_promotion.retains_staged_recovery(failure, staged))
                self.assertIn(str(staged), "\n".join(failure.__notes__))
                self.assertEqual(read_generation(target, carrier), b"prior")
                self.assertEqual(read_generation(staged, carrier), b"successor")
                self.assertFalse(
                    filesystem_promotion.recovery_path_for(target, self.recovery_id).exists()
                )

    def test_interruption_after_prior_move_restores_before_propagation(self) -> None:
        for carrier in self.carriers():
            with self.subTest(carrier=carrier), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                target = root / "accepted"
                staged = root / "staged"
                write_generation(target, carrier, b"prior")
                write_generation(staged, carrier, b"successor")
                interruption = InjectedInterruption("interrupted")
                operations = FaultingOperations(
                    {filesystem_promotion.PromotionOperation.ACTIVATE_SUCCESSOR: [interruption]}
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
                self.assertTrue(filesystem_promotion.retains_staged_recovery(interruption, staged))
                self.assertEqual(read_generation(target, carrier), b"prior")
                self.assertEqual(read_generation(staged, carrier), b"successor")

    def test_move_prior_post_effect_event_restores_and_reraises_original(self) -> None:
        for carrier in self.carriers():
            with self.subTest(carrier=carrier), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                target = root / "accepted"
                staged = root / "staged"
                write_generation(target, carrier, b"prior")
                write_generation(staged, carrier, b"successor")
                interruption = InjectedInterruption("after prior movement")
                operations = FaultingOperations(
                    {},
                    after_failures={
                        filesystem_promotion.PromotionOperation.MOVE_PRIOR: [interruption]
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
                self.assertFalse(
                    filesystem_promotion.recovery_path_for(
                        target,
                        self.recovery_id,
                    ).exists()
                )

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

    def test_restore_post_effect_event_retains_secondary_event_on_original(self) -> None:
        for carrier in self.carriers():
            with self.subTest(carrier=carrier), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                target = root / "accepted"
                staged = root / "staged"
                write_generation(target, carrier, b"prior")
                write_generation(staged, carrier, b"successor")
                activation = OSError("activation stopped")
                restoration_event = InjectedInterruption("after restoration")
                operations = FaultingOperations(
                    {filesystem_promotion.PromotionOperation.ACTIVATE_SUCCESSOR: [activation]},
                    after_failures={
                        filesystem_promotion.PromotionOperation.RESTORE_PRIOR: [restoration_event]
                    },
                )

                with self.assertRaises(OSError) as caught:
                    filesystem_promotion.promote_staged(
                        staged,
                        target,
                        carrier=carrier,
                        prior_present=True,
                        operations=operations,
                        recovery_id=self.recovery_id,
                    )

                self.assertIs(caught.exception, activation)
                self.assertEqual(
                    filesystem_promotion.recovery_events_for(activation),
                    (restoration_event,),
                )
                self.assertEqual(read_generation(target, carrier), b"prior")
                self.assertEqual(read_generation(staged, carrier), b"successor")

    def test_retain_failure_reports_successor_and_prior_at_observed_coordinates(
        self,
    ) -> None:
        for carrier in self.carriers():
            with self.subTest(carrier=carrier), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                target = root / "accepted"
                staged = root / "staged"
                write_generation(target, carrier, b"prior")
                write_generation(staged, carrier, b"successor")
                activation = InjectedInterruption("after successor activation")
                retention = OSError("successor retention stopped")
                operations = FaultingOperations(
                    {filesystem_promotion.PromotionOperation.RETAIN_SUCCESSOR: [retention]},
                    after_failures={
                        filesystem_promotion.PromotionOperation.ACTIVATE_SUCCESSOR: [activation]
                    },
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
                self.assertIs(error.primary_error, activation)
                self.assertIs(error.recovery_error, retention)
                self.assertEqual(
                    error.phase,
                    filesystem_promotion.PromotionOperation.RETAIN_SUCCESSOR,
                )
                self.assertEqual(
                    error.state,
                    filesystem_promotion.PromotionState(
                        staged_occupied=False,
                        target_occupied=True,
                        prior_occupied=True,
                    ),
                )
                self.assertEqual(read_generation(target, carrier), b"successor")
                self.assertEqual(read_generation(error.prior, carrier), b"prior")
                self.assertFalse(staged.exists())

    def test_retain_post_effect_event_restores_prior_and_reraises_original(
        self,
    ) -> None:
        for carrier in self.carriers():
            with self.subTest(carrier=carrier), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                target = root / "accepted"
                staged = root / "staged"
                write_generation(target, carrier, b"prior")
                write_generation(staged, carrier, b"successor")
                activation = InjectedInterruption("after successor activation")
                retention_event = OSError("after successor retention")
                operations = FaultingOperations(
                    {},
                    after_failures={
                        filesystem_promotion.PromotionOperation.ACTIVATE_SUCCESSOR: [activation],
                        filesystem_promotion.PromotionOperation.RETAIN_SUCCESSOR: [retention_event],
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

                self.assertIs(caught.exception, activation)
                self.assertEqual(
                    filesystem_promotion.recovery_events_for(activation),
                    (retention_event,),
                )
                self.assertEqual(read_generation(target, carrier), b"prior")
                self.assertEqual(read_generation(staged, carrier), b"successor")

    def test_no_prior_post_effect_event_returns_successor_to_ready_stage(self) -> None:
        for carrier in self.carriers():
            with self.subTest(carrier=carrier), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                target = root / "accepted"
                staged = root / "staged"
                write_generation(staged, carrier, b"successor")
                interruption = InjectedInterruption("after first activation")
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
                        prior_present=False,
                        operations=operations,
                    )

                self.assertIs(caught.exception, interruption)
                self.assertFalse(target.exists())
                self.assertEqual(read_generation(staged, carrier), b"successor")

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

    def test_cleanup_failure_keeps_successor_accepted_and_reports_prior_coordinate(
        self,
    ) -> None:
        for carrier in self.carriers():
            with self.subTest(carrier=carrier), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                target = root / "accepted"
                staged = root / "staged"
                write_generation(target, carrier, b"prior")
                write_generation(staged, carrier, b"successor")
                operations = FaultingOperations(
                    {
                        filesystem_promotion.PromotionOperation.REMOVE_PRIOR: [
                            OSError("cleanup stopped")
                        ]
                    }
                )

                outcome = filesystem_promotion.promote_staged(
                    staged,
                    target,
                    carrier=carrier,
                    prior_present=True,
                    operations=operations,
                    recovery_id=self.recovery_id,
                )
                with self.assertWarnsRegex(RuntimeWarning, "material is available"):
                    inspection_coordinate = filesystem_promotion.retire_prior(
                        outcome,
                        carrier=carrier,
                        operations=operations,
                    )

                prior = filesystem_promotion.recovery_path_for(target, self.recovery_id)
                self.assertEqual(outcome.prior, prior)
                self.assertEqual(inspection_coordinate, prior)
                self.assertEqual(read_generation(target, carrier), b"successor")
                self.assertEqual(read_generation(prior, carrier), b"prior")
                self.assertFalse(staged.exists())

    def test_partial_directory_cleanup_reports_inspectable_remaining_material(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            carrier = filesystem_promotion.PromotionCarrier.DIRECTORY
            target = root / "accepted"
            staged = root / "staged"
            write_generation(target, carrier, b"prior")
            (target / "removed-before-error.bin").write_bytes(b"retired-first")
            write_generation(staged, carrier, b"successor")
            operations = PartiallyRemovingDirectoryOperations()

            outcome = filesystem_promotion.promote_staged(
                staged,
                target,
                carrier=carrier,
                prior_present=True,
                operations=operations,
                recovery_id=self.recovery_id,
            )
            with self.assertWarnsRegex(RuntimeWarning, "remaining material"):
                inspection_coordinate = filesystem_promotion.retire_prior(
                    outcome,
                    carrier=carrier,
                    operations=operations,
                )

            self.assertEqual(read_generation(target, carrier), b"successor")
            self.assertEqual(inspection_coordinate, outcome.prior)
            self.assertTrue((outcome.prior / "generation.bin").is_file())
            self.assertFalse((outcome.prior / "removed-before-error.bin").exists())

    def test_successful_replacement_preserves_unrelated_sibling_bytes(self) -> None:
        for carrier in self.carriers():
            with self.subTest(carrier=carrier), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                target = root / "accepted"
                staged = root / "staged"
                unrelated = root / "unrelated.bin"
                unrelated.write_bytes(b"same-byte-sibling")
                write_generation(target, carrier, b"prior")
                write_generation(staged, carrier, b"successor")
                unrelated_digest = hashlib.sha256(unrelated.read_bytes()).hexdigest()

                outcome = filesystem_promotion.promote_staged(
                    staged,
                    target,
                    carrier=carrier,
                    prior_present=True,
                    recovery_id=self.recovery_id,
                )
                filesystem_promotion.retire_prior(outcome, carrier=carrier)

                self.assertEqual(read_generation(target, carrier), b"successor")
                self.assertEqual(
                    hashlib.sha256(unrelated.read_bytes()).hexdigest(),
                    unrelated_digest,
                )


if __name__ == "__main__":
    unittest.main()
