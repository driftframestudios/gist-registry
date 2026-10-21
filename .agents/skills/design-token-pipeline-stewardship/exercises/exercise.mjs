import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("./", import.meta.url);
const model = JSON.parse(await readFile(new URL("pipeline.json", root), "utf8"));
const expected = JSON.parse(await readFile(new URL("expected-receipt.json", root), "utf8"));
const referencePattern = /^\{([^}]+)\}$/u;

function admit(tokens) {
  const visiting = new Set();
  const accepted = new Set();
  let references = 0;
  const visit = path => {
    if (accepted.has(path)) return;
    assert.equal(visiting.has(path), false, `ALIAS_CYCLE:${path}`);
    const token = tokens[path];
    assert.ok(token, `UNRESOLVED_REFERENCE:${path}`);
    visiting.add(path);
    const match = typeof token.value === "string" ? token.value.match(referencePattern) : null;
    if (match) {
      references += 1;
      const target = tokens[match[1]];
      assert.ok(target, `UNRESOLVED_REFERENCE:${path}->${match[1]}`);
      assert.equal(target.type, token.type, `REFERENCE_TYPE_MISMATCH:${path}`);
      visit(match[1]);
    }
    visiting.delete(path);
    accepted.add(path);
  };
  Object.keys(tokens).sort().forEach(visit);
  return references;
}

const tokenNames = Object.keys(model.tokens).sort();
const referenceCount = admit(model.tokens);
for (const [target, inventory] of Object.entries(model.artifacts)) {
  assert.deepEqual([...inventory].sort(), tokenNames, `${target} token inventory`);
}
const receipt = {
  acceptedCoordinate: model.acceptedCoordinate,
  artifactCount: Object.keys(model.artifacts).length,
  buildCoordinates:
    model.matrix.brands.length * model.matrix.modes.length * model.matrix.platforms.length,
  referenceCount,
  receiverCount: model.authority.receivers.length,
  standing: "accepted",
  tokenCount: tokenNames.length,
};
assert.deepEqual(receipt, expected);
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
