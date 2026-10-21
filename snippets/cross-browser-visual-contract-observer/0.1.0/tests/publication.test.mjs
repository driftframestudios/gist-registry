import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ObserverError } from "../src/contracts.mjs";
import { publishReceipt } from "../src/publication.mjs";
import { artifactSources, makeReceipt } from "./helpers.mjs";

test("candidate promotion moves one accepted pointer after verification", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-receipt-"));
  const pointer = await publishReceipt(root, makeReceipt(), { artifactSources: artifactSources() });
  assert.equal(pointer.receiptId, "semantic-chromium-baseline");
  assert.deepEqual(JSON.parse(await readFile(join(root, "accepted-pointer.json"), "utf8")), pointer);
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
