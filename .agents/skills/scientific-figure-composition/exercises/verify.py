"""Synthetic print/slide composition exercise; Python 3.12+, stdlib only."""
from __future__ import annotations

import argparse
import csv
from html import escape
import io
import json
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

RECORDS = (("A", "Assay A", -1, -2, 0, 3), ("B", "Assay B", 0, -1, 1, 4),
           ("C", "Assay C", 2, 1, 3, 2), ("D", "Assay D", 4, 2, 6, 5))
NAMESPACE = {"s": "http://www.w3.org/2000/svg"}


def source_csv() -> str:
    out = io.StringIO(newline="")
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(("provenance", "id", "label", "estimate_arbitrary_unit", "authored_lower", "authored_upper", "fictional_specimens"))
    writer.writerows(("synthetic", *record) for record in RECORDS)
    return out.getvalue()


def source_records() -> list[dict]:
    return [{"id": key, "label": label, "estimate": estimate, "lower": low, "upper": high,
             "specimens": specimens, "provenance": "synthetic"}
            for key, label, estimate, low, high, specimens in RECORDS]


def figure(medium: str) -> str:
    if medium not in {"print", "slide"}:
        raise ValueError("choose the declared print or slide receiver")
    slide = medium == "slide"
    width = 1280 if slide else 1000
    height = 720
    physical = 'width="1280" height="720"' if slide else 'width="180mm" height="129.6mm"'
    font = 25 if slide else 21
    plot_left, plot_right = (350, 1000) if slide else (280, 770)
    support_x = 1160 if slide else 900
    xcoord = lambda value: plot_left + (value + 3) * (plot_right - plot_left) / 10
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" {physical} viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">',
             '<title id="title">Synthetic estimates with their authored ranges and support</title>',
             '<desc id="desc">Four fictional assays compare estimates and authored ranges in an arbitrary unit. A separate support column gives fictional specimen counts. Assay D has the largest estimate and widest range. These are authored examples, not inferential intervals.</desc>',
             '<metadata id="source-records">' + escape(json.dumps(source_records(), sort_keys=True, separators=(",", ":"))) + '</metadata>',
             f'<rect width="{width}" height="720" fill="white"/>',
             '<g font-family="sans-serif" fill="#172b3a">',
             f'<text x="45" y="55" font-size="{36 if slide else 31}" font-weight="bold">Compare the estimate together with its range</text>',
             f'<text x="45" y="96" font-size="{font}">Synthetic assay comparison · the same source values in two delivery formats</text>',
             f'<text x="{plot_left}" y="158" font-size="{font}" font-weight="bold">A  Estimate and authored range</text>',
             f'<text x="{support_x}" y="145" text-anchor="middle" font-size="{font}" font-weight="bold">B  Support</text>',
             f'<text x="{support_x}" y="174" text-anchor="middle" font-size="{font-2}">Specimens</text>']
    for tick in (-2, 0, 2, 4, 6):
        x = xcoord(tick)
        parts.append(f'<line x1="{x}" x2="{x}" y1="195" y2="500" stroke="{"#8996a0" if tick == 0 else "#e1e6ea"}" stroke-width="{2 if tick == 0 else 1}"/>')
        parts.append(f'<text x="{x}" y="537" text-anchor="middle" font-size="{font}">{tick}</text>')
    for index, (key, label, estimate, low, high, count) in enumerate(RECORDS):
        y = 225 + index * 80
        accent = "#236b86" if key == "D" else "#506576"
        parts.append(f'<g data-id="{key}" data-estimate="{estimate}" data-lower="{low}" data-upper="{high}" data-specimens="{count}">')
        parts.append(f'<text x="{plot_left-35}" y="{y+8}" text-anchor="end" font-size="{font+1}">{label}</text>')
        parts.append(f'<line class="interval" x1="{xcoord(low)}" x2="{xcoord(high)}" y1="{y}" y2="{y}" stroke="{accent}" stroke-width="4"/>')
        for bound in (low, high):
            parts.append(f'<line x1="{xcoord(bound)}" x2="{xcoord(bound)}" y1="{y-9}" y2="{y+9}" stroke="{accent}" stroke-width="2"/>')
        parts.append(f'<circle class="estimate" cx="{xcoord(estimate)}" cy="{y}" r="7" fill="{accent}"/>')
        parts.append(f'<text x="{support_x}" y="{y+8}" text-anchor="middle" font-size="{font+2}">{count}</text></g>')
    parts.extend([f'<text x="{(plot_left+plot_right)/2}" y="574" text-anchor="middle" font-size="{font}">Estimate (arbitrary unit); zero is the supplied reference</text>',
                  f'<text x="45" y="620" font-size="{font}" font-weight="bold">Assay D has the largest authored estimate and widest range.</text>',
                  f'<text x="45" y="660" font-size="{font-2}">Ranges are authored examples; a confidence interpretation requires an analysis.</text>',
                  f'<text x="45" y="692" font-size="{font-3}">All records are fictional. Exact values, support and provenance: source.csv.</text>', '</g></svg>'])
    return "\n".join(parts) + "\n"


def observed_records(text: str) -> list[dict]:
    root = ET.fromstring(text)
    return [{"id": node.attrib["data-id"], "estimate": int(node.attrib["data-estimate"]),
             "lower": int(node.attrib["data-lower"]), "upper": int(node.attrib["data-upper"]),
             "specimens": int(node.attrib["data-specimens"])}
            for node in root.findall('.//s:g[@data-id]', NAMESPACE)]


def verify_values(text: str) -> None:
    expected = [{"id": key, "estimate": value, "lower": low, "upper": high, "specimens": n}
                for key, _, value, low, high, n in RECORDS]
    if observed_records(text) != expected:
        raise ValueError("rendered record identity or values diverged")
    root = ET.fromstring(text)
    metadata = root.find('s:metadata[@id="source-records"]', NAMESPACE)
    if metadata is None or json.loads(metadata.text) != source_records():
        raise ValueError("embedded source companion diverged")


class CompositionSemantics(unittest.TestCase):
    def test_source_fixture_and_csv(self):
        rows = list(csv.DictReader(io.StringIO(source_csv())))
        self.assertEqual(len(rows), 4)
        self.assertEqual([r["estimate_arbitrary_unit"] for r in rows], ["-1", "0", "2", "4"])
        self.assertEqual([r["fictional_specimens"] for r in rows], ["3", "4", "2", "5"])
        self.assertTrue(all(r["provenance"] == "synthetic" for r in rows))

    def test_same_values_across_receivers(self):
        self.assertEqual(observed_records(figure("print")), observed_records(figure("slide")))
        for medium in ("print", "slide"):
            verify_values(figure(medium))

    def test_semantic_fault_is_detected(self):
        for medium in ("print", "slide"):
            damaged = figure(medium).replace('data-estimate="4"', 'data-estimate="40"', 1)
            with self.assertRaises(ValueError):
                verify_values(damaged)

    def test_geometry_uses_raw_values(self):
        for medium, left, right in (("print", 280, 770), ("slide", 350, 1000)):
            root = ET.fromstring(figure(medium))
            nodes = root.findall('.//s:g[@data-id]', NAMESPACE)
            zero = nodes[1].find('s:circle', NAMESPACE)
            self.assertAlmostEqual(float(zero.attrib["cx"]), left + 0.3 * (right-left))
            interval = nodes[3].find('s:line[@class="interval"]', NAMESPACE)
            self.assertAlmostEqual(float(interval.attrib["x2"]) - float(interval.attrib["x1"]), 0.4*(right-left))

    def test_actual_dimensions_and_access_structure(self):
        print_root = ET.fromstring(figure("print"))
        self.assertEqual((print_root.attrib["width"], print_root.attrib["height"]), ("180mm", "129.6mm"))
        slide_root = ET.fromstring(figure("slide"))
        self.assertEqual(slide_root.attrib["viewBox"], "0 0 1280 720")
        for root in (print_root, slide_root):
            self.assertIsNotNone(root.find('s:title[@id="title"]', NAMESPACE))
            self.assertIsNotNone(root.find('s:desc[@id="desc"]', NAMESPACE))
            self.assertIn("arbitrary unit", " ".join(root.itertext()))
            self.assertIn("authored examples", " ".join(root.itertext()))

    def test_supported_reading_and_bounded_receiver(self):
        self.assertEqual(max(RECORDS, key=lambda r: r[2])[0], "D")
        self.assertEqual(max(RECORDS, key=lambda r: r[4] - r[3])[0], "D")
        with self.assertRaises(ValueError):
            figure("unknown-medium")
        self.assertEqual(figure("print"), figure("print"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    result = unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromTestCase(CompositionSemantics))
    if not result.wasSuccessful():
        raise SystemExit(1)
    if args.output_dir is not None:
        args.output_dir.mkdir(parents=True, exist_ok=False)
        for name, content in (("source.csv", source_csv()), ("print.svg", figure("print")), ("slide.svg", figure("slide"))):
            (args.output_dir / name).write_text(content, encoding="utf-8")
    print("synthetic composition: 6 cases; 4 records; print/slide semantic parity; pixels and receiving accessibility require observation")


if __name__ == "__main__":
    main()
