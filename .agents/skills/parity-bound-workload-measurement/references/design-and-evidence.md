# Parity before workload comparison

Sources inspected 2026-10-15. The measured object is the named operation and
environment. Each additional phase enters only when it can change the decision.

## Four routes

1. **Complexity/source reasoning:** sufficient to identify changed asymptotic work; supplies no wall-clock observation.
2. **Inner-loop timing:** useful for a local mechanism; excludes preparation, serialization, and shifted work.
3. **Complete-operation paired timing with semantic gates:** selected in the exercise; preserves output and failure meaning before comparing parse/admit/group/serialize work.
4. **A benchmark suite or configured runtime campaign:** fitting for repeated decisions, concurrency, tail behavior, database plans, or platform effects; earns its setup and maintenance through those receiving questions.

## Evidence → rule → observation

- Official [Python `perf_counter`](https://docs.python.org/3.12/library/time.html#time.perf_counter) defines a high-resolution duration clock whose differences are meaningful. **Rule:** measure complete elapsed intervals with a declared clock and scope. **Observation:** the optional exercise times each complete parse/admit/count/serialize call and retains every trial. Nanosecond representation does not establish nanosecond measurement accuracy.
- Official [pyperf benchmark guidance](https://pyperf.readthedocs.io/en/latest/run_benchmark.html) describes unstable results, environment effects, and controlled runs. **Rule:** record environment, order, sample size, failures, warm state, and all observations; treat small samples as descriptive. **Observation:** the exercise alternates variant order, records a separate warmup, and reports median/range rather than an unsupported tail percentile. The small example is not a replacement for pyperf's calibrated methodology.
- [Python JSON documentation](https://docs.python.org/3.12/library/json.html) establishes encoding/decoding behavior and resource considerations. **Rule:** include those phases when comparing mechanisms whose outputs cross that boundary. **Observation:** literal expected counts, exact canonical result bytes, and matching error families gate every timed candidate. Faster output with different semantics fails before timing.

## Cost and transfer

For n records and g categories, the baseline scans all records for each category
after preparing keys: O(n·g + g log g). The candidate counts once and sorts keys:
O(n + g log g). Both parse/copy/serialize work and retained result space remain
in the full path. The exercise reports input/output bytes and this structural
analysis, while actual allocation peaks remain unmeasured. A cache would add a
retained-state and invalidation owner; no cache enters this comparison.

The first timing sample can include code/data warmup; the exercise records an
untimed warmup and still calls the resulting process-local profile warm. It
changes no host tuning or interpreter configuration. One local run supports a
bounded descriptive observation, not an adoption claim for all workloads or an
energy/carbon result. A natural SQL receiver adds its actual query plans,
cardinality, I/O, concurrency, and runtime identity through the receiving PR.
