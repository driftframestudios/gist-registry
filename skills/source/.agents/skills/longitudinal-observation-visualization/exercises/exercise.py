"""Produce a bounded synthetic longitudinal SVG and exact-value companion."""
import argparse
import csv
import io
import json
from datetime import date
from html import escape
from pathlib import Path
from xml.etree import ElementTree

HERE = Path(__file__).resolve().parent


def segments(rows):
    """This fixture admits one record per unit/date and explicit expected gaps."""
    grouped = {}
    seen = set()
    for row in rows:
        key = row["unit"], row["date"]
        if key in seen:
            raise ValueError("Resolve repeated unit/date observations before connecting")
        seen.add(key)
        grouped.setdefault(row["unit"], []).append(row)
    result = []
    for unit in sorted(grouped):
        current = []
        for row in sorted(grouped[unit], key=lambda value: value["date"]):
            if row["status"] == "missing_expected":
                if current:
                    result.append(current)
                    current = []
            else:
                current.append(row)
        if current:
            result.append(current)
    return result


def produce():
    with (HERE / "observations.csv").open(newline="", encoding="utf-8") as stream:
        rows = list(csv.DictReader(stream))
    for row in rows:
        date.fromisoformat(row["date"])
        assert row["status"] in {"observed", "missing_expected"}
        assert (row["value"] == "") == (row["status"] == "missing_expected")
        if row["value"]:
            assert 0 <= float(row["value"]) <= 10
    parts = segments(rows)
    ids = lambda groups: [[row["record"] for row in group] for group in groups]
    assert ids(parts) == [["a1", "a2"], ["a4"], ["b1"]]
    assert ids(segments(list(reversed(rows)))) == ids(parts)
    assert ids(segments([row for row in rows if row["status"] == "observed"])) != ids(parts)
    try:
        segments(rows + [dict(rows[0], record="replicate")])
    except ValueError:
        pass
    else:
        raise AssertionError("A time tie needs an explicit policy")
    # A separately authored connected-scatter history returns in x as time advances.
    paired = [(1, 0, 10), (2, 4, 7), (3, 3, 9)]
    assert [point[0] for point in sorted(paired)] == [1, 2, 3]
    assert [point[0] for point in sorted(paired, key=lambda point: point[1])] == [1, 3, 2]
    # Sampling frequency changes row weighting, while a declared equal-unit mean stays 5.
    assert (0 + 10) / 2 == 5 and sum([0] * 10 + [10]) / 11 == 10 / 11
    x = lambda day: 80 + (date.fromisoformat(day) - date(2024, 1, 1)).days * 75
    y = lambda value: 350 - float(value) * 25
    assert x("2024-01-03") - x("2024-01-01") == 150
    assert x("2024-01-09") - x("2024-01-03") == 450
    svg = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 820 510" role="img" aria-labelledby="title desc">',
           '<title id="title">Observed support stays visible across a missing visit</title>',
           '<desc id="desc">Synthetic unit A has values 0, 4, missing, and 3 on January 1, 3, 5, and 9. Unit B has one value, 8, on January 2. Only A’s January 1 and 3 observations connect. Exact records accompany the figure.</desc>',
           '<rect width="820" height="510" fill="#ffffff"/>',
           '<g font-family="sans-serif" fill="#172b4d">',
           '<text x="40" y="36" font-size="23">Follow observations, preserve the gap</text>',
           '<text x="40" y="65" font-size="16">Synthetic measurements • January 2024 • partial period</text>',
           '<text x="40" y="95" font-size="15">Value (authored units); actual elapsed days on the horizontal axis</text>']
    for value in (0, 2, 4, 6, 8):
        svg += [f'<path d="M80,{y(value)} H680" stroke="#d7dde5"/>',
                f'<text x="65" y="{y(value)+5}" text-anchor="end" font-size="14">{value}</text>']
    for day in ("2024-01-01", "2024-01-03", "2024-01-05", "2024-01-09"):
        svg.append(f'<text x="{x(day)}" y="380" text-anchor="middle" font-size="14">Jan {int(day[-2:])}</text>')
    svg.append(f'<path d="M{x("2024-01-05")},120 V350" stroke="#777777" stroke-dasharray="4 5"/>')
    svg.append('<text x="395" y="137" font-size="14">A: expected visit missing</text>')
    for group in parts:
        if len(group) > 1:
            points = " ".join(f'{x(row["date"])},{y(row["value"])}' for row in group)
            svg.append(f'<polyline data-records="{" ".join(row["record"] for row in group)}" points="{points}" fill="none" stroke="#005a8d" stroke-width="2"/>')
    for row in rows:
        if row["status"] != "observed":
            continue
        cx, cy = x(row["date"]), y(row["value"])
        if row["unit"] == "A":
            svg.append(f'<circle data-record="{row["record"]}" cx="{cx}" cy="{cy}" r="5" fill="#005a8d"/>')
        else:
            svg.append(f'<rect data-record="{row["record"]}" x="{cx-5}" y="{cy-5}" width="10" height="10" fill="#9b4a00"/>')
        svg.append(f'<text x="{cx+10}" y="{cy-9}" font-size="15">{escape(row["unit"])}: {row["value"]}</text>')
    svg += ['<text x="40" y="420" font-size="15">Circles: A • square: B. Lines relate observed endpoints.</text>',
            '<text x="40" y="445" font-size="15">Missing visits split paths; isolated observations retain visible marks.</text>',
            '<text x="40" y="475" font-size="14">Source: authored synthetic fixture. Companion: values.csv.</text>', '</g></svg>']
    out = io.StringIO(newline="")
    writer = csv.DictWriter(out, fieldnames=["record", "unit", "date", "value", "status"], lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    table = "".join("<tr>" + "".join(f"<td>{escape(row[key] or 'Unavailable')}</td>" for key in
                    ("record", "unit", "date", "value", "status")) + "</tr>" for row in rows)
    html = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Follow observed support</title><style>body{font:1rem/1.5 system-ui,sans-serif;color:#172b4d;margin:1.5rem;max-width:60rem}a{color:#005a8d}.scroll{overflow:auto}img{display:block;max-width:none}table{border-collapse:collapse}th,td{padding:.5rem;text-align:left;border-bottom:1px solid #aab7c4}caption{text-align:left;font-weight:600;margin:.5rem 0}</style>
<main><h1>Follow observed support</h1><p>Synthetic measurements of two units. A missing scheduled visit splits A's history; zero and isolated observations remain visible.</p>
<figure style="margin:0"><div class="scroll" tabindex="0" role="region" aria-label="Full-size figure; scroll horizontally on narrow screens"><img src="example.svg" width="820" height="510" alt="A has observed values 0, 4, and 3, with a missing visit before the last value. B has one observation at 8. Exact dates and values follow."></div><figcaption><a href="example.svg">Open full-size SVG</a> · <a href="values.csv">Download exact values</a>. Lines relate observed endpoints; intervening values remain unspecified.</figcaption></figure>
<div class="scroll" tabindex="0" role="region" aria-label="Exact observations"><table><caption>Authored synthetic observations; value units are illustrative</caption><thead><tr><th scope="col">Record</th><th scope="col">Unit</th><th scope="col">Date</th><th scope="col">Value</th><th scope="col">Status</th></tr></thead><tbody>''' + table + '</tbody></table></div></main></html>\n'
    svg_text = "\n".join(svg) + "\n"
    root = ElementTree.fromstring(svg_text)
    assert [element.attrib["data-record"] for element in root.iter()
            if "data-record" in element.attrib] == ["a1", "a2", "a4", "b1"]
    assert [element.attrib["data-records"] for element in root.iter()
            if "data-records" in element.attrib] == ["a1 a2"]
    return {"example.svg": svg_text, "example.html": html, "values.csv": out.getvalue(),
            "expected-segments.json": json.dumps(ids(parts), indent=2) + "\n"}


if __name__ == "__main__":
    if not __debug__:
        raise RuntimeError("Run this executable exercise with Python assertions enabled")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--output", type=Path, default=HERE)
    args = parser.parse_args()
    outputs = produce()
    for name, content in outputs.items():
        path = args.output / name
        if args.check:
            assert path.read_text(encoding="utf-8") == content, f"Regenerate {name}"
        else:
            args.output.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
    print("PASS: gap, zero, singleton, identity, elapsed spacing, tie rejection, path order, weighting, exact companions")
