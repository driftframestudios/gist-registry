import "../node-runtime-admission.mjs";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const base = new URL("./", import.meta.url);
const contract = JSON.parse(await readFile(new URL("receiver-contract.json", base), "utf8"));
const expected = JSON.parse(await readFile(new URL("expected-receipt.json", base), "utf8"));

const stateSets = Object.values(contract.receivers).map(states => [...states].sort());
for (const states of stateSets.slice(1)) assert.deepEqual(states, stateSets[0]);
for (const control of contract.controls) {
  assert.ok(control.id && control.label, "controls carry an associated ID and visible label");
  assert.equal(control.labelPosition, "above");
}

let accepted = structuredClone(contract.acceptedState);
const staleGenerations = [];
for (const request of [...contract.requests].sort((left, right) =>
  left.settles.localeCompare(right.settles))) {
  if (request.generation < Math.max(...contract.requests.map(item => item.generation))) {
    staleGenerations.push(request.generation);
    continue;
  }
  accepted = { generation: request.generation, id: request.id, status: request.status };
}
const receipt = {
  acceptedGeneration: accepted.generation,
  acceptedId: accepted.id,
  controlCount: contract.controls.length,
  receiverCount: Object.keys(contract.receivers).length,
  staleGenerations,
  stateCount: stateSets[0].length,
  standing: "accepted",
};
assert.deepEqual(receipt, expected);
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
