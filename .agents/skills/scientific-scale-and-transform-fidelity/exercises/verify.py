"""Synthetic finite-domain transform exercise; Python 3.12+, stdlib only."""
from __future__ import annotations

import argparse
import csv
import io
import math
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

VALUES = (-1000.0, -100.0, -10.0, -1.0, 0.0, 1.0, 10.0, 100.0, 1000.0)


def finite(value: float) -> float:
    if not math.isfinite(value):
        raise ValueError("finite value required")
    return value


def positive(value: float) -> float:
    if finite(value) <= 0:
        raise ValueError("positive value required")
    return value


def log10(value: float) -> float:
    return math.log10(positive(value))


def symlog(value: float, threshold: float = 1.0) -> float:
    """Teaching map: unit central width, base 10; exact formula in reference."""
    finite(value)
    positive(threshold)
    if abs(value) <= threshold:
        return value / threshold
    return math.copysign(1 + math.log10(abs(value) / threshold), value)


def inverse_symlog(value: float, threshold: float = 1.0) -> float:
    finite(value)
    positive(threshold)
    if abs(value) <= 1:
        return threshold * value
    return math.copysign(threshold * 10 ** (abs(value) - 1), value)


def asinh_axis(value: float, width: float = 1.0) -> float:
    finite(value)
    positive(width)
    return width * math.asinh(value / width)


def inverse_asinh_axis(value: float, width: float = 1.0) -> float:
    finite(value)
    positive(width)
    return width * math.sinh(value / width)


def csv_source() -> str:
    out = io.StringIO(newline="")
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(("provenance", "raw_arbitrary_unit", "linear", "symlog_t1_b10_unit_width", "asinh_axis_width1", "log10", "log_domain"))
    for value in VALUES:
        writer.writerow(("synthetic", format(value, ".12g"), format(value, ".12g"),
                         format(symlog(value), ".12g"), format(asinh_axis(value), ".12g"),
                         format(log10(value), ".12g") if value > 0 else "",
                         "positive" if value > 0 else "requires-separate-policy"))
    return out.getvalue()


def svg() -> str:
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="180mm" height="120mm" viewBox="0 0 960 640" role="img" aria-labelledby="title desc">',
             '<title id="title">Synthetic signed values under three explicit scales</title>',
             '<desc id="desc">Nine identical raw values from minus 1000 to 1000 use linear, unit-width symlog, and asinh axis mappings. Tick labels stay in raw arbitrary units. Zero and signed values remain represented. Exact transformed coordinates accompany the figure.</desc>',
             '<rect width="960" height="640" fill="white"/>', '<g font-family="sans-serif" fill="#172b3a">',
             '<text x="40" y="42" font-size="29" font-weight="bold">One signed sample, three coordinate mappings</text>',
             '<text x="40" y="77" font-size="19">Synthetic values · raw-unit ticks · identical endpoints and observations</text>']
    panels = (("Linear", lambda x: x, (-1000, -500, 0, 500, 1000), "additive distances"),
              ("Symlog", symlog, (-1000, -10, 0, 10, 1000), "t = 1; base 10; unit central width"),
              ("Asinh", asinh_axis, (-1000, -10, 0, 10, 1000), "x → asinh(x); width = 1"))
    for index, (label, mapping, ticks, detail) in enumerate(panels):
        y = 150 + index * 150
        limit = mapping(1000)
        xcoord = lambda raw: 280 + 600 * (mapping(raw) + limit) / (2 * limit)
        parts.append(f'<text x="40" y="{y}" font-size="24" font-weight="bold">{label}</text>')
        parts.append(f'<text x="280" y="{y-30}" font-size="17">{detail}</text>')
        parts.append(f'<line x1="280" x2="880" y1="{y}" y2="{y}" stroke="#667887"/>')
        for tick in ticks:
            x = xcoord(tick)
            parts.append(f'<line x1="{x:.6f}" x2="{x:.6f}" y1="{y+9}" y2="{y+17}" stroke="#667887"/>')
            parts.append(f'<text x="{x:.6f}" y="{y+42}" text-anchor="middle" font-size="17">{tick:g}</text>')
        for raw in VALUES:
            parts.append(f'<circle cx="{xcoord(raw):.6f}" cy="{y}" r="5" fill="#236b86" fill-opacity="0.65" data-raw="{raw:g}" data-panel="{label}"/>')
    parts.extend(['<text x="40" y="574" font-size="19">Near-zero observations overlap at this linear scale; the CSV retains each value.</text>',
                  '<text x="40" y="607" font-size="17">Symlog here is the stated teaching function; parameters choose the central geometry.</text>', '</g></svg>'])
    return "\n".join(parts) + "\n"


class TransformSemantics(unittest.TestCase):
    def test_independent_anchors(self):
        self.assertEqual((log10(1), log10(10), log10(100)), (0, 1, 2))
        self.assertEqual([symlog(x) for x in (-100, -1, 0, 1, 100)], [-3, -1, 0, 1, 3])
        self.assertAlmostEqual(asinh_axis(1), math.log(1 + math.sqrt(2)))
        self.assertEqual(asinh_axis(0), 0)

    def test_roundtrip_monotonicity_and_signed_symmetry(self):
        for parameter in (0.1, 1, 10):
            for function, inverse in ((symlog, inverse_symlog), (asinh_axis, inverse_asinh_axis)):
                coordinates = [function(value, parameter) for value in VALUES]
                self.assertEqual(coordinates, sorted(coordinates))
                self.assertEqual(len(set(coordinates)), len(VALUES))
                for value, mapped in zip(VALUES, coordinates):
                    self.assertAlmostEqual(inverse(mapped, parameter), value, delta=1e-9)
                    self.assertAlmostEqual(function(-value, parameter), -mapped)

    def test_domain_and_parameters(self):
        for value in (-1, 0, math.inf, -math.inf, math.nan):
            with self.assertRaises(ValueError):
                log10(value)
        for function in (symlog, asinh_axis, inverse_symlog, inverse_asinh_axis):
            for parameter in (0, -1, math.inf, math.nan):
                with self.assertRaises(ValueError):
                    function(1, parameter)
            with self.assertRaises(ValueError):
                function(math.inf)

    def test_unit_and_offset_meaning(self):
        for value in VALUES:
            self.assertAlmostEqual(math.asinh(value / 2), math.asinh((1000 * value) / 2000))
            self.assertAlmostEqual(asinh_axis(1000 * value, 2000), 1000 * asinh_axis(value, 2))
        offset_one = math.log2((0 + 1) / (1 + 1))
        offset_tenth = math.log2((0 + 0.1) / (1 + 0.1))
        self.assertEqual(offset_one, -1)
        self.assertLess(offset_tenth, -3)

    def test_interval_endpoints(self):
        low, estimate, high = map(log10, (2, 5, 8))
        self.assertAlmostEqual(low, 0.3010299956639812)
        self.assertAlmostEqual(high, 0.9030899869919435)
        self.assertGreater(estimate - low, high - estimate)
        self.assertEqual((10 ** low, round(10 ** high)), (2, 8))

    def test_density_unit(self):
        raw_widths = (9, 90)
        density_raw = tuple(0.5 / width for width in raw_widths)
        self.assertAlmostEqual(sum(height * width for height, width in zip(density_raw, raw_widths)), 1)
        self.assertAlmostEqual(density_raw[0] / density_raw[1], 10)
        log_widths = (log10(10) - log10(1), log10(100) - log10(10))
        self.assertEqual(tuple(0.5 / width for width in log_widths), (0.5, 0.5))

    def test_csv_preserves_domain_status_and_coordinates(self):
        records = list(csv.DictReader(io.StringIO(csv_source())))
        self.assertEqual(len(records), 9)
        self.assertEqual([float(r["raw_arbitrary_unit"]) for r in records], list(VALUES))
        self.assertEqual([r["log10"] for r in records], ["", "", "", "", "", "0", "1", "2", "3"])
        self.assertEqual(records[6]["symlog_t1_b10_unit_width"], "2")

    def test_svg_raw_identity_and_expected_geometry(self):
        root = ET.fromstring(svg())
        circles = root.findall('.//{http://www.w3.org/2000/svg}circle')
        self.assertEqual(len(circles), 27)
        by_key = {(c.attrib["data-panel"], c.attrib["data-raw"]): c.attrib for c in circles}
        self.assertEqual(float(by_key[("Linear", "0")]["cx"]), 580)
        self.assertEqual(float(by_key[("Symlog", "10")]["cx"]), 730)
        for panel in ("Linear", "Symlog", "Asinh"):
            self.assertEqual(float(by_key[(panel, "-1000")]["cx"]), 280)
            self.assertEqual(float(by_key[(panel, "1000")]["cx"]), 880)
        self.assertIn("raw-unit ticks", " ".join(root.itertext()))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    result = unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromTestCase(TransformSemantics))
    if not result.wasSuccessful():
        raise SystemExit(1)
    if args.output_dir is not None:
        args.output_dir.mkdir(parents=True, exist_ok=False)
        for name, content in (("transforms.csv", csv_source()), ("scales.svg", svg())):
            (args.output_dir / name).write_text(content, encoding="utf-8")
    print("synthetic transforms: 8 cases; 9 values; 3 SVG mappings; numerical tolerance 1e-9 on named finite range")


if __name__ == "__main__":
    main()
