import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  checkDeliveryObservations,
  parseMediaType,
  validateDeliveryObservationEvidence,
  validateDeliveryObservationRecord,
  validateDeliveryObservationSemantics,
} from "../tools/check-delivery-observations.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const schemaPath = resolve(
  repositoryRoot,
  "schemas/delivery-observation/0.1.0/delivery-observation.schema.json",
);
const recordPath = resolve(
  repositoryRoot,
  "observations/delivery/records/schema-registry-artifact-0.1.0-20260830t052206z.json",
);

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function realContract() {
  const [schema, record] = await Promise.all([json(schemaPath), json(recordPath)]);
  return { schema, record };
}

test("the real observation binds accepted source, docs projection, and signed-out response", async () => {
  const result = await checkDeliveryObservations({ root: repositoryRoot });
  assert.equal(result.schemaVersion, "0.1.0");
  assert.equal(result.observationCount, 1);
  assert.equal(result.records[0].value.resultStanding, "matches_named_sources");
  assert.equal(
    result.records[0].value.subject.canonicalId,
    "https://kindlight.io/schemas/gist-registry/0.1.0/registry-artifact.schema.json",
  );
});

test("media-type parsing retains quoted values and normalizes names and charset", () => {
  assert.deepEqual(
    parseMediaType('Application/JSON; profile="a;b"; Charset="UTF-8"'),
    {
      type: "application",
      subtype: "json",
      parameters: {
        charset: "utf-8",
        profile: "a;b",
      },
    },
  );
  assert.throws(
    () => parseMediaType("application/json; charset=utf-8; CHARSET=utf-8"),
    /parameter charset must appear once/u,
  );
  assert.throws(
    () => parseMediaType("application/json;\tcharset=utf-8"),
    /must not contain control characters/u,
  );
});

test("repository evidence rejects a digest that does not identify the named source", async () => {
  const { record } = await realContract();
  record.source.sha256 = "0".repeat(64);
  await assert.rejects(
    validateDeliveryObservationEvidence({ root: repositoryRoot, record }),
    /working source digest must match the observation/u,
  );
});

test("normalized media type is derived from the observed raw Content-Type", async () => {
  const { record } = await realContract();
  record.response.normalizedMediaType.subtype = "schema+json";
  assert.throws(
    () => validateDeliveryObservationSemantics(record),
    /normalized media type must follow from raw Content-Type/u,
  );
});

test("the canonical request remains query-free and path-exact", async () => {
  const { record } = await realContract();
  record.request.url += "?view=raw";
  assert.throws(
    () => validateDeliveryObservationSemantics(record),
    /request must use the exact canonical schema URL/u,
  );
});

test("the schema requires the accepted source revision that makes evidence recoverable", async () => {
  const { schema, record } = await realContract();
  delete record.source.acceptedRevision;
  assert.throws(
    () => validateDeliveryObservationRecord(schema, record),
    /delivery observation does not satisfy.*required property 'acceptedRevision'/u,
  );
});
