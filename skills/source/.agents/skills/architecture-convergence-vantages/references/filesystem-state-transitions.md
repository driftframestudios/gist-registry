# Filesystem state-transition vantages

Load this reference when a collaboration evaluates staged output, path status,
directory replacement, symlink handling, rollback, or crash recovery.

## Begin with the operating model

| Operating model | Primary design need | Evidence that can establish it |
| --- | --- | --- |
| One writer in one process | Clear failure and restoration behavior | Focused fault injection around each mutation |
| Participating concurrent writers | Ownership-safe cooperative exclusion and one accepted generation | Atomic acquisition, held-contention, owner-checked release, stale-owner recovery, and multi-process generation checks |
| Process or host interruption | Durably recorded phase identity and deterministic re-entry | The persistence protocol plus restart checks from every durably recorded phase |
| Non-participating actor with parent-directory write authority | A stronger authorization boundary | Parent permissions, sandboxing, or another named platform control |
| Concurrent readers requiring complete generations | Old-or-new visibility through a reader-safe interval | Immutable generations, an atomic reference switch, a one-resolution reader protocol, and retention and cleanup checks |

## Mechanism distinctions

- `exists()`, `is_dir()`, `is_file()`, `is_symlink()`, and cached status are
  observations at one time. They do not reserve a directory entry.
- Saving a status result can reduce a metadata lookup. It also carries an older
  observation forward, so its value is readability or measured syscall cost
  rather than freshness or TOCTOU protection.
- EAFP lets the attempted operation carry the decision when one primitive
  supplies the required conditional semantics. A sequence of mutations remains
  a recovery protocol.
- An individual rename inherits its operating-system and filesystem contract.
  Where that contract promises atomic visibility, the guarantee covers that
  one directory-entry transition. `target -> backup -> successor` remains a
  multi-step recovery protocol with intermediate states.
- A sibling backup supplies a recovery coordinate. Demonstrated recoverability
  comes from restoration-state checks; crash durability additionally requires
  a persistence protocol.
- On supporting platforms, relative `os.*` operations with `dir_fd` resolve
  from an already-open directory descriptor. Parent write authority and each
  operation's symlink semantics remain separate boundaries.
- `pathlib.Path.rename()` exposes the path-based operation. Descriptor-relative
  or exchange behavior requires a deliberate lower-level or platform-specific
  route.

## Descriptor-bound sentinel verification

When symlink replacement is part of the declared Unix threat model, bind the
sentinel read to opened file descriptors rather than validating one pathname
and reading it again later:

1. Open the trusted parent directory and retain its descriptor.
2. Open the candidate directory as one leaf relative to that descriptor with
   directory and no-follow flags.
3. Verify the opened directory with `fstat`.
4. Open the sentinel as one leaf relative to the directory descriptor with
   read-only and no-follow flags.
5. Verify a regular file with `fstat`, then read and parse JSON from that same
   descriptor.
6. Close every acquired descriptor on success and on each failure route.

This route establishes that parsing uses the two objects actually opened and
that the sentinel's final path component did not resolve through a symbolic
link. `O_NOFOLLOW` alone applies to the trailing component on common POSIX
systems; a trusted parent descriptor and one-leaf relative opens keep mutable
prefix traversal outside this bounded lookup.

Keep the adjacent limits explicit:

- A regular-file result does not authenticate ownership. A fixed JSON marker
  can be copied, and a permitted hard link can still name the same inode.
- A descriptor-bound read does not bind a later name-based rename to that
  opened inode. A process with write authority in the parent can replace the
  directory entry between verification and promotion or cleanup.
- Python's descriptor-relative path support and flag availability vary by
  platform. A Windows implementation needs its own handle and reparse-point
  contract rather than a silent weakening of the Unix guarantee.

Use descriptor-bound verification as defense-in-depth when the supported
platforms and threat model earn it. Use parent permissions or sandboxing for a
non-participating actor with equal directory authority, and use writer
coordination plus recovery state for participating processes. Describe the
combined result by those guarantees rather than as complete TOCTOU removal.

## Constructive option map

### Trusted parent and one writer

Use a linear EAFP state transition, keep the prior generation until the new
generation is verified, and make promotion and restoration failures separately
observable. This is the smallest fitting route for a declared single-writer
command.

### Participating writers and restart recovery

Acquire an ownership-bearing sibling lock or lease whose acquisition, held
interval, owner-checked release, stale-owner reconciliation, and recovery
behavior are explicit. Assign a transaction-specific recovery coordinate,
persist the current phase through the declared durability protocol, perform the
bounded mutations, and reconcile every durably recorded phase on re-entry.

For a declared local-POSIX contract, a persistent sibling lock file held by an
operating-system advisory lock is a compact option: the open descriptor carries
ownership, process exit releases the kernel lock, owner data remains diagnostic,
and the next owner reconciles any existing journal before beginning another
transaction. Distributed or time-expiring leases require fencing and their own
filesystem or network contract.

### Complete-generation reader visibility

Write immutable version directories, validate them completely, then atomically
replace a small reader-facing manifest or equivalent reference. Each reader
resolves the reference once and retains the selected generation through its
use; cleanup honors that retention interval. This changes the reader protocol
and earns its cost when concurrent readers need complete old-or-new
generations.

### Platform-specific exchange

A platform primitive such as Linux `renameat2(RENAME_EXCHANGE)` can atomically
exchange directory entries on supported filesystems. Keep it as a named variant
when that platform contract is deliberate; it is not the portable default.

## Recovery and exception boundary

`Path.rename()` ordinarily reports filesystem failures through `OSError`.
`Exception` also catches events such as `MemoryError`, while
`KeyboardInterrupt`, `SystemExit`, and `GeneratorExit` inherit directly from
`BaseException`. Changing the caught class therefore changes restoration
behavior.

Once the prior accepted target has moved, restoration is an invariant-recovery
operation. Keep an inner cleanup envelope small, let it receive every Python
exception that reaches it, restore the invariant, and immediately re-raise the
original event. When restoration also stops, retain both failure objects and
every recovery coordinate in one typed surface. An outer public error boundary
can remain narrowly focused on expected `OSError` subclasses. This cleanup
covers Python exceptions while the process can execute; persisted recovery
carries process or host interruption.

That restoration example preserves the original event under its declared
caller policy. A receiver that gives a later cleanup control signal precedence
must select that policy explicitly and test both failure orderings. The
[resource-ownership contract](https://kindlight.io/skills/interruption-safe-resource-ownership/)
supplies the separate release-attempt and final-failure decision; the selected
architecture retains its own public exception and recovery-state contract.

## Marker comments

```python
# TARGET: Let the operation nearest the state transition observe current
# filesystem state; preflight observations remain descriptive.

# CONTRAST: Caching an existence result reduces one lookup while carrying an
# older observation into later control flow.

# GUARD: Once the accepted target moves, the mutation-critical cleanup boundary
# restores the invariant for every Python exception it receives, immediately
# re-raises the original event, and retains both causes if restoration also
# stops.
```

## Test architecture

Let tests express the protocol rather than the incidental shape of one
implementation. When directory outputs and regular-file captures share the
same replacement semantics, give them one transition contract with
carrier-specific validation and cleanup adapters.

Use four complementary layers:

1. **Pure reconciliation table:** Map recorded phase plus observed generation
   identities to one next action or a typed conflict. Exercise every finite
   state and require a second reconciliation to be a no-op.
2. **Real-filesystem transition contracts:** Use a temporary sibling layout and
   a narrow filesystem adapter whose semantic operations name the transition,
   such as moving the prior generation, activating the successor, restoring
   the prior generation, and retiring recovery material. Inject failures at
   those boundaries while asserting complete filesystem state.
3. **Coordinated process contracts:** Use spawned processes and explicit
   parent-child messages or barriers to create exact interleavings. Timeouts
   diagnose a stopped test; elapsed time does not decide correctness.
4. **Capability-bound platform contracts:** Exercise descriptor, symbolic-link,
   advisory-lock, and filesystem behavior only where the declared platform
   supplies it. Return an explicit unsupported-capability result when a
   required guarantee is unavailable.

A sorted tree snapshot can record entry kind, relative name, symbolic-link
target without following it, and regular-file digest. State-transition
assertions then establish that:

- authority failure changes neither generation;
- prior accepted bytes remain at the target or the transaction-owned recovery
  coordinate until publication settles;
- staged bytes remain recoverable until they become accepted or a caller
  explicitly retains cleanup ownership;
- promotion failure plus successful restoration returns the prior generation
  and re-raises the original event;
- promotion plus restoration failure retains both events, transaction phase,
  and recovery coordinates in one typed surface;
- cleanup failure leaves the successor accepted and the prior generation
  inspectable; and
- unrelated sibling entries remain byte-identical.

Public caller tests remain necessary. An outer `except` or `finally` cleanup can
remove staged recovery material after the transition layer has deliberately
retained it, so test the complete command boundary as well as the internal
promotion helper.

Keep the ordinary suite deterministic and dependency-proportional. A finite
transition matrix, semantic failpoints, and spawned-process coordination are a
strong initial route with the standard library. Add property-based generation
after a larger state space or a second protocol demonstrates decision-changing
coverage. Keep actual power-loss durability, alternate filesystems, native
Windows handle semantics, and a non-participating writer with equal parent
authority as named probes until their environments and receivers are explicit.

## Focused behavior checks

- A late target appearance follows the declared replace policy without
  clobbering unrelated state.
- Lock contention leaves staged and accepted generations unchanged.
- Promotion failure restores the prior generation and preserves the original
  failure.
- Promotion plus restoration failure retains both failures and the backup.
- Public analysis and collection callers retain staged and prior generations
  when promotion and restoration both stop.
- Cleanup failure keeps the promoted generation active and the prior backup
  inspectable.
- A cross-device error follows the same recovery contract.
- Broken symlinks and occupied recovery coordinates follow explicit policy.
- Descriptor-bound sentinel checks reject a final-component symlink and parse
  from the verified open file when the supported Unix route is enabled.
- Platform-specific sentinel adapters meet their declared handle and
  reparse-point contract without inheriting Unix-only guarantees by name.
- Every persisted recovery phase has one deterministic restart outcome.
- Two participating processes converge on one accepted generation and one
  bounded contention result.
- Reconciliation from each durably recorded phase is idempotent; contradictory
  or identity-mismatched state stops with every coordinate preserved.
- Crash-durability language appears only with the matching file and directory
  synchronization behavior and observation.

State-transition assertions supply safety evidence. Call-count assertions can
separately characterize lookup cost; freshness and race behavior receive their
own observations.

## Primary contract anchors

Re-read these contracts for the runtime and platform a successor declares:

- [Python `os` — files and directories](https://docs.python.org/3.12/library/os.html#files-and-directories)
- [Python `pathlib.Path.rename`](https://docs.python.org/3.12/library/pathlib.html#pathlib.Path.rename)
- [Python exception hierarchy](https://docs.python.org/3.12/library/exceptions.html#exception-hierarchy)
- [Linux `open(2)`](https://man7.org/linux/man-pages/man2/open.2.html)
- [Linux `renameat2(2)`](https://man7.org/linux/man-pages/man2/renameat2.2.html)
- [Windows `CreateFile`](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)
