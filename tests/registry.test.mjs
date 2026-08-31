import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { checkRegistry } from "../tools/check-registry.mjs";
import { checkSchemaNursery, validateArtifactEnvelope } from "../tools/check-schema.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const manifestPath = resolve(
  repositoryRoot,
  "snippets/document-evidence-extraction/0.1.0/snippet.json",
);
const companionManifestPath = resolve(
  repositoryRoot,
  "snippets/document-evidence-core-patterns/0.1.0/snippet.json",
);
const schemaPath = resolve(repositoryRoot, "schemas/0.1.0/registry-artifact.schema.json");

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function pythonBlocks(markdown) {
  return [...markdown.matchAll(/```python\n([\s\S]*?)\n```/gu)].map(match => match[1]);
}

function indentBlock(source, spaces) {
  const prefix = " ".repeat(spaces);
  return source
    .split("\n")
    .map(line => (line ? prefix + line : line))
    .join("\n");
}

test("the real registry resolves both versioned artifacts and their representations", async () => {
  const result = await checkRegistry({ root: repositoryRoot });
  assert.deepEqual(result, { artifactCount: 2 });
});

test("the first schema attempt validates two artifact kinds without closing the kind set", async () => {
  const result = await checkSchemaNursery();
  assert.deepEqual(result, {
    schemaVersion: "0.1.0",
    artifactCount: 2,
    instances: [
      "document-evidence-extraction@0.1.0",
      "document-evidence-core-patterns@0.1.0",
    ],
  });
});

test("the compact companion keeps one ordered Gist candidate and one runnable source owner", async () => {
  const manifest = await json(companionManifestPath);
  assert.equal(manifest.artifactKind, "code_excerpt");
  assert.equal(manifest.standing, "candidate");
  assert.deepEqual(manifest.extensions.gistCandidate.orderedFiles, [
    "gist/00-README.md",
    "gist/10-same-byte-capture.md",
    "gist/20-recovery-aware-promotion.md",
  ]);
  assert.deepEqual(
    manifest.representations
      .filter(representation => representation.role.startsWith("gist_"))
      .map(representation => representation.path),
    manifest.extensions.gistCandidate.orderedFiles,
  );
  assert.deepEqual(
    manifest.relationships.find(relationship => relationship.type === "derived_from"),
    {
      type: "derived_from",
      target: "document-evidence-extraction@0.1.0",
      reason:
        "The comprehensive artifact owns the selected implementation, focused tests, fixtures, dependency lock, and recovery behavior.",
    },
  );
});

test("every companion Python block remains an exact selection from its named source owner", async () => {
  const manifest = await json(companionManifestPath);
  const artifactRoot = resolve(
    repositoryRoot,
    "snippets/document-evidence-core-patterns/0.1.0",
  );
  let blockCount = 0;

  for (const selection of manifest.extensions.gistCandidate.sourceSelections) {
    assert.ok(
      manifest.extensions.gistCandidate.orderedFiles.includes(selection.companionPath),
      selection.companionPath + " must belong to the ordered Gist candidate",
    );
    const [reading, source, tests] = await Promise.all([
      readFile(resolve(artifactRoot, selection.companionPath), "utf8"),
      readFile(resolve(repositoryRoot, selection.sourcePath), "utf8"),
      readFile(resolve(repositoryRoot, selection.testPath), "utf8"),
    ]);
    for (const symbol of selection.symbols)
      assert.match(
        source,
        new RegExp("^def " + symbol + "\\(", "mu"),
        symbol + " must resolve in the declared source owner",
      );
    for (const testName of selection.tests)
      assert.match(
        tests,
        new RegExp("^\\s*def " + testName + "\\(", "mu"),
        testName + " must resolve in the declared test owner",
      );

    const blocks = pythonBlocks(reading);
    assert.ok(blocks.length > 0, selection.companionPath + " must carry Python selections");
    blockCount += blocks.length;
    for (const block of blocks) {
      const candidates = [block, ...[4, 8, 12].map(spaces => indentBlock(block, spaces))];
      assert.ok(
        [source, tests].some(authority =>
          candidates.some(candidate => authority.includes(candidate)),
        ),
        selection.companionPath + " must remain an exact source or test selection",
      );
    }
  }
  assert.equal(blockCount, 6);
});

test("JSON Schema semantics reject an invalid nested artifact value", async () => {
  const [schema, manifest] = await Promise.all([json(schemaPath), json(manifestPath)]);
  manifest.use.capabilities = ["Not path safe"];
  assert.throws(
    () => validateArtifactEnvelope(schema, manifest),
    /artifact manifest does not satisfy.*capabilities/u,
  );
});

test("the exact-version schema rejects a manifest that claims another schema version", async () => {
  const [schema, manifest] = await Promise.all([json(schemaPath), json(manifestPath)]);
  manifest.schemaVersion = "0.1.1";
  assert.throws(
    () => validateArtifactEnvelope(schema, manifest),
    /artifact manifest does not satisfy.*schemaVersion.*must be equal to constant/u,
  );
});

test("the schema checker rejects a copied 0.1.0 contract outside its canonical path", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "gist-registry-schema-path-check-"));
  try {
    const [registry, schema, manifest] = await Promise.all([
      json(resolve(repositoryRoot, "registry.json")),
      json(schemaPath),
      json(manifestPath),
    ]);
    registry.entries = [registry.entries[0]];
    const fixtureArtifactRoot = resolve(fixture, registry.entries[0].canonicalPath);
    const fixtureSchemaRoot = resolve(fixture, "schemas/0.1.0");
    const copiedSchema = {
      ...schema,
      description: `${schema.description} Altered copy for path-authority testing.`,
    };
    manifest.$schema = "../../../schemas/0.1.0/copied-registry-artifact.schema.json";

    await mkdir(fixtureSchemaRoot, { recursive: true });
    await cp(dirname(manifestPath), fixtureArtifactRoot, {
      recursive: true,
      filter: source => !/[\\/](?:\.artifacts|\.ruff_cache|\.venv|__pycache__)(?:[\\/]|$)/u.test(source),
    });
    await Promise.all([
      writeFile(
        resolve(fixture, "registry.json"),
        `${JSON.stringify(registry, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        resolve(fixtureSchemaRoot, "registry-artifact.schema.json"),
        `${JSON.stringify(schema, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        resolve(fixtureSchemaRoot, "copied-registry-artifact.schema.json"),
        `${JSON.stringify(copiedSchema, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        resolve(fixtureArtifactRoot, "snippet.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
      ),
    ]);

    assert.equal(copiedSchema.$id, schema.$id);
    assert.equal(copiedSchema.properties.schemaVersion.const, "0.1.0");
    validateArtifactEnvelope(copiedSchema, manifest);
    await assert.rejects(
      checkSchemaNursery({ root: fixture }),
      /schemaVersion 0\.1\.0 must resolve to schemas\/0\.1\.0\/registry-artifact\.schema\.json/u,
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("path disagreement returns to the registry owner without copying the worktree", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "gist-registry-path-check-"));
  try {
    const registry = await json(resolve(repositoryRoot, "registry.json"));
    registry.entries[0].canonicalPath = "snippets/document-evidence-extraction/0.1.1";
    await writeFile(
      join(fixture, "registry.json"),
      `${JSON.stringify(registry, null, 2)}\n`,
      "utf8",
    );
    await assert.rejects(
      checkRegistry({ root: fixture }),
      /canonicalPath must follow the version grammar/u,
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("a manifest symlink cannot escape the checked repository", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "gist-registry-symlink-check-"));
  try {
    const registry = await json(resolve(repositoryRoot, "registry.json"));
    const linkedManifest = resolve(fixture, registry.entries[0].manifestPath);
    await mkdir(dirname(linkedManifest), { recursive: true });
    await writeFile(
      resolve(fixture, "registry.json"),
      `${JSON.stringify(registry, null, 2)}\n`,
      "utf8",
    );
    await symlink(manifestPath, linkedManifest);
    await assert.rejects(
      checkRegistry({ root: fixture }),
      /manifest must not be a symbolic link/u,
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
