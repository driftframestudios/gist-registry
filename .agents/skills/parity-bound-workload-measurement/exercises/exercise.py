"""Gate semantic parity, optionally measure complete synthetic operations."""
import argparse
import hashlib
import json
import platform
import statistics
import sys
from collections import Counter
from pathlib import Path
from time import perf_counter_ns


def pipeline(raw, candidate):
    values = json.loads(raw)
    if type(values) is not list or any(type(value) is not str for value in values):
        raise ValueError("The workload requires a list of category strings")
    if candidate:
        counts = Counter(values)
    else:
        counts = {key: sum(value == key for value in values) for key in sorted(set(values))}
    return json.dumps(dict(sorted(counts.items())), separators=(",", ":")).encode("utf-8")


def checks():
    raw = b'["a","b","a",""]'
    expected = b'{"":1,"a":2,"b":1}'
    assert pipeline(raw, False) == pipeline(raw, True) == expected
    assert pipeline(b'[]', False) == pipeline(b'[]', True) == b'{}'
    for raw in (b'[1]', b'{}', b'[true]'):
        failures = []
        for candidate in (False, True):
            try:
                pipeline(raw, candidate)
            except ValueError as error:
                failures.append((type(error), str(error)))
        assert failures == [(ValueError, "The workload requires a list of category strings")] * 2
    assert b'{"a":1,"b":1}' != expected, "A distinct-count candidate fails the count oracle"


def measure(trials):
    records = [f"category-{i % 16:02d}" for i in range(4096)]
    raw = json.dumps(records, separators=(",", ":")).encode()
    expected = json.dumps({f"category-{i:02d}": 256 for i in range(16)}, separators=(",", ":")).encode()
    assert pipeline(raw, False) == pipeline(raw, True) == expected
    observed = []
    for trial in range(trials):
        for candidate in ((False, True) if trial % 2 == 0 else (True, False)):
            start = perf_counter_ns()
            value = pipeline(raw, candidate)
            duration = perf_counter_ns() - start
            assert value == expected
            observed.append({"trial": trial, "variant": "candidate" if candidate else "baseline",
                             "duration_ns": duration, "status": "completed"})
    summary = {}
    for variant in ("baseline", "candidate"):
        values = [row["duration_ns"] for row in observed if row["variant"] == variant]
        summary[variant] = {"trials": len(values), "median_ns": statistics.median(values),
                            "minimum_ns": min(values), "maximum_ns": max(values)}
    return {"scope": "synthetic process-local warm parse/admit/count/serialize",
            "python": platform.python_version(), "implementation": sys.implementation.name,
            "platform": {"system": platform.system(), "release": platform.release(), "machine": platform.machine()},
            "source_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            "input_sha256": hashlib.sha256(raw).hexdigest(), "input_bytes": len(raw),
            "output_sha256": hashlib.sha256(expected).hexdigest(), "output_bytes": len(expected),
            "records": 4096, "categories": 16, "warmup": "one complete call per variant before timing",
            "observations": observed, "summary": summary,
            "disposition": "indeterminate beyond this descriptive workload; no universal performance threshold"}


if __name__ == "__main__":
    if not __debug__:
        raise RuntimeError("Run this executable exercise with Python assertions enabled")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--measure", action="store_true")
    parser.add_argument("--trials", type=int, default=5)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    checks()
    if args.measure:
        if not 2 <= args.trials <= 20 or args.output is None:
            parser.error("Measurement requires 2–20 trials and an explicit --output file")
        args.output.write_text(json.dumps(measure(args.trials), indent=2) + "\n", encoding="utf-8")
    print("PASS: independent literal result, empty case, failure parity; optional timing remains descriptive")
