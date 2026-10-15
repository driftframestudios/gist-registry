# Equal result, complete-operation cost

The [standard-library exercise](exercise.py) compares repeated category scans
with one-pass counting. Python 3.11 or later runs the correctness gate:

```sh
python3 .agents/skills/parity-bound-workload-measurement/exercises/exercise.py
```

Literal expected canonical output, an empty list, and invalid-shape error parity
establish the common behavior. A distinct-count shortcut fails the same count
oracle. Optional local timing uses 4,096 authored records and 16 categories,
includes parse/admit/count/serialize, alternates variant order, and retains all
trials after one warmup per variant:

```sh
python3 .agents/skills/parity-bound-workload-measurement/exercises/exercise.py --measure --trials 5 --output /tmp/workload-observation.json
```

The local JSON records source/input/output digests, runtime/platform, workload,
order, all durations, median/range, and an explicitly bounded disposition. It
contains no network or host-name locator. Retain it locally while reviewing the
normalized result; the receiving PR remains the single durable public return.
Timing jobs on the same host should run serially. Variable timing does not enter
a byte-equality test or a universal CI threshold.

This skill-refinement task supplies an actual receiving exercise, with independent
review recorded in the PR. Local timing describes this warm synchronous profile;
allocation peaks, cold process cost, concurrent clients, database plans, I/O,
energy, and field performance remain separate observations. If an actual trial
fails, preserve its failure and stop that run; complete-run summaries require
complete accounting rather than silently dropping unsuccessful trials.
