import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { checkReadmeRoutes } from "../tools/check-readme-routes.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

test("the layered README graph covers every registered artifact family", async () => {
  const result = await checkReadmeRoutes({ root: repositoryRoot });
  assert.equal(result.familyCount, 13);
  assert.equal(result.exactVersionCount, 15);
  assert.ok(result.readmeCount >= 25);
  assert.ok(result.localLinkCount >= 100);
});
