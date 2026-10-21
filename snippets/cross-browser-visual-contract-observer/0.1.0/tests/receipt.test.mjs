import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { OBSERVER_RESOURCE_LIMITS, ObserverError, readJson, validateReceipt } from "../src/contracts.mjs";
import { validateReceiptSchema } from "../src/receipt-schema.mjs";
import { packageRoot } from "../tools/paths.mjs";
import { makeReceipt } from "./helpers.mjs";

const coordinates = await readJson(resolve(packageRoot, "source/coordinates.json"));

test("direct observer dependencies and lock root use exact coordinates", async () => {
  const packageJson = await readJson(resolve(packageRoot, "package.json"));
  const packageLock = await readJson(resolve(packageRoot, "package-lock.json"));
  const expected = {
    "@playwright/test": "1.64.1",
    ajv: "8.20.0",
    "ajv-formats": "3.0.1",
  };
  assert.deepEqual(packageJson.devDependencies, expected);
  assert.deepEqual(packageLock.packages[""].devDependencies, expected);
  for (const version of Object.values(expected)) assert.match(version, /^\d+\.\d+\.\d+$/u);
});

test("receipt schema identity names its published snippet representation", async () => {
  const schema = await readJson(resolve(packageRoot, "schema/receipt.schema.json"));
  assert.equal(
    schema.$id,
    "https://kindlight.io/snippets/cross-browser-visual-contract-observer/0.1.0/schema/receipt.schema.json",
  );
});

test("source coordinates bind the current candidate manifests", () => {
  assert.deepEqual(coordinates, {
    schemaVersion: "0.1.0",
    tokenSource: {
      semanticId: "style-dictionary-dtcg-pipeline",
      version: "0.1.0",
      coordinate: { brand: "acme", mode: "light" },
      manifestKind: "generated_output_manifest",
      manifestSha256: "6d93df6cd3c1b80076e3d4b0e162899381cfb4d82b1c28ff9c8a2a64d30a6e68",
      standing: "candidate",
    },
    receiver: {
      semanticId: "react-aria-visual-contract-receiver",
      version: "0.1.0",
      manifestKind: "production_build_manifest",
      manifestSha256: "0ab2fc6e413287a139519e898886037b66a8bb2f545c4745a67585167b9d192f",
      standing: "candidate",
    },
    observationFixture: {
      kind: "synthetic_receiver_fixture",
      path: "source/receiver.html",
      sha256: "d48c633d3b91cc48d3c56f8ae79935b275fc31fc1c0862d81297d50c3334c982",
    },
    bindingRule: "The token source binds the Issue #61 generated-output manifest and its acme/light coordinate. The receiver binds the Issue #62 deterministic production-build manifest, which the browser lane rebuilds, rehashes, and directly smokes. Fault-oracle receipts separately carry the exact synthetic receiver fixture bytes they actually loaded. Refresh dependency standing and digests from accepted manifests before adapting this harness to a receiver release.",
  });
});

test("receiver dependency and observed fixture digests resolve to their named owners", async () => {
  const receiverBuild = await readJson(resolve(packageRoot, "../../react-aria-visual-contract-receiver/0.1.0/expected/build-budget-contract.json"));
  const fixture = await readFile(resolve(packageRoot, coordinates.observationFixture.path));

  assert.equal(coordinates.receiver.manifestKind, "production_build_manifest");
  assert.equal(coordinates.receiver.manifestSha256, receiverBuild.deterministicManifestSha256);
  assert.equal(coordinates.observationFixture.sha256, createHash("sha256").update(fixture).digest("hex"));
});

test("typed receipt admits a complete exact coordinate", () => {
  assert.equal(validateReceipt(makeReceipt()).receiptId, "semantic-chromium-baseline");
  assert.equal(validateReceiptSchema(makeReceipt()).receiptId, "semantic-chromium-baseline");
});

test("versioned JSON Schema returns a bounded field error", () => {
  const candidate = makeReceipt();
  candidate.unowned = true;
  assert.throws(
    () => validateReceiptSchema(candidate),
    error => error instanceof ObserverError && error.code === "RECEIPT_SCHEMA_REJECTED" && error.details.errors.some(item => item.keyword === "additionalProperties"),
  );
});

test("receipt requires the exact Playwright coordinate", () => {
  const candidate = makeReceipt();
  candidate.environment.playwrightVersion = "rolling";
  assert.throws(() => validateReceipt(candidate), error => error instanceof ObserverError && error.code === "ENVIRONMENT_COORDINATE_MISMATCH");
});

test("receipt contains every artifact path", () => {
  for (const path of ["../outside.png", "artifacts/../outside.png", "artifacts/./alias.png", "artifacts//alias.png", "artifacts/"]) {
    const candidate = makeReceipt();
    candidate.artifacts.push({ path, sha256: "c".repeat(64), bytes: 10 });
    assert.throws(() => validateReceipt(candidate), error => error instanceof ObserverError && error.code === "ARTIFACT_BOUNDARY_INVALID");
    assert.throws(() => validateReceiptSchema(candidate), error => error instanceof ObserverError && error.code === "RECEIPT_SCHEMA_REJECTED");
  }
});

test("receipt distinguishes dependency manifest kinds from observed subject bytes", () => {
  const candidate = makeReceipt();
  candidate.receiver.manifestKind = "generated_output_manifest";
  assert.throws(() => validateReceipt(candidate), error => error instanceof ObserverError && error.code === "MANIFEST_KIND_MISMATCH");

  const missingSubject = makeReceipt();
  missingSubject.artifacts = [];
  assert.throws(() => validateReceipt(missingSubject), error => error instanceof ObserverError && error.code === "SUBJECT_ARTIFACT_MISMATCH");
});

test("receipt rejects duplicate artifact destinations", () => {
  const candidate = makeReceipt();
  candidate.artifacts.push({ ...candidate.artifacts[0] });
  assert.throws(() => validateReceipt(candidate), error => error instanceof ObserverError && error.code === "ARTIFACT_PATH_DUPLICATE");
});

test("receipt rejects malformed artifacts and inconsistent byte totals with typed errors", () => {
  const candidate = makeReceipt();
  candidate.artifacts = [null];
  assert.throws(
    () => validateReceipt(candidate),
    error => error instanceof ObserverError && error.code === "ARTIFACT_BOUNDARY_INVALID",
  );

  const inconsistentTotal = makeReceipt();
  inconsistentTotal.measurements.emittedBytes += 1;
  assert.throws(
    () => validateReceipt(inconsistentTotal),
    error => error instanceof ObserverError && error.code === "MEASUREMENT_INVALID",
  );
});

test("receipt caps artifact count before candidate allocation", () => {
  const candidate = makeReceipt();
  candidate.artifacts = Array.from({ length: OBSERVER_RESOURCE_LIMITS.artifacts + 1 }, (_, index) => ({
    path: `artifacts/item-${index}.txt`,
    sha256: "c".repeat(64),
    bytes: 1,
  }));
  assert.throws(
    () => validateReceipt(candidate),
    error => error instanceof ObserverError && error.code === "RESOURCE_LIMIT_EXCEEDED" && error.details.boundary === "receipt.artifacts",
  );
  assert.throws(
    () => validateReceiptSchema(candidate),
    error => error instanceof ObserverError && error.code === "RECEIPT_SCHEMA_REJECTED" && error.details.errors.some(item => item.keyword === "maxItems"),
  );
});

test("receipt caps per-artifact and aggregate declared bytes", () => {
  const oversizedArtifact = makeReceipt();
  oversizedArtifact.artifacts.push({
    path: "artifacts/oversized.png",
    sha256: "c".repeat(64),
    bytes: OBSERVER_RESOURCE_LIMITS.artifactBytes + 1,
  });
  assert.throws(
    () => validateReceipt(oversizedArtifact),
    error => error instanceof ObserverError && error.code === "ARTIFACT_BOUNDARY_INVALID",
  );
  assert.throws(
    () => validateReceiptSchema(oversizedArtifact),
    error => error instanceof ObserverError && error.code === "RECEIPT_SCHEMA_REJECTED" && error.details.errors.some(item => item.keyword === "maximum"),
  );

  const aggregate = makeReceipt();
  for (let index = 0; index < 4; index += 1) {
    aggregate.artifacts.push({
      path: `artifacts/chunk-${index}.bin`,
      sha256: String(index + 1).repeat(64),
      bytes: OBSERVER_RESOURCE_LIMITS.artifactBytes,
    });
  }
  assert.throws(
    () => validateReceipt(aggregate),
    error => error instanceof ObserverError && error.code === "RESOURCE_LIMIT_EXCEEDED" && error.details.boundary === "receipt.artifacts.bytes",
  );
});

test("receipt caps UTF-8 identity, prose, and normalized observation payloads", () => {
  const wideIdentifier = makeReceipt();
  wideIdentifier.receiptId = "é".repeat(Math.floor(OBSERVER_RESOURCE_LIMITS.identifierBytes / 2) + 1);
  assert.throws(
    () => validateReceipt(wideIdentifier),
    error => error instanceof ObserverError && error.code === "RESOURCE_LIMIT_EXCEEDED" && error.details.boundary === "receipt.receiptId",
  );

  const wideCaseId = makeReceipt();
  wideCaseId.caseId = `case-${"x".repeat(OBSERVER_RESOURCE_LIMITS.caseIdBytes)}`;
  assert.throws(
    () => validateReceipt(wideCaseId),
    error => error instanceof ObserverError && error.code === "RESOURCE_LIMIT_EXCEEDED" && error.details.boundary === "receipt.caseId",
  );
  assert.throws(
    () => validateReceiptSchema(wideCaseId),
    error => error instanceof ObserverError && error.code === "RECEIPT_SCHEMA_REJECTED" && error.details.errors.some(item => item.keyword === "maxLength"),
  );

  const wideProse = makeReceipt();
  wideProse.decisionBoundary = "é".repeat(Math.floor(OBSERVER_RESOURCE_LIMITS.proseBytes / 2) + 1);
  assert.throws(
    () => validateReceipt(wideProse),
    error => error instanceof ObserverError && error.code === "RESOURCE_LIMIT_EXCEEDED" && error.details.boundary === "receipt.decisionBoundary",
  );

  const wideObservation = makeReceipt();
  wideObservation.result.normalized = { note: "x".repeat(OBSERVER_RESOURCE_LIMITS.normalizedStringBytes + 1) };
  assert.throws(
    () => validateReceipt(wideObservation),
    error => error instanceof ObserverError && error.code === "RESOURCE_LIMIT_EXCEEDED" && error.details.boundary === "receipt.result.normalized.string",
  );
});

test("receipt viewport dimensions share the matrix envelope", () => {
  const candidate = makeReceipt();
  candidate.viewportMedia.height = OBSERVER_RESOURCE_LIMITS.viewportHeight + 1;
  assert.throws(() => validateReceipt(candidate), error => error instanceof ObserverError && error.code === "VIEWPORT_INVALID");
  assert.throws(
    () => validateReceiptSchema(candidate),
    error => error instanceof ObserverError && error.code === "RECEIPT_SCHEMA_REJECTED" && error.details.errors.some(item => item.keyword === "maximum"),
  );
});
