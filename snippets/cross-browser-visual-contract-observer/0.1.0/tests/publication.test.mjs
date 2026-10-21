import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OBSERVER_RESOURCE_LIMITS, ObserverError } from "../src/contracts.mjs";
import { publishReceipt } from "../src/publication.mjs";
import { artifactSources, makeReceipt, subjectSourcePath } from "./helpers.mjs";

test("candidate promotion moves one accepted pointer after verification", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-receipt-"));
  const pointer = await publishReceipt(root, makeReceipt(), { artifactSources: artifactSources() });
  assert.equal(pointer.receiptId, "semantic-chromium-baseline");
  assert.deepEqual(JSON.parse(await readFile(join(root, "accepted-pointer.json"), "utf8")), pointer);
});

test("publication rejects a symbolic-link artifact source before capture", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-receipt-"));
  const linkedSource = join(root, "receiver-link.html");
  await symlink(subjectSourcePath, linkedSource);
  const receipt = makeReceipt();
  const sources = artifactSources();
  sources[receipt.artifacts[0].path] = linkedSource;

  await assert.rejects(
    publishReceipt(root, receipt, { artifactSources: sources }),
    error => error instanceof ObserverError && error.code === "SOURCE_FILE_INVALID" && error.details.restartFrom === "candidate",
  );
  assert.deepEqual(await readdir(join(root, ".candidates")), []);
});

test("publication rejects an oversized sparse artifact before reading its body", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-receipt-"));
  const sparseSource = join(root, "oversized-sparse.bin");
  await writeFile(sparseSource, Buffer.from([0]));
  await truncate(sparseSource, OBSERVER_RESOURCE_LIMITS.artifactBytes + 1);
  const receipt = makeReceipt();
  const sources = artifactSources();
  sources[receipt.artifacts[0].path] = sparseSource;

  await assert.rejects(
    publishReceipt(root, receipt, { artifactSources: sources }),
    error => (
      error instanceof ObserverError &&
      error.code === "RESOURCE_LIMIT_EXCEEDED" &&
      error.details.boundary === `artifact_source.${receipt.artifacts[0].path}`
    ),
  );
  assert.deepEqual(await readdir(join(root, ".candidates")), []);
});

test("concurrent identical publishers own separate candidate directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-receipt-"));
  const receipt = makeReceipt();
  const pointers = await Promise.all(
    Array.from({ length: 8 }, () => publishReceipt(root, receipt, { artifactSources: artifactSources() })),
  );
  for (const pointer of pointers) assert.deepEqual(pointer, pointers[0]);
  assert.deepEqual(JSON.parse(await readFile(join(root, "accepted-pointer.json"), "utf8")), pointers[0]);
  assert.deepEqual(await readdir(join(root, ".candidates")), []);
});

for (const injectFault of ["after_candidate", "before_pointer"]) {
  test(`${injectFault} interruption preserves the previous accepted pointer`, async () => {
    const root = await mkdtemp(join(tmpdir(), "visual-receipt-"));
    const accepted = await publishReceipt(root, makeReceipt(), { artifactSources: artifactSources() });
    const successor = makeReceipt();
    successor.receiptId = `successor-${injectFault}`;
    await assert.rejects(
      publishReceipt(root, successor, { injectFault, artifactSources: artifactSources() }),
      error => Boolean(error instanceof ObserverError && error.code === "INJECTED_INTERRUPTION" && error.details.restartFrom),
    );
    assert.deepEqual(JSON.parse(await readFile(join(root, "accepted-pointer.json"), "utf8")), accepted);
  });
}

test("replay rejects a corrupted digest-addressed destination before moving the pointer", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-receipt-"));
  const receipt = makeReceipt();
  const pointer = await publishReceipt(root, receipt, { artifactSources: artifactSources() });
  const acceptedDirectory = join(root, "accepted", pointer.receiptSha256);
  await writeFile(join(acceptedDirectory, "receipt.md"), "corrupted\n");

  await assert.rejects(
    publishReceipt(root, receipt, { artifactSources: artifactSources() }),
    error => error instanceof ObserverError && error.code === "ACCEPTED_INTEGRITY_MISMATCH",
  );
  assert.deepEqual(JSON.parse(await readFile(join(root, "accepted-pointer.json"), "utf8")), pointer);
});
