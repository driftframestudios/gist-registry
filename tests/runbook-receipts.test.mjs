import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  "digest",
  "semanticId",
  "sourceStanding",
  "version",
].sort();
const exactDigestKeys = ["algorithm", "closure", "subject", "value"].sort();
const exactDigestClosureKeys = ["label", "path", "selector"].sort();
const exactSignalKeys = ["command", "observation", "result"].sort();
const digestPattern = /^[a-f0-9]{64}$/u;

function requireNonemptyString(value, owner) {
  assert.equal(typeof value, "string", `${owner} needs a string`);
  assert.ok(value.trim().length > 0, `${owner} needs content`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function compareOrdinalText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareOrdinalText)
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

function resolveJsonPointer(document, pointer) {
  assert.match(pointer, /^\//u, "JSON Pointer selectors start at the document root");
  return pointer
    .slice(1)
    .split("/")
    .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((value, key) => {
      assert.ok(
        value && typeof value === "object" && Object.hasOwn(value, key),
        `JSON Pointer segment ${key} resolves in the closure document`,
      );
      return value[key];
    }, document);
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
    assert.deepEqual(
      Object.keys(exercise.signal).sort(),
      exactSignalKeys,
      `exercise ${index} signal fields`,
    );

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
    const { digest } = exercise.registryCoordinate;
    assert.deepEqual(
      Object.keys(digest).sort(),
      exactDigestKeys,
      `exercise ${index} digest fields`,
    );
    assert.equal(digest.algorithm, "sha256");
    requireNonemptyString(digest.subject, `exercise ${index}.registryCoordinate.digest.subject`);
    assert.match(digest.value, digestPattern);
    assert.ok(
      digest.closure.length > 0,
      `exercise ${index} digest closure has at least one input`,
    );
    const closureLabels = new Set();
    for (const [closureIndex, input] of digest.closure.entries()) {
      assert.deepEqual(
        Object.keys(input).sort(),
        exactDigestClosureKeys,
        `exercise ${index} digest closure ${closureIndex} fields`,
      );
      for (const field of exactDigestClosureKeys) {
        requireNonemptyString(
          input[field],
          `exercise ${index}.registryCoordinate.digest.closure.${closureIndex}.${field}`,
        );
      }
      assert.ok(
        !closureLabels.has(input.label),
        `exercise ${index} digest closure labels stay unique`,
      );
      closureLabels.add(input.label);
      await access(path.join(repositoryRoot, input.path));
    }
    assert.equal(typeof exercise.independentColdEntry, "boolean");
    assert.ok(["candidate", "friction", "accepted"].includes(exercise.signal.result));
    requireNonemptyString(exercise.signal.command, `exercise ${index}.signal.command`);
    requireNonemptyString(exercise.signal.observation, `exercise ${index}.signal.observation`);
    assert.doesNotMatch(
      exercise.signal.observation,
      /\b\d+\s+tests?\s+passed\b/iu,
      `exercise ${index} observation describes durable behavior rather than a test count`,
    );

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

  const exercisesByCoordinate = new Map(
    receipt.exercises.map((exercise) => [exercise.registryCoordinate.semanticId, exercise]),
  );
  const tokenExercise = exercisesByCoordinate.get("style-dictionary-dtcg-pipeline");
  assert.ok(tokenExercise, "the token pipeline exercise is present");
  const tokenCoordinateInput = {
    label: "manifestSha256",
    path: "snippets/react-aria-visual-contract-receiver/0.1.0/source/token-coordinate.json",
    selector: "/acceptedCoordinate/manifestSha256",
  };
  assert.deepEqual(tokenExercise.registryCoordinate.digest.closure, [tokenCoordinateInput]);
  const tokenCoordinateDocument = JSON.parse(
    await readFile(path.join(repositoryRoot, tokenCoordinateInput.path), "utf8"),
  );
  const acceptedTokenCoordinate = tokenCoordinateDocument.acceptedCoordinate;
  assert.equal(
    tokenExercise.registryCoordinate.semanticId,
    acceptedTokenCoordinate.semanticId,
  );
  assert.equal(tokenExercise.registryCoordinate.version, acceptedTokenCoordinate.version);
  assert.equal(
    tokenExercise.registryCoordinate.canonicalPath,
    acceptedTokenCoordinate.canonicalPath,
  );
  assert.equal(
    tokenExercise.registryCoordinate.sourceStanding,
    acceptedTokenCoordinate.manifestStanding,
  );
  assert.equal(
    tokenExercise.registryCoordinate.digest.subject,
    acceptedTokenCoordinate.manifestKind,
  );
  assert.equal(
    tokenExercise.registryCoordinate.digest.value,
    resolveJsonPointer(tokenCoordinateDocument, tokenCoordinateInput.selector),
  );

  const compilerExercise = exercisesByCoordinate.get("visual-pattern-artifact-compiler");
  assert.ok(compilerExercise, "the visual compiler exercise is present");
  const compilerSourceInputs = [
    {
      label: "contractSha256",
      path: "snippets/visual-pattern-artifact-compiler/0.1.0/source/pattern-contract.json",
      selector: "file-bytes",
    },
    {
      label: "galleryShellSha256",
      path: "snippets/visual-pattern-artifact-compiler/0.1.0/source/gallery-shell.html",
      selector: "file-bytes",
    },
    {
      label: "svgSha256",
      path: "snippets/visual-pattern-artifact-compiler/0.1.0/source/pattern.svg",
      selector: "file-bytes",
    },
  ];
  assert.deepEqual(compilerExercise.registryCoordinate.digest.closure, compilerSourceInputs);
  assert.equal(compilerExercise.registryCoordinate.digest.subject, "aggregate_authored_sources");
  const compilerSourceDigests = {};
  for (const input of compilerSourceInputs) {
    compilerSourceDigests[input.label] = sha256(
      await readFile(path.join(repositoryRoot, input.path)),
    );
  }
  assert.equal(
    compilerExercise.registryCoordinate.digest.value,
    sha256(Buffer.from(stableJson(compilerSourceDigests))),
  );
});
