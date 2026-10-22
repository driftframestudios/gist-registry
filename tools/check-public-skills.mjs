import "./node-runtime-guard.mjs";

import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { loadPublicSkills } from "./public-skills.mjs";
import { isDirectNodeInvocation } from "./node-cli-entrypoint.mjs";

const execFileAsync = promisify(execFile);
const modulePath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(modulePath), "..");

export async function checkPublicSkills({ root = repositoryRoot } = {}) {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  const model = await loadPublicSkills({ root, sourceSha: stdout.trim() });
  return {
    publicReadyCount: model.publicReady.length,
    classifiedCount: model.publicReady.length + model.withheldNames.length,
  };
}
if (isDirectNodeInvocation(import.meta.url)) {
  checkPublicSkills()
    .then(result => {
      console.log(
        "public skills check: passed (" +
          result.publicReadyCount +
          " public-ready; " +
          result.classifiedCount +
          " classified)",
      );
    })
    .catch(error => {
      console.error("public skills check: failed: " + error.message);
      process.exitCode = 1;
    });
}
