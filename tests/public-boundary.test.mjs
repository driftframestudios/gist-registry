import "../tools/node-runtime-guard.mjs";

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  checkRootReadmeCanaryPrefix,
  rootReadmeCanaryPrefix,
} from "../tools/check-public-boundary.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

test("the root README begins with the exact approved canary stack", async () => {
  const result = await checkRootReadmeCanaryPrefix({ root: repositoryRoot });
  assert.deepEqual(result, {
    checkedPath: "README.md",
    byteCount: Buffer.byteLength(rootReadmeCanaryPrefix),
  });
});

test("a changed canary prefix returns to the public-boundary owner", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "gist-registry-public-boundary-check-"));
  try {
    await writeFile(join(fixture, "README.md"), rootReadmeCanaryPrefix.replace("MAPS", "MOPS"));
    await assert.rejects(
      checkRootReadmeCanaryPrefix({ root: fixture }),
      /must begin byte-for-byte with the approved MAPS and BIG-bench canary stack/u,
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
