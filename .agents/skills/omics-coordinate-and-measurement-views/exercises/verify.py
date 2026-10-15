"""Synthetic coordinate/assay exercise; Python 3.12+, standard library only."""
from __future__ import annotations

import argparse
import csv
import io
import math
from pathlib import Path
import statistics
import unittest
import xml.etree.ElementTree as ET
from html import escape

SAMPLES = ("cell-a1", "cell-a2", "cell-a3", "cell-a4", "cell-b1", "cell-b2")
METADATA = tuple(
    {"id": sample, "donor": "A" if index < 4 else "B", "batch": "run-1" if index < 4 else "run-2"}
    for index, sample in enumerate(SAMPLES)
)
ROWS = (("feature-low", (1, 2, 3, 4, 5, 6)),
        ("feature-high", (10, 20, 30, 40, 50, 60)),
        ("feature-flat", (7, 7, 7, 7, 7, 7)))
STATES = (("observed", 0), ("below-limit", None), ("missing", None),
          ("imputed", 1.5), ("observed", -2))
ASSEMBLY = "synthetic-linear-reference-v1"


def closed_interval(start: int, end: int, *, assembly: str, kind: str = "ordinary") -> tuple[int, int]:
    """Admit the ordinary nonempty BED subset on the fixed synthetic reference."""
    if assembly != ASSEMBLY or kind != "ordinary":
        raise ValueError("reference or feature needs its own coordinate adapter")
    if type(start) is not int or type(end) is not int or not 0 <= start < end:
        raise ValueError("ordinary nonempty interval requires 0 <= start < end")
    return start + 1, end


def align_metadata(ids: tuple[str, ...], records: tuple[dict, ...]) -> list[dict]:
    if len(set(ids)) != len(ids):
        raise ValueError("unique matrix identities required")
    index = {}
    for row in records:
        if row["id"] in index:
            raise ValueError("unique metadata identities required")
        index[row["id"]] = row
    if set(index) != set(ids):
        raise ValueError("exact sample identity membership required")
    return [dict(index[key]) for key in ids]


def row_z(values: tuple[int, ...]) -> tuple[float | None, ...]:
    center = statistics.fmean(values)
    spread = statistics.pstdev(values)
    if spread == 0:
        return (None,) * len(values)
    return tuple((value - center) / spread for value in values)


def matrix_csv() -> str:
    out = io.StringIO(newline="")
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(("provenance", "feature_id", "cell_id", "donor", "batch", "raw_arbitrary_unit", "row_z", "scale_status"))
    metadata = align_metadata(SAMPLES, tuple(reversed(METADATA)))
    for feature, values in ROWS:
        for sample, meta, raw, z in zip(SAMPLES, metadata, values, row_z(values)):
            writer.writerow(("synthetic", feature, sample, meta["donor"], meta["batch"], raw,
                             "" if z is None else format(z, ".12g"),
                             "undefined-constant-row" if z is None else "defined"))
    return out.getvalue()


def state_csv() -> str:
    out = io.StringIO(newline="")
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(("provenance", "status", "value_arbitrary_unit"))
    writer.writerows(("synthetic", status, "" if value is None else value) for status, value in STATES)
    return out.getvalue()


def color(z: float | None) -> str:
    if z is None:
        return "#d3d8dd"
    weight = min(abs(z) / 1.5, 1)
    target = (35, 87, 137) if z < 0 else (171, 75, 34)
    return "#" + "".join(f"{round(247 + weight * (channel - 247)):02x}" for channel in target)


def svg() -> str:
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="180mm" height="112.5mm" viewBox="0 0 960 600" role="img" aria-labelledby="title desc">',
             '<title id="title">Synthetic profiles: equal row z-scores, different amounts</title>',
             '<desc id="desc">Two proportional features share row z-scores despite tenfold raw values. A constant row has undefined z-scores. Six cells come from two donors. Exact values accompany this figure.</desc>',
             '<rect width="960" height="600" fill="#ffffff"/>',
             '<g font-family="sans-serif" fill="#172b3a">',
             '<text x="40" y="44" font-size="27" font-weight="bold">Equal row patterns can carry different amounts</text>',
             '<text x="40" y="79" font-size="19">Synthetic assay · population-SD row z-score · 6 cells / 2 donors</text>']
    metadata = align_metadata(SAMPLES, tuple(reversed(METADATA)))
    for column, meta in enumerate(metadata):
        x = 260 + column * 105
        parts.append(f'<text x="{x+47}" y="122" text-anchor="middle" font-size="17">{escape(meta["id"])}</text>')
        parts.append(f'<text x="{x+47}" y="148" text-anchor="middle" font-size="15">donor {meta["donor"]}</text>')
        parts.append(f'<text x="{x+47}" y="170" text-anchor="middle" font-size="15">{meta["batch"]}</text>')
    for row, (feature, values) in enumerate(ROWS):
        y = 190 + row * 78
        parts.append(f'<text x="240" y="{y+43}" text-anchor="end" font-size="21">{feature}</text>')
        for column, z in enumerate(row_z(values)):
            x = 260 + column * 105
            text = "undefined" if z is None else f"{z:.2f}"
            ink = "#ffffff" if z is not None and abs(z) > 1 else "#172b3a"
            parts.append(f'<rect x="{x}" y="{y}" width="94" height="65" fill="{color(z)}"/>')
            parts.append(f'<text x="{x+47}" y="{y+39}" text-anchor="middle" font-size="16" fill="{ink}">{text}</text>')
    for i, z in enumerate((-1.5, 0.0, 1.5, None)):
        x = 260 + i * 155
        parts.append(f'<rect x="{x}" y="438" width="28" height="20" fill="{color(z)}"/>')
        label = "undefined" if z is None else f"z = {z:g}"
        parts.append(f'<text x="{x+38}" y="454" font-size="17">{label}</text>')
    parts.extend(['<text x="40" y="508" font-size="19">feature-high raw values are 10× feature-low; row z-scores agree.</text>',
                  '<text x="40" y="541" font-size="18">Color measures deviation within each feature. Gray marks undefined scale.</text>',
                  '<text x="40" y="572" font-size="16">Authored example · exact raw values and statuses: matrix.csv / states.csv</text>', '</g></svg>'])
    return "\n".join(parts) + "\n"


class Semantics(unittest.TestCase):
    def test_coordinate_endpoints_and_adjacency(self):
        self.assertEqual(closed_interval(0, 1, assembly=ASSEMBLY), (1, 1))
        self.assertEqual(closed_interval(1, 2, assembly=ASSEMBLY), (2, 2))
        for start, end in ((0, 1), (1, 2), (10, 14)):
            low, high = closed_interval(start, end, assembly=ASSEMBLY)
            self.assertEqual((low - 1, high), (start, end))
            self.assertEqual(high - low + 1, end - start)

    def test_coordinate_subset_and_reference(self):
        for start, end, assembly, kind in ((0, 0, ASSEMBLY, "insertion"), (1, 0, ASSEMBLY, "ordinary"),
                                           (0, 1, "another-reference", "ordinary")):
            with self.assertRaises(ValueError):
                closed_interval(start, end, assembly=assembly, kind=kind)
        feature = {"strand": "-", "span": closed_interval(10, 14, assembly=ASSEMBLY)}
        self.assertEqual(feature, {"strand": "-", "span": (11, 14)})

    def test_metadata_reordering_and_detachment(self):
        result = align_metadata(SAMPLES, tuple(reversed(METADATA)))
        self.assertEqual([r["id"] for r in result], list(SAMPLES))
        self.assertEqual([r["donor"] for r in result], ["A", "A", "A", "A", "B", "B"])
        result[0]["donor"] = "changed"
        self.assertEqual(METADATA[0]["donor"], "A")

    def test_metadata_identity_faults(self):
        for records in (METADATA[:-1], METADATA + (METADATA[0],)):
            with self.assertRaises(ValueError):
                align_metadata(SAMPLES, records)
        with self.assertRaises(ValueError):
            align_metadata(("duplicate", "duplicate"), ())

    def test_weighting_and_confounded_design(self):
        cell_values = (2, 2, 2, 2, 10, 10)
        self.assertAlmostEqual(statistics.fmean(cell_values), 14 / 3)
        donor_means = [statistics.fmean([v for v, m in zip(cell_values, METADATA) if m["donor"] == d]) for d in ("A", "B")]
        self.assertEqual(statistics.fmean(donor_means), 6)
        batch = tuple(int(m["batch"] == "run-2") for m in METADATA)
        condition = (0, 0, 0, 0, 1, 1)
        self.assertEqual(batch, condition)  # Identical model columns leave effects inseparable.
        self.assertEqual(len(set(m["donor"] for m in METADATA)), 2)

    def test_row_scale_meaning(self):
        low, high = row_z(ROWS[0][1]), row_z(ROWS[1][1])
        for left, right in zip(low, high):
            self.assertAlmostEqual(left, right)
        self.assertAlmostEqual(low[0], -math.sqrt(15 / 7))
        self.assertEqual(row_z(ROWS[2][1]), (None,) * 6)

    def test_exact_companions_and_states(self):
        records = list(csv.DictReader(io.StringIO(matrix_csv())))
        self.assertEqual(len(records), 18)
        self.assertEqual((records[0]["cell_id"], records[0]["raw_arbitrary_unit"]), ("cell-a1", "1"))
        self.assertEqual(records[6]["raw_arbitrary_unit"], "10")
        self.assertTrue(all(r["scale_status"] == "undefined-constant-row" for r in records[12:]))
        statuses = list(csv.DictReader(io.StringIO(state_csv())))
        self.assertEqual([r["value_arbitrary_unit"] for r in statuses], ["0", "", "", "1.5", "-2"])
        self.assertEqual([r["status"] for r in statuses], ["observed", "below-limit", "missing", "imputed", "observed"])

    def test_svg_metadata_and_determinism(self):
        figure = ET.fromstring(svg())
        self.assertEqual(figure.attrib["width"], "180mm")
        text = " ".join(figure.itertext())
        for token in ("Synthetic", "2 donors", "undefined", "10×", "matrix.csv"):
            self.assertIn(token, text)
        self.assertEqual(svg(), svg())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    result = unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromTestCase(Semantics))
    if not result.wasSuccessful():
        raise SystemExit(1)
    if args.output_dir is not None:
        args.output_dir.mkdir(parents=True, exist_ok=False)
        for name, content in (("matrix.csv", matrix_csv()), ("states.csv", state_csv()), ("omics.svg", svg())):
            (args.output_dir / name).write_text(content, encoding="utf-8")
    print("synthetic semantics: 8 cases; 18 matrix cells; 5 measurement states; rendered legibility requires observation")


if __name__ == "__main__":
    main()
