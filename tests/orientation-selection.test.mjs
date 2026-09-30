import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  checkOrientationSelection,
  orientationLocatorBoundaryPaths,
  validateOrientationSelection,
} from "../tools/check-orientation.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const selectionPath = resolve(repositoryRoot, "orientation/selection.json");

async function selection() {
  return JSON.parse(await readFile(selectionPath, "utf8"));
}

async function withOrientationFixture(action) {
  const root = await mkdtemp(join(tmpdir(), "gist-registry-orientation-test-"));
  const model = await selection();
  try {
    const sourcePaths = new Set([
      ...model.records.flatMap(record => record.localRoutes.map(route => route.path)),
      ...orientationLocatorBoundaryPaths,
    ]);
    for (const path of sourcePaths) {
      const target = resolve(root, path);
      await mkdir(dirname(target), { recursive: true });
      await cp(resolve(repositoryRoot, path), target);
    }
    await mkdir(resolve(root, "orientation"), { recursive: true });
    await writeFile(
      resolve(root, "orientation/selection.json"),
      JSON.stringify(model, null, 2) + "\n",
      "utf8",
    );
    return await action({ root, model });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("the repository orientation selection has a closed local fallback route", async () => {
  assert.deepEqual(await checkOrientationSelection(), {
    recordCount: 22,
    profileCount: 6,
    defaultRecordCount: 4,
  });
});

test("registry checks run when orientation, standing ground, or planning changes", async () => {
  const workflow = await readFile(
    resolve(repositoryRoot, ".github/workflows/registry-checks.yml"),
    "utf8",
  );
  assert.match(workflow, /- "orientation\/\*\*"/u);
  assert.match(workflow, /- "AGENTS\.md"/u);
  assert.match(workflow, /- "planning\/\*\*"/u);
});

test("stable ids, semantic identities, and profile references remain singular", async () => {
  const model = await selection();
  model.records[1].id = model.records[0].id;
  await assert.rejects(
    validateOrientationSelection(model),
    /record ids must be unique/u,
  );

  const duplicateSemanticKey = await selection();
  duplicateSemanticKey.records[1].semanticKey = duplicateSemanticKey.records[0].semanticKey;
  await assert.rejects(
    validateOrientationSelection(duplicateSemanticKey),
    /semantic keys must be unique/u,
  );

  const danglingProfile = await selection();
  danglingProfile.profiles[0].recordIds.push("gr-orient-999");
  await assert.rejects(
    validateOrientationSelection(danglingProfile),
    /references unknown record/u,
  );
});

test("the v0.1 contract rejects unknown fields and unsafe route paths", async () => {
  const unknownField = await selection();
  unknownField.records[0].providerUrl = "resolver-held";
  await assert.rejects(
    validateOrientationSelection(unknownField),
    /exact v0\.1 fields/u,
  );

  const traversal = await selection();
  traversal.records[0].localRoutes[0].path = "../outside.md";
  await assert.rejects(
    validateOrientationSelection(traversal),
    /safe repository-relative path/u,
  );
});

test("provider and workstation locator shapes stay with the authorized resolver", async () => {
  for (const marker of [
    "https://workspace.example/page",
    "https://workspace.notion.site/private",
    "notion://workspace/private",
    "obsidian://open?file=private",
    "file:///private/note.md",
    "/Users/example/private.md",
    "C:\\Users\\example\\private.md",
    "123e4567-e89b-42d3-a456-426614174000",
    "123e4567-e89b-02d3-7456-426614174000",
    "123e4567e89b42d3a456426614174000",
    "::private_resolver::",
  ]) {
    const model = await selection();
    model.records[0].readerJob += " " + marker;
    await assert.rejects(
      validateOrientationSelection(model),
      /orientation selection must keep/u,
    );
  }

  await withOrientationFixture(async ({ root }) => {
    const path = resolve(root, "orientation/adapters/notion.md");
    await writeFile(path, (await readFile(path, "utf8")) + "\nnotion://workspace/private\n", "utf8");
    await assert.rejects(
      checkOrientationSelection({ root }),
      /locator boundary source .* must keep Notion application locator resolver-held/u,
    );
  });
});

test("core depth, semantic-key paths, and observation dates retain their meanings", async () => {
  const exchangedDepth = await selection();
  exchangedDepth.records[1].selectionDepth = "conditional";
  exchangedDepth.records[5].selectionDepth = "default";
  await assert.rejects(
    validateOrientationSelection(exchangedDepth),
    /default records must remain exactly the cold-session-core/u,
  );

  for (const semanticKey of ["@driftframe/probes//verification", "@driftframe/probes/"]) {
    const malformedKey = await selection();
    malformedKey.records[0].semanticKey = semanticKey;
    await assert.rejects(
      validateOrientationSelection(malformedKey),
      /must use a stable Driftframe identity/u,
    );
  }

  const impossibleDate = await selection();
  impossibleDate.records[0].observedOn = "2026-02-31";
  await assert.rejects(
    validateOrientationSelection(impossibleDate),
    /must be a real calendar date/u,
  );
});

test("local routes resolve to regular files through their repository paths", async () => {
  await withOrientationFixture(async ({ root, model }) => {
    await checkOrientationSelection({ root });
    const route = model.records[0].localRoutes[0];
    const routePath = resolve(root, route.path);
    const outside = resolve(root, "outside.md");
    await writeFile(outside, "outside\n", "utf8");
    await rm(routePath);
    await symlink(outside, routePath);
    await assert.rejects(
      checkOrientationSelection({ root }),
      /must resolve without a symbolic link/u,
    );
  });
});
