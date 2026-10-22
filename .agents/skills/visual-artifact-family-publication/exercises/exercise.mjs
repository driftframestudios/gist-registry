import "../node-runtime-admission.mjs";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const base = new URL("./", import.meta.url);
const family = JSON.parse(await readFile(new URL("family.json", base), "utf8"));
const svg = await readFile(new URL("pattern.svg", base), "utf8");
const expected = JSON.parse(await readFile(new URL("expected-receipt.json", base), "utf8"));

assert.ok(family.owner && family.license && family.rightsStanding);
assert.ok(family.intrinsic.width > 0 && family.intrinsic.height > 0);
assert.notEqual(family.alternativeText, family.caption);
assert.ok(family.semanticCompanion.length > family.alternativeText.length);
const ids = [...svg.matchAll(/\bid="([^"]+)"/gu)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, "SVG IDs are unique");
const references = [...svg.matchAll(/url\(#([^)]+)\)/gu)].map(match => match[1]);
for (const reference of references) assert.ok(ids.includes(reference), `resolved SVG reference:${reference}`);
assert.ok(svg.indexOf('id="connectors"') < svg.indexOf('id="cards"'), "connectors precede cards in painter order");
const widths = family.targets.map(target => target.width);
assert.deepEqual(widths, [...widths].sort((left, right) => left - right));
assert.ok(family.targets.every(target => target.mediaType === "image/webp"));

const receipt = {
  acceptedPointer: family.acceptedPointer,
  aspectRatio: Number((family.intrinsic.width / family.intrinsic.height).toFixed(6)),
  localReferenceCount: references.length,
  semanticRoutes: [family.alternativeText, family.caption, family.semanticCompanion].length,
  standing: "accepted",
  targetCount: family.targets.length,
  uniqueIdCount: ids.length,
};
assert.deepEqual(receipt, expected);
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
