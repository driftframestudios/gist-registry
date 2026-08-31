# Pattern 2 — Promote only owned output and keep recovery available

The workflow recognizes its output through an exact sentinel. Replacement is
explicit, a prior accepted directory moves to a sibling recovery path, and a
failed promotion restores that prior state.

## Source selection

From `document_evidence.py::_require_owned_output_directory` and
`_promote_staged_directory`:

```python
def _require_owned_output_directory(path: Path, label: str) -> None:
    if path.is_symlink():
        raise EvidenceWorkflowError(f"{label} must not be a symbolic link: {path}")
    if not path.is_dir():
        raise EvidenceWorkflowError(f"{label} must be a directory: {path}")
    sentinel = path / OUTPUT_SENTINEL
    if sentinel.is_symlink() or not sentinel.is_file():
        raise EvidenceWorkflowError(
            f"{label} is not an owned {ARTIFACT_ID} output; preserving it unchanged: {path}"
        )
    try:
        record = json.loads(sentinel.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise EvidenceWorkflowError(
            f"{label} has an unreadable ownership sentinel: {path}"
        ) from error
    if record != _output_sentinel_record():
        raise EvidenceWorkflowError(
            f"{label} has a different ownership sentinel; preserving it unchanged: {path}"
        )


def _promote_staged_directory(staged: Path, target: Path, *, replace: bool) -> None:
    _require_owned_output_directory(staged, "staged output")
    if target.is_symlink():
        raise EvidenceWorkflowError(f"output must not be a symbolic link: {target}")
    if target.exists():
        if not replace:
            raise OutputExistsError(
                f"output already exists: {target}; choose a new path or pass --replace"
            )
        _require_owned_output_directory(target, "existing output")
    backup: Path | None = None
    if target.exists():
        backup = target.with_name(f".{target.name}.previous-{os.getpid()}")
        if backup.exists() or backup.is_symlink():
            raise EvidenceWorkflowError(f"recovery path already exists: {backup}")
        target.rename(backup)
    try:
        staged.rename(target)
    except Exception:
        if backup is not None and not target.exists():
            backup.rename(target)
        raise
    else:
        if backup is not None:
            try:
                shutil.rmtree(backup)
            except OSError as error:
                warnings.warn(
                    f"replacement completed; prior output remains at {backup} because "
                    f"cleanup did not complete: {error}",
                    RuntimeWarning,
                    stacklevel=2,
                )
```

## Specification by example

One test proves that an unowned directory stays byte-for-byte unchanged.
Another injects a staged-promotion failure and observes the prior accepted
output at its original target.

```python
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
```

```python
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
```

The observation establishes owner recognition, explicit replacement, and
prior-state rollback for this implementation. Cross-device moves, remote
filesystems, and process-level concurrency remain receiver-specific storage
observations.
