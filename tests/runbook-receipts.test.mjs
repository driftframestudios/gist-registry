import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const receiptPath = path.join(
  repositoryRoot,
  ".agents/runbooks/receipts/gist-registry-receiving-repository-use.v0.1.json",
);
const exactExerciseKeys = [
  "changedDecision",
  "changedMeaning",
  "deliveryMode",
  "exerciseId",
  "fit",
  "gap",
  "independentColdEntry",
  "localAdapter",
  "nextReceiver",
  "receiver",
  "recoveryCoordinate",
  "registryCoordinate",
  "signal",
  "sourceHandback",
].sort();
const exactCoordinateKeys = [
  "canonicalPath",
  "semanticId",
  "sourceDigest",
  "sourceStanding",
  "version",
].sort();
const exactSignalKeys = ["command", "observation", "result"].sort();

function requireNonemptyString(value, owner) {
  assert.equal(typeof value, "string", `${owner} needs a string`);
  assert.ok(value.trim().length > 0, `${owner} needs content`);
}

test("receiving-runbook exercises preserve two distinct package mechanisms and one cold entry", async () => {
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));

  assert.equal(receipt.schemaVersion, "0.1.0");
  assert.deepEqual(Object.keys(receipt.runbook).sort(), ["id", "path", "version"]);
  assert.equal(receipt.runbook.id, "gist-registry-receiving-repository-use");
  assert.equal(receipt.runbook.version, "0.1.0");
  assert.equal(receipt.standing, "exercised_on_candidate_coordinates");
  assert.equal(receipt.exerciseCount, receipt.exercises.length);
  assert.equal(receipt.exercises.length, 2);
  await access(path.join(repositoryRoot, receipt.runbook.path));

  const coordinates = new Set();
  const adapters = new Set();
  for (const [index, exercise] of receipt.exercises.entries()) {
    assert.deepEqual(Object.keys(exercise).sort(), exactExerciseKeys, `exercise ${index} fields`);
    assert.deepEqual(
      Object.keys(exercise.registryCoordinate).sort(),
      exactCoordinateKeys,
      `exercise ${index} coordinate fields`,
    );
    assert.deepEqual(Object.keys(exercise.signal).sort(), exactSignalKeys, `exercise ${index} signal fields`);

    for (const field of [
      "exerciseId",
      "receiver",
      "deliveryMode",
      "localAdapter",
      "fit",
      "gap",
      "changedMeaning",
      "changedDecision",
      "recoveryCoordinate",
      "sourceHandback",
      "nextReceiver",
    ]) {
      requireNonemptyString(exercise[field], `exercise ${index}.${field}`);
    }
    for (const field of ["semanticId", "version", "canonicalPath", "sourceStanding"]) {
      requireNonemptyString(
        exercise.registryCoordinate[field],
        `exercise ${index}.registryCoordinate.${field}`,
      );
    }
    assert.match(exercise.registryCoordinate.sourceDigest, /^[a-f0-9]{64}$/u);
    assert.equal(typeof exercise.independentColdEntry, "boolean");
    assert.ok(["candidate", "friction", "accepted"].includes(exercise.signal.result));
    requireNonemptyString(exercise.signal.command, `exercise ${index}.signal.command`);
    requireNonemptyString(exercise.signal.observation, `exercise ${index}.signal.observation`);

    await access(path.join(repositoryRoot, exercise.registryCoordinate.canonicalPath));
    await access(path.join(repositoryRoot, exercise.localAdapter));
    coordinates.add(
      `${exercise.registryCoordinate.semanticId}@${exercise.registryCoordinate.version}`,
    );
    adapters.add(exercise.localAdapter);
  }

  assert.equal(coordinates.size, 2, "the exercises need distinct package coordinates");
  assert.equal(adapters.size, 2, "the exercises need distinct receiving mechanisms");
  assert.equal(
    receipt.exercises.filter(({ independentColdEntry }) => independentColdEntry).length,
    1,
    "one exercise needs an independently reconstructed cold-entry receipt",
  );
});
