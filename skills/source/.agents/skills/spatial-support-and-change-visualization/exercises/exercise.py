"""Produce a schematic two-year comparison with explicit spatial support."""
import argparse
import csv
import io
import json
from fractions import Fraction
from html import escape
from pathlib import Path
from xml.etree import ElementTree

HERE = Path(__file__).resolve().parent
COLORS = ("#eef5fa", "#c7deeb", "#90bdd2", "#619fba")


def rate(row):
    events, exposure = int(row["events"]), int(row["exposure"])
    if exposure < 0 or events < 0 or events > exposure:
        raise ValueError("This binary-event fixture requires 0 <= events <= exposure")
    return Fraction(events * 100, exposure) if exposure else None


def category(value):
    if value is None:
        return None
    return sum(value >= edge for edge in (5, 10, 15))


def compare(before, after):
    if before["support"] != after["support"]:
        return {"state": "held_changed_support", "percentage_points": None}
    a, b = rate(before), rate(after)
    if a is None or b is None:
        return {"state": "unavailable", "percentage_points": None}
    return {"state": "comparable", "percentage_points": str(b - a)}


def produce():
    with (HERE / "regions.csv").open(newline="", encoding="utf-8") as stream:
        rows = list(csv.DictReader(stream))
    keys = [(row["region"], row["year"]) for row in rows]
    assert len(set(keys)) == len(rows)
    indexed = dict(zip(keys, rows))
    assert set(keys) == {(region, year) for region in ("North", "South", "West") for year in ("2023", "2024")}
    assert [rate(row) for row in rows] == [10, 2, None, 20, 0, 5]
    assert [category(rate(row)) for row in rows] == [2, 0, None, 3, 0, 1]
    comparisons = {region: compare(indexed[region, "2023"], indexed[region, "2024"])
                   for region in ("North", "South", "West")}
    assert comparisons == {
        "North": {"state": "comparable", "percentage_points": "10"},
        "South": {"state": "comparable", "percentage_points": "-2"},
        "West": {"state": "held_changed_support", "percentage_points": None}}
    assert compare(dict(rows[0], exposure="0", events="0"), rows[3])["state"] == "unavailable"
    # The same magnitude maps to the same class in each panel, independent of neighbors.
    assert category(Fraction(10)) == 2
    assert sum(Fraction(10) >= edge for edge in (20, 40, 60)) != category(Fraction(10))
    # A same-ID geography change remains held even with numeric observations on both sides.
    assert compare(rows[0], dict(rows[3], support="synthetic-v2"))["state"] == "held_changed_support"
    # Geographic route interpretation needs a separate discontinuity owner.
    longitude_samples = (179, -179)
    assert abs(longitude_samples[1] - longitude_samples[0]) > 180
    svg = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 850 580" role="img" aria-labelledby="title desc">',
           '<title id="title">Compare rates on a shared scale and retain changed support</title>',
           '<desc id="desc">Schematic regions in 2023 and 2024: North changes from 10 to 20 percent; South from 2 to 0 percent. West has no exposure in 2023 and 5 percent on changed support in 2024; its change is held. Exact counts and denominators accompany the figure.</desc>',
           '<defs><pattern id="unavailable" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#f2f2f2"/><path d="M0,8 L8,0" stroke="#bbbbbb"/></pattern></defs>',
           '<rect width="850" height="580" fill="white"/>',
           '<g font-family="sans-serif" fill="#172b4d">',
           '<text x="35" y="35" font-size="23">Compare years on one rate scale</text>',
           '<text x="35" y="65" font-size="16">Schematic synthetic regions • binary events per 100 exposures</text>']
    shapes = {"North": (0, 0, 160, 100), "South": (0, 110, 160, 100), "West": (170, 0, 150, 210)}
    for year, left in (("2023", 55), ("2024", 465)):
        svg.append(f'<text x="{left}" y="105" font-size="21">{year}</text>')
        for region, (dx, dy, width, height) in shapes.items():
            row = indexed[region, year]
            value = rate(row)
            fill = "url(#unavailable)" if value is None else COLORS[category(value)]
            x, y = left + dx, 125 + dy
            svg.append(f'<rect data-region="{region}" data-year="{year}" data-rate="{"unavailable" if value is None else value}" x="{x}" y="{y}" width="{width}" height="{height}" fill="{fill}" stroke="#172b4d"/>')
            svg.append(f'<text x="{x+12}" y="{y+30}" font-size="18">{escape(region)}</text>')
            label = "Unavailable" if value is None else f"{value}%"
            svg.append(f'<text x="{x+12}" y="{y+58}" font-size="20">{label}</text>')
            if row["support"] == "synthetic-v2":
                svg.append(f'<text x="{x+12}" y="{y+88}" font-size="13">Changed support</text>')
    for i, label in enumerate(("0 to <5", "5 to <10", "10 to <15", "15 to 100")):
        x = 55 + i * 175
        svg += [f'<rect x="{x}" y="370" width="24" height="22" fill="{COLORS[i]}" stroke="#172b4d"/>',
                f'<text x="{x+32}" y="387" font-size="15">{escape(label)}%</text>']
    svg += ['<text x="35" y="425" font-size="16">North: +10 percentage points. South: −2 percentage points.</text>',
            '<text x="35" y="455" font-size="15">West comparison held: changed support; 2023 has zero exposure.</text>',
            '<text x="35" y="485" font-size="15">Hatching means unavailable. A measured zero retains its rate class.</text>',
            '<text x="35" y="520" font-size="14">Region blocks are schematic; shape and distance carry no geographic measurement.</text>',
            '<text x="35" y="550" font-size="14">Source: authored synthetic fixture. Counts, exposure, and vintage: values.csv.</text>', '</g></svg>']
    out = io.StringIO(newline="")
    writer = csv.DictWriter(out, fieldnames=["region", "year", "events", "exposure", "support", "rate_per_100"], lineterminator="\n")
    writer.writeheader()
    writer.writerows(dict(row, rate_per_100="unavailable" if rate(row) is None else str(rate(row))) for row in rows)
    table = "".join("<tr>" + "".join(f"<td>{escape(str(value))}</td>" for value in
                    (row["region"], row["year"], row["events"], row["exposure"], row["support"],
                     "Unavailable" if rate(row) is None else rate(row))) + "</tr>" for row in rows)
    html = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Compare years on admitted spatial support</title><style>body{font:1rem/1.5 system-ui,sans-serif;color:#172b4d;margin:1.5rem;max-width:60rem}a{color:#005a8d}.scroll{overflow:auto}img{display:block;max-width:none}table{border-collapse:collapse}th,td{padding:.5rem;text-align:left;border-bottom:1px solid #aab7c4}caption{text-align:left;font-weight:600;margin:.5rem 0}</style>
<main><h1>Compare years on admitted support</h1><p>North changes from 10% to 20%; South from 2% to 0%. West's comparison remains held because spatial support changed; its earlier denominator is empty.</p>
<figure style="margin:0"><div class="scroll" tabindex="0" role="region" aria-label="Full-size year panels; scroll horizontally on narrow screens"><img src="example.svg" width="850" height="580" alt="Two schematic year panels share one rate scale. Hatching marks West's unavailable earlier rate; its later rate is 5% on changed support. Exact values follow."></div><figcaption><a href="example.svg">Open full-size SVG</a> · <a href="values.csv">Download exact values</a>. Region blocks are schematic; shape and distance carry no geographic measurement.</figcaption></figure>
<div class="scroll" tabindex="0" role="region" aria-label="Exact region values"><table><caption>Authored synthetic binary events per 100 exposures</caption><thead><tr><th scope="col">Region</th><th scope="col">Year</th><th scope="col">Events</th><th scope="col">Exposure</th><th scope="col">Support</th><th scope="col">Rate per 100</th></tr></thead><tbody>''' + table + '</tbody></table></div></main></html>\n'
    svg_text = "\n".join(svg) + "\n"
    root = ElementTree.fromstring(svg_text)
    marks = [element for element in root.iter() if "data-region" in element.attrib]
    assert [element.attrib["data-rate"] for element in marks] == ["10", "2", "unavailable", "20", "0", "5"]
    return {"example.svg": svg_text, "example.html": html, "values.csv": out.getvalue(),
            "comparisons.json": json.dumps(comparisons, indent=2) + "\n"}


if __name__ == "__main__":
    if not __debug__:
        raise RuntimeError("Run this executable exercise with Python assertions enabled")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--output", type=Path, default=HERE)
    args = parser.parse_args()
    for name, content in produce().items():
        path = args.output / name
        if args.check:
            assert path.read_text(encoding="utf-8") == content, f"Regenerate {name}"
        else:
            args.output.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
    print("PASS: rates, common classes, zero/unavailable, geography hold, exact companions")
