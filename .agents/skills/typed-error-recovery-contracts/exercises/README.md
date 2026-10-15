# A complete review boundary

This synthetic receiving operation admits sources of at most 128 bytes,
binds the received bytes to an earlier review digest, admits one small JSON
shape, invokes an owned calculation, and then replaces process-local accepted
bytes. The injected reader's own I/O budget is outside this small example; the
post-read cap protects subsequent parsing and hashing.

Run with Python 3.11 or later and its standard library:

```sh
python3 .agents/skills/typed-error-recovery-contracts/exercises/exercise.py
```

The [exercise](exercise.py) uses direct error classes because three recovery
decisions need no factory. Four routes were considered: message-string parsing,
a finite catalog/factory, framework-native errors, and direct domain subclasses.
Direct subclasses preserve a familiar catch base with a fixed structured public
projection; a repeated catalog or framework-owned admission could favor the
other routes.

Literal expectations establish the public type/code/message/recovery, retained
diagnostic cause, changed-source/capacity rejection, prior accepted bytes, and
successful replacement. An OSError raised by owned calculation must propagate
unchanged even though an OSError from the source reader is translated. That
neighboring failure distinguishes a broad catch from the intended scope.
RuntimeError and KeyboardInterrupt retain exact identity. Public projection
excludes raw diagnostic text while the authorized exception object retains it.

This exercise was applied during the Registry's skill-refinement receiving
task. The receiving pull request records execution and independent review.
The [earlier source-reading exercise](offline-review-boundary.md) retains its
historical standing. Process-local replacement supplies no filesystem or
distributed publication guarantee; real parser scaling, framework behavior,
cleanup groups, retry, and durable recovery need their own receiving tests.
