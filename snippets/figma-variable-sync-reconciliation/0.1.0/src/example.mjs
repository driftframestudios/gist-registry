import { readFile } from "node:fs/promises";

import { canonicalJson } from "./canonical.mjs";
import { synchronizeVariables } from "./coordinator.mjs";
import { FakeVariableRemote } from "./fake-remote.mjs";
import { InMemoryCheckpointStore, InMemoryLeaseStore } from "./stores.mjs";

const fixtureUrl = new URL("../fixtures/accepted-sync.json", import.meta.url);
const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
let nowMs = fixture.clockStartMs;
const remote = new FakeVariableRemote(fixture.remote);

const receipt = await synchronizeVariables({
  runId: fixture.runId,
  owner: fixture.owner,
  operations: fixture.operations,
  remote,
  leaseStore: new InMemoryLeaseStore(),
  checkpointStore: new InMemoryCheckpointStore(),
  maxBatchBytes: fixture.maxBatchBytes,
  clock: { now: () => nowMs },
  sleep: async (durationMs) => {
    nowMs += durationMs;
  },
});

process.stdout.write(canonicalJson(receipt));
