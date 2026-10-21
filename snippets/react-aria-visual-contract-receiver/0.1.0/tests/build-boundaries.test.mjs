import assert from "node:assert/strict";
import {mkdtemp, mkdir, rm, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {
  BuildBoundaryError,
  hashBoundedRegularFile,
  inventoryRegularFiles,
  readBoundedRegularFile
} from "../tools/bounded-files.mjs";

async function withTemporaryDirectory(run) {
  const root = await mkdtemp(join(tmpdir(), "receiver-build-boundary-"));
  try {
    return await run(root);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
}

function hasBoundaryCode(code) {
  return (error) => error instanceof BuildBoundaryError && error.code === code;
}

test("bounded inventory, descriptor read, and hash accept their exact envelopes", async () => {
  await withTemporaryDirectory(async (root) => {
    const nested = join(root, "nested");
    const first = join(root, "first.txt");
    const second = join(nested, "second.txt");
    await mkdir(nested);
    await writeFile(first, "abc");
    await writeFile(second, "12345");

    const inventory = await inventoryRegularFiles(root, {maxEntries: 3, maxDepth: 2});
    assert.deepEqual(inventory, {
      entryCount: 3,
      files: ["first.txt", "nested/second.txt"]
    });
    assert.equal((await readBoundedRegularFile(first, {maxBytes: 3})).toString(), "abc");
    assert.deepEqual(
      await hashBoundedRegularFile(second, {maxBytes: 5}),
      {
        bytes: 5,
        sha256: "5994471abb01112afcc18159f6cc74b4f511b99806da59b3caf5a9c173cacfc5"
      }
    );
  });
});

test("file size, inventory count, and directory depth enforce independent limits", async () => {
  await withTemporaryDirectory(async (root) => {
    const nested = join(root, "one", "two");
    const file = join(root, "one", "bounded.txt");
    await mkdir(nested, {recursive: true});
    await writeFile(file, "four");
    await writeFile(join(nested, "deep.txt"), "deep");

    await assert.rejects(
      readBoundedRegularFile(file, {maxBytes: 3}),
      hasBoundaryCode("FILE_SIZE_EXCEEDED")
    );
    await assert.rejects(
      inventoryRegularFiles(root, {maxEntries: 1, maxDepth: 3}),
      hasBoundaryCode("ENTRY_COUNT_EXCEEDED")
    );
    await assert.rejects(
      inventoryRegularFiles(root, {maxEntries: 4, maxDepth: 2}),
      hasBoundaryCode("DIRECTORY_DEPTH_EXCEEDED")
    );
  });
});

test("inventory and descriptor reads reject symbolic-link indirection", async () => {
  await withTemporaryDirectory(async (root) => {
    const target = join(root, "target.txt");
    const link = join(root, "linked.txt");
    await writeFile(target, "owned");
    await symlink(target, link);

    await assert.rejects(
      inventoryRegularFiles(root, {maxEntries: 2, maxDepth: 1}),
      hasBoundaryCode("SYMLINK_FORBIDDEN")
    );
    await assert.rejects(
      hashBoundedRegularFile(link, {maxBytes: 5}),
      hasBoundaryCode("SYMLINK_FORBIDDEN")
    );
  });
});
