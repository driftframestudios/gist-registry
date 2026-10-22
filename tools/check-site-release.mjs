import "./node-runtime-guard.mjs";

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { buildPages, checkProjection } from "./build-pages.mjs";
import { isDirectNodeInvocation } from "./node-cli-entrypoint.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// Identity is checked before a candidate can enter the publication route.
// Fetching the remote, granting publication and moving docs remain operator actions.
export function verifySiteIdentity({ root, tag, manifest }) {
  assert.match(tag ?? "", /^site\/v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u,
    "site release requires an exact site/vMAJOR.MINOR.PATCH tag");
  assert.equal(git(root, "status", "--porcelain", "--untracked-files=all"), "", "source worktree must be clean");
  const revision = git(root, "rev-parse", "HEAD");
  assert.equal(git(root, "rev-parse", "refs/remotes/origin/main"), revision,
    "source HEAD must equal freshly fetched origin/main");
  assert.equal(git(root, "cat-file", "-t", "refs/tags/" + tag), "tag",
    "site release identity must be an annotated tag");
  assert.equal(git(root, "rev-parse", "refs/tags/" + tag + "^{commit}"), revision,
    "site release tag must identify the accepted source HEAD");
  assert.equal(manifest.sourceStanding, "accepted_revision", "release requires accepted source standing");
  assert.equal(manifest.sourceRevision, revision, "projection must bind the tagged source revision");
  assert.equal(manifest.projectionOwner, "gist-registry-pages-builder", "projection owner must be the accepted builder");
  return { tag, sourceRevision: revision };
}

export async function checkSiteRelease({ root = repositoryRoot, output = resolve(root, ".artifacts/pages"), tag }) {
  const candidateBytes = await readFile(resolve(output, "projection-manifest.json"));
  const identity = verifySiteIdentity({ root, tag, manifest: JSON.parse(candidateBytes) });
  const checked = await checkProjection({ root, output });
  const temporary = await mkdtemp(join(tmpdir(), "gist-site-release-"));
  try {
    const fresh = resolve(temporary, "pages");
    await buildPages({ root, output: fresh, sourceSha: identity.sourceRevision });
    assert.deepEqual(candidateBytes, await readFile(resolve(fresh, "projection-manifest.json")),
      "release candidate must equal a fresh accepted-source build");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return { ...identity, ...checked, standing: "ready_for_authorized_docs_promotion" };
}

if (isDirectNodeInvocation(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { tag: { type: "string" }, output: { type: "string" } } });
    console.log(JSON.stringify(await checkSiteRelease({ tag: values.tag, output: values.output }), null, 2));
  } catch (error) {
    // Git diagnostics and local paths stay with the local operator.
    console.error("Site release gate held: " + (error instanceof assert.AssertionError ? error.message : "required release input could not be read or validated"));
    process.exitCode = 1;
  }
}
