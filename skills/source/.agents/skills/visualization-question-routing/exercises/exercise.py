"""Exercise three authored questions; this is not an automatic chart selector."""
import argparse
import csv
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


def contracts(rows):
    """Return explicit decisions for this synthetic receiving task."""
    return [
        {
            "question": "How did A's x change within each observed year?",
            "reader_task": "compare recurring within-unit change",
            "data_meaning": "one unit measurement at an observed year/month",
            "statistical_operation": "select unit A; partition by year; retain raw values",
            "visual_channel": "month position, year group, observed dots",
            "form": "year-grouped dots with explicit endpoint connections",
            "time_role": "group and within-year coordinate",
            "records": [row["record"] for row in rows if row["unit"] == "A"],
            "limit": "January and March observations establish partial annual support",
        },
        {
            "question": "How does the observed x-y relationship differ by year?",
            "reader_task": "compare associations within annual subsets",
            "data_meaning": "paired measures on repeated units",
            "statistical_operation": "condition on year; retain identities; no inferential fit",
            "visual_channel": "x and y position, year panel, unit labels",
            "form": "two common-scale scatter panels",
            "time_role": "condition",
            "records": [row["record"] for row in rows],
            "limit": "Repeated units remain dependent; panel appearance supplies no causal adjustment",
        },
        {
            "question": "What exact values were recorded for A in January 2024?",
            "reader_task": "exact lookup",
            "data_meaning": "one observed paired measurement",
            "statistical_operation": "select unit A, year 2024, month 1",
            "visual_channel": "labeled table cells",
            "form": "one-row table",
            "time_role": "condition",
            "records": [row["record"] for row in rows if
                        (row["unit"], row["year"], row["month"]) == ("A", "2024", "1")],
            "limit": "Other times remain outside this lookup",
        },
    ]


def validate_contract(contract):
    required = ("question", "reader_task", "data_meaning", "statistical_operation",
                "visual_channel", "form", "time_role", "records", "limit")
    if any(key not in contract or not contract[key] for key in required):
        raise ValueError("A receiving contract requires meaning, operation, encoding, and task")


def produce():
    with (HERE / "records.csv").open(newline="", encoding="utf-8") as stream:
        rows = list(csv.DictReader(stream))
    result = contracts(rows)
    assert [item["records"] for item in result] == [
        ["r1", "r2", "r5", "r6"],
        ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"], ["r5"]]
    assert (rows[4]["x"], rows[4]["y"]) == ("3", "10")
    for item in result:
        validate_contract(item)
    # A highlight retains all eligible records; filtering produces another population.
    highlighted = [(row["record"], row["unit"] == "A") for row in rows]
    assert len(highlighted) == 8 and sum(selected for _, selected in highlighted) == 4
    assert len(result[0]["records"]) == 4
    try:
        validate_contract({"form": "line chart"})
    except ValueError:
        pass
    else:
        raise AssertionError("A chart name alone supplied a contract")
    return json.dumps({"provenance": "authored synthetic exercise", "contracts": result},
                      indent=2, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    if not __debug__:
        raise RuntimeError("Run this executable exercise with Python assertions enabled")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--output", type=Path, default=HERE)
    args = parser.parse_args()
    content = produce()
    target = args.output / "view-contracts.json"
    if args.check:
        assert target.read_text(encoding="utf-8") == content, "Regenerate the exercise contract"
    else:
        args.output.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    print("PASS: three authored view contracts, selection/highlight distinction, chart-only rejection")
