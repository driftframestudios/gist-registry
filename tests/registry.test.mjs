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
const schemaPath = resolve(repositoryRoot, "schemas/0.1.0/registry-artifact.schema.json");

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("the real registry resolves one versioned artifact and its representations", async () => {
  const result = await checkRegistry({ root: repositoryRoot });
  assert.deepEqual(result, { artifactCount: 1 });
});

test("the first schema attempt validates its real artifact without closing the kind set", async () => {
  const result = await checkSchemaNursery();
  assert.deepEqual(result, {
    schemaVersion: "0.1.0",
    artifactCount: 1,
    instances: ["document-evidence-extraction@0.1.0"],
  });
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
