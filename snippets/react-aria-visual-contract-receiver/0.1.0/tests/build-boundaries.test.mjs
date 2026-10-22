import "../node-runtime-admission.mjs";

import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {lstat, mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import test from "node:test";
import {
  BuildBoundaryError,
  hashBoundedRegularFile,
  inventoryRegularFiles,
  readBoundedRegularFile
} from "../tools/bounded-files.mjs";
import {writeEvidenceOutput} from "../tools/verify-build.mjs";

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

async function pathExists(path) {
  return lstat(path).then(() => true, () => false);
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

test("evidence output replaces a regular leaf through an atomic owned-path write", async () => {
  await withTemporaryDirectory(async (root) => {
    const owner = join(root, "owner");
    const output = join(owner, "nested", "evidence");
    await mkdir(owner);
    await writeEvidenceOutput({
      ownerRoot: owner,
      outputDirectory: output,
      fileName: "receipt.json",
      bytes: "first\n"
    });
    await writeEvidenceOutput({
      ownerRoot: owner,
      outputDirectory: output,
      fileName: "receipt.json",
      bytes: "second\n"
    });
    assert.equal(await readFile(join(output, "receipt.json"), "utf8"), "second\n");
  });
});

test("evidence output rejects replacement of its captured owner root", async () => {
  await withTemporaryDirectory(async (root) => {
    const owner = join(root, "owner");
    const heldOwner = join(root, "held-owner");
    const outside = join(root, "outside");
    await mkdir(owner);
    await mkdir(outside);

    await assert.rejects(
      writeEvidenceOutput({
        ownerRoot: owner,
        outputDirectory: join(owner, "evidence"),
        fileName: "receipt.json",
        bytes: "bounded\n",
        injectFault: async ({checkpoint}) => {
          if (checkpoint !== "after_owner_capture") return;
          await rename(owner, heldOwner);
          await symlink(outside, owner, "dir");
        }
      }),
      hasBoundaryCode("EVIDENCE_OUTPUT_BOUNDARY_INVALID")
    );
    assert.equal(await pathExists(join(outside, "receipt.json")), false);
    assert.equal(await pathExists(join(outside, "evidence", "receipt.json")), false);
  });
});

test("evidence output rejects replacement of a captured intermediate directory", async () => {
  await withTemporaryDirectory(async (root) => {
    const owner = join(root, "owner");
    const intermediate = join(owner, "intermediate");
    const heldIntermediate = join(owner, "held-intermediate");
    const outside = join(root, "outside");
    await mkdir(owner);
    await mkdir(outside);

    await assert.rejects(
      writeEvidenceOutput({
        ownerRoot: owner,
        outputDirectory: join(intermediate, "evidence"),
        fileName: "receipt.json",
        bytes: "bounded\n",
        injectFault: async ({checkpoint, relativeDirectory}) => {
          if (checkpoint !== "after_directory_capture" || relativeDirectory !== "intermediate") return;
          await rename(intermediate, heldIntermediate);
          await symlink(outside, intermediate, "dir");
        }
      }),
      hasBoundaryCode("EVIDENCE_OUTPUT_BOUNDARY_INVALID")
    );
    assert.equal(await pathExists(join(outside, "receipt.json")), false);
    assert.equal(await pathExists(join(outside, "evidence", "receipt.json")), false);
  });
});

test("evidence output rejects a prepared symbolic-link leaf", async () => {
  await withTemporaryDirectory(async (root) => {
    const owner = join(root, "owner");
    const output = join(owner, "evidence");
    const outside = join(root, "outside.json");
    await mkdir(output, {recursive: true});
    await writeFile(outside, "outside\n");
    await symlink(outside, join(output, "receipt.json"));

    await assert.rejects(
      writeEvidenceOutput({
        ownerRoot: owner,
        outputDirectory: output,
        fileName: "receipt.json",
        bytes: "bounded\n"
      }),
      hasBoundaryCode("EVIDENCE_OUTPUT_BOUNDARY_INVALID")
    );
    assert.equal(await readFile(outside, "utf8"), "outside\n");
  });
});

test("evidence output rejects a same-size temporary-byte mutation", async () => {
  await withTemporaryDirectory(async (root) => {
    const owner = join(root, "owner");
    const output = join(owner, "evidence");
    await mkdir(owner);

    await assert.rejects(
      writeEvidenceOutput({
        ownerRoot: owner,
        outputDirectory: output,
        fileName: "receipt.json",
        bytes: "trusted",
        injectFault: async ({checkpoint, temporaryPath}) => {
          if (checkpoint === "before_rename") {
            await writeFile(temporaryPath, "hostile");
          }
        }
      }),
      error => hasBoundaryCode("EVIDENCE_OUTPUT_BOUNDARY_INVALID")(error) &&
        error.details.reason === "file_bytes_changed"
    );
    assert.equal(await pathExists(join(output, "receipt.json")), false);
  });
});

test("evidence output rejects a same-size destination-byte mutation", async () => {
  await withTemporaryDirectory(async (root) => {
    const owner = join(root, "owner");
    const output = join(owner, "evidence");
    await mkdir(owner);

    await assert.rejects(
      writeEvidenceOutput({
        ownerRoot: owner,
        outputDirectory: output,
        fileName: "receipt.json",
        bytes: "trusted",
        injectFault: async ({checkpoint, destination}) => {
          if (checkpoint === "after_rename") {
            await writeFile(destination, "hostile");
          }
        }
      }),
      error => hasBoundaryCode("EVIDENCE_OUTPUT_BOUNDARY_INVALID")(error) &&
        error.details.reason === "file_bytes_changed"
    );
  });
});

test("the build verifier runs through its canonical and symbolic-link routes", async (context) => {
  if (process.platform === "win32") return;
  const packageRoot = resolve(import.meta.dirname, "..");
  const verifier = resolve(packageRoot, "tools/verify-build.mjs");
  const root = await mkdtemp(join(tmpdir(), "receiver-verifier-link-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const link = join(root, "verify-build.mjs");
  const override = join(root, "override-node-version.mjs");
  await symlink(verifier, link);
  await writeFile(
    override,
    'Object.defineProperty(process, "version", { value: "v26.11.0" });\n'
  );

  const direct = spawnSync(process.execPath, [verifier], {
    cwd: packageRoot,
    encoding: "utf8"
  });
  const linked = spawnSync(process.execPath, [link], {
    cwd: packageRoot,
    encoding: "utf8"
  });
  assert.equal(direct.status, 0, direct.stderr);
  assert.equal(linked.status, 0, linked.stderr);
  const directReceipt = JSON.parse(direct.stdout);
  const linkedReceipt = JSON.parse(linked.stdout);
  assert.equal(linkedReceipt.coordinate, directReceipt.coordinate);
  assert.equal(linkedReceipt.manifest.sha256, directReceipt.manifest.sha256);
  assert.deepEqual(linkedReceipt.measurements, directReceipt.measurements);

  const stale = spawnSync(process.execPath, ["--import", override, link], {
    cwd: packageRoot,
    encoding: "utf8"
  });
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /NODE_SECURITY_FLOOR/u);
});
