# Equal result, complete-operation cost

The [standard-library exercise](exercise.py) compares repeated category scans
with one-pass counting. Python 3.11 or later runs the correctness gate:

```sh
python3 .agents/skills/parity-bound-workload-measurement/exercises/exercise.py
```

Literal expected canonical output, an empty list, and invalid-shape error parity
establish the common behavior. A distinct-count shortcut fails the same count
oracle. A later ordinary operation failure retains the earlier completed sample
and the failed attempt, stops further calls, and leaves the summary absent.
A wrong-result control receives the same incomplete standing; caller interruption
propagates with its original identity. Optional local timing uses 4,096 authored records and 16 categories,
includes parse/admit/count/serialize, alternates variant order, and retains all
trials after one warmup per variant:

```sh
python3 .agents/skills/parity-bound-workload-measurement/exercises/exercise.py --measure --trials 5 --output /tmp/workload-observation.json
```

The local JSON records source/input/output digests, runtime/platform, workload,
order, warmup outcomes, measured durations, complete-run median/range, and an explicitly bounded disposition. It
contains no network or host-name locator. Retain it locally while reviewing the
normalized result; the receiving PR remains the single durable public return.
Timing jobs on the same host should run serially. Variable timing does not enter
a byte-equality test or a universal CI threshold.

This skill-refinement task supplies an actual receiving exercise, with independent
review recorded in the PR. Local timing describes this warm synchronous profile;
allocation peaks, cold process cost, concurrent clients, database plans, I/O,
energy, and field performance remain separate observations. An ordinary operation
failure or result mismatch produces an incomplete local receipt with a fixed
failure category; the CLI writes that receipt and exits nonzero. A failed sample's
duration describes its failed attempt and enters no complete-run summary.
Control interruption propagates immediately; this small process-local example
has no interruption checkpoint or durable output-write recovery. Preserve such
a run's diagnostic through the invoking task and select an owned checkpoint or
publication protocol when interrupted-run recovery becomes a requirement.
