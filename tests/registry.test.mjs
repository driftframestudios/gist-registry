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
const companionManifestPaths = new Map([
  [
    "0.1.0",
    resolve(
      repositoryRoot,
      "snippets/document-evidence-core-patterns/0.1.0/snippet.json",
    ),
  ],
  [
    "0.1.1",
    resolve(
      repositoryRoot,
      "snippets/document-evidence-core-patterns/0.1.1/snippet.json",
    ),
  ],
]);
const companionExpectations = new Map([
  [
    "0.1.0",
    {
      derivedFrom: "document-evidence-extraction@0.1.0",
      orderedFiles: [
        "gist/00-README.md",
        "gist/10-same-byte-capture.md",
        "gist/20-recovery-aware-promotion.md",
      ],
      successorOf: null,
    },
  ],
  [
    "0.1.1",
    {
      derivedFrom: "document-evidence-extraction@0.1.1",
      orderedFiles: [
        "gist/00-README.md",
        "gist/10-observed-effect-reconciliation.md",
        "gist/20-caller-retained-recovery.md",
      ],
      successorOf: "document-evidence-core-patterns@0.1.0",
    },
  ],
]);
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

function countOccurrences(source, selection) {
  if (!selection) return 0;
  return source.split(selection).length - 1;
}

function definitionBlock(source, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const declaration = new RegExp(
    "^(\\s*)(?:class|def) " + escapedName + "(?:\\b|\\()",
    "u",
  );
  const lines = source.split("\n");
  const start = lines.findIndex(line => declaration.test(line));
  if (start < 0) return null;
  const indentation = lines[start].match(/^\s*/u)[0].length;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    const nextIndentation = line.match(/^\s*/u)[0].length;
    if (
      nextIndentation <= indentation &&
      /^(?:class|def)\s+/u.test(line.trimStart())
    ) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trimEnd();
}

test("the real registry resolves all exact versions and their representations", async () => {
  const result = await checkRegistry({ root: repositoryRoot });
  assert.deepEqual(result, { artifactCount: 4 });
});

test("the first schema attempt validates four artifacts across two kinds", async () => {
  const result = await checkSchemaNursery();
  assert.deepEqual(result, {
    schemaVersion: "0.1.0",
    artifactCount: 4,
    instances: [
      "document-evidence-extraction@0.1.0",
      "document-evidence-extraction@0.1.1",
      "document-evidence-core-patterns@0.1.0",
      "document-evidence-core-patterns@0.1.1",
    ],
  });
});

test("each compact companion keeps one ordered Gist candidate and one runnable source owner", async () => {
  for (const [version, manifestPath] of companionManifestPaths) {
    const manifest = await json(manifestPath);
    const expected = companionExpectations.get(version);
    assert.equal(manifest.artifactKind, "code_excerpt");
    assert.equal(manifest.standing, "candidate");
    assert.deepEqual(manifest.extensions.gistCandidate.orderedFiles, expected.orderedFiles);
    assert.deepEqual(
      manifest.representations
        .filter(representation => representation.role.startsWith("gist_"))
        .map(representation => representation.path),
      manifest.extensions.gistCandidate.orderedFiles,
    );
    assert.equal(
      manifest.relationships.find(relationship => relationship.type === "derived_from")
        ?.target,
      expected.derivedFrom,
    );
    assert.equal(
      manifest.relationships.find(relationship => relationship.type === "successor_of")
        ?.target ?? null,
      expected.successorOf,
    );
  }
});

test("every companion Python block remains an exact selection from its declared owner", async () => {
  const registry = await json(resolve(repositoryRoot, "registry.json"));

  for (const [version, manifestPath] of companionManifestPaths) {
    const manifest = await json(manifestPath);
    const artifactRoot = dirname(manifestPath);
    const sourceTarget = manifest.relationships.find(
      relationship => relationship.type === "derived_from",
    ).target;
    const separator = sourceTarget.lastIndexOf("@");
    const sourceEntry = registry.entries.find(
      entry =>
        entry.semanticId === sourceTarget.slice(0, separator) &&
        entry.version === sourceTarget.slice(separator + 1),
    );
    assert.ok(sourceEntry, sourceTarget + " must resolve through registry.json");
    const sourceManifest = await json(resolve(repositoryRoot, sourceEntry.manifestPath));
    const declaredOwnerPaths = new Set(
      sourceManifest.representations
        .filter(representation => ["source", "test"].includes(representation.role))
        .map(representation => sourceEntry.canonicalPath + "/" + representation.path),
    );
    let blockCount = 0;

    for (const selection of manifest.extensions.gistCandidate.sourceSelections) {
      assert.ok(
        manifest.extensions.gistCandidate.orderedFiles.includes(selection.companionPath),
        selection.companionPath + " must belong to the ordered Gist candidate",
      );
      assert.ok(
        declaredOwnerPaths.has(selection.sourcePath),
        selection.sourcePath + " must be a declared source representation",
      );
      assert.ok(
        declaredOwnerPaths.has(selection.testPath),
        selection.testPath + " must be a declared test representation",
      );
      const [reading, source, tests] = await Promise.all([
        readFile(resolve(artifactRoot, selection.companionPath), "utf8"),
        readFile(resolve(repositoryRoot, selection.sourcePath), "utf8"),
        readFile(resolve(repositoryRoot, selection.testPath), "utf8"),
      ]);
      const blocks = pythonBlocks(reading);
      assert.ok(blocks.length > 0, selection.companionPath + " must carry Python selections");
      blockCount += blocks.length;

      for (const symbol of selection.symbols) {
        const definition = definitionBlock(source, symbol);
        assert.ok(definition, symbol + " must resolve in the declared source owner");
        assert.ok(
          blocks.some(block => {
            const declaration = new RegExp(
              "^(?:class|def) " + symbol.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&") +
                "(?:\\b|\\()",
              "mu",
            );
            return (
              declaration.test(block) ||
              [block, ...[4, 8, 12].map(spaces => indentBlock(block, spaces))].some(
                candidate => definition.includes(candidate),
              )
            );
          }),
          symbol + " must be represented by an exact companion selection",
        );
      }
      for (const testName of selection.tests) {
        const definition = definitionBlock(tests, testName);
        assert.ok(definition, testName + " must resolve in the declared test owner");
        assert.ok(
          blocks.some(block =>
            [block, ...[4, 8, 12].map(spaces => indentBlock(block, spaces))].some(
              candidate => definition.includes(candidate),
            ),
          ),
          testName + " must be represented by an exact companion selection",
        );
      }

      for (const block of blocks) {
        const candidates = [block, ...[4, 8, 12].map(spaces => indentBlock(block, spaces))];
        const occurrences = [source, tests].reduce(
          (count, authority) =>
            count +
            candidates.reduce(
              (candidateCount, candidate) =>
                candidateCount + countOccurrences(authority, candidate),
              0,
            ),
          0,
        );
        assert.equal(
          occurrences,
          1,
          selection.companionPath + " must contain one exact owner selection",
        );
      }
    }
    assert.ok(blockCount > 0, `companion ${version} must carry exact Python selections`);
  }
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
