import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { checkRegistry } from "./check-registry.mjs";

const modulePath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(modulePath), "..");

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function schemaErrors(errors) {
  return (errors ?? [])
    .map(error => `${error.instancePath || "/"} ${error.message}`)
    .join("; ");
}

export function validateArtifactEnvelope(schema, manifest) {
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
  addFormats(ajv, { mode: "full" });
  assert.ok(ajv.validateSchema(schema), `artifact schema is invalid: ${schemaErrors(ajv.errors)}`);
  const validate = ajv.compile(schema);
  assert.ok(
    validate(manifest),
    `artifact manifest does not satisfy ${schema.$id}: ${schemaErrors(validate.errors)}`,
  );
}

export async function checkSchemaNursery({ root = repositoryRoot } = {}) {
  await checkRegistry({ root });
  const registry = await json(resolve(root, "registry.json"));
  const checked = [];

  for (const entry of registry.entries) {
    const manifestPath = resolve(root, entry.manifestPath);
    const manifest = await json(manifestPath);
    const schemaPath = resolve(dirname(manifestPath), manifest.$schema);

    if (manifest.schemaVersion === "0.1.0") {
      const canonicalSchemaPath = resolve(
        root,
        "schemas/0.1.0/registry-artifact.schema.json",
      );
      const [resolvedSchemaPath, resolvedCanonicalSchemaPath] = await Promise.all([
        realpath(schemaPath),
        realpath(canonicalSchemaPath),
      ]);
      assert.equal(
        resolvedSchemaPath,
        resolvedCanonicalSchemaPath,
        "schemaVersion 0.1.0 must resolve to schemas/0.1.0/registry-artifact.schema.json",
      );
    }

    const schema = await json(schemaPath);
    validateArtifactEnvelope(schema, manifest);
    checked.push(`${manifest.semanticId}@${manifest.version}`);

    if (manifest.schemaVersion === "0.1.0") {
      assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
      assert.equal(
        schema.$id,
        "https://kindlight.io/schemas/gist-registry/0.1.0/registry-artifact.schema.json",
      );
      assert.equal(schema.type, "object");
      assert.equal(schema.additionalProperties, false);
      assert.equal(schema.properties.artifactKind.enum, undefined, "artifactKind must remain extensible");
      assert.equal(schema.properties.extensions.additionalProperties, true);
      assert.equal(schema.properties.deliveryObservations, undefined);
      assert.equal(schema.required.includes("failureRecovery"), false);
      assert.equal(schema.required.includes("relationships"), false);
      assert.equal(schema.required.includes("extensions"), false);
    }
  }

  return { schemaVersion: "0.1.0", artifactCount: checked.length, instances: checked };
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  checkSchemaNursery()
    .then(({ schemaVersion, artifactCount }) => {
      console.log(`schema nursery check: passed (${artifactCount} artifact against ${schemaVersion})`);
    })
    .catch(error => {
      console.error(`schema nursery check: failed: ${error.message}`);
      process.exitCode = 1;
    });
}
