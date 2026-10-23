import "../tools/node-runtime-guard.mjs";

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  requireRevisionOnBranch,
  checkDeliveryObservations,
  parseMediaType,
  validateDeliveryObservationEvidence,
  validateDeliveryObservationRecord,
  validateDeliveryObservationSemantics,
} from "../tools/check-delivery-observations.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const execFileAsync = promisify(execFile);
const runGit = async (root, args, options = {}) => {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });
  return stdout;
};
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

async function createRemoteOnlyMainCheckout() {
  const root = await mkdtemp(join(tmpdir(), "delivery-observation-check-"));
  await runGit(root, ["init", "-b", "main"]);
  await runGit(root, ["config", "user.email", "delivery-observations@example.invalid"]);
  await runGit(root, ["config", "user.name", "Delivery Observations Test"]);

  const fixture = resolve(root, "payload.txt");
  await writeFile(fixture, "observed bytes\n");
  await runGit(root, ["add", "payload.txt"]);
  await runGit(root, ["commit", "-m", "seed commit"]);
  const acceptedRevision = (await runGit(root, ["rev-parse", "HEAD"])).trim();

  await runGit(root, ["switch", "-c", "runner"]);
  await runGit(root, ["update-ref", "refs/remotes/origin/main", acceptedRevision]);
  await runGit(root, ["branch", "-D", "main"]);

  return { root, acceptedRevision };
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

test("the ancestry check resolves origin-tracking when local branch refs are absent", async () => {
  const fixture = await createRemoteOnlyMainCheckout();
  try {
    await requireRevisionOnBranch(
      fixture.root,
      fixture.acceptedRevision,
      "main",
      "accepted source revision",
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("the schema requires the accepted source revision that makes evidence recoverable", async () => {
  const { schema, record } = await realContract();
  delete record.source.acceptedRevision;
  assert.throws(
    () => validateDeliveryObservationRecord(schema, record),
    /delivery observation does not satisfy.*required property 'acceptedRevision'/u,
  );
});
