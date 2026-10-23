import "../node-runtime-admission.mjs";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const base = new URL("./", import.meta.url);
const model = JSON.parse(await readFile(new URL("decisions.json", base), "utf8"));
const expected = JSON.parse(await readFile(new URL("expected-receipt.json", base), "utf8"));
const ids = new Set();
for (const decision of model.decisions) {
  assert.ok(decision.id && decision.oracle && decision.fault && decision.consequence);
  assert.equal(ids.has(decision.id), false, `duplicate decision:${decision.id}`);
  ids.add(decision.id);
}
for (const changed of model.changedDecisionIds) assert.ok(ids.has(changed), `unknown changed decision:${changed}`);
const receipt = {
  acceptedPointer: model.acceptedPointer,
  decisionCount: model.decisions.length,
  environmentFields: Object.keys(model.environment).length,
  evidenceClasses: [...new Set(model.decisions.map(item => item.oracle))].sort(),
  faultCount: new Set(model.decisions.map(item => item.fault)).size,
  standing: "accepted",
  tier: "changed-boundary",
};
assert.deepEqual(receipt, expected);
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
