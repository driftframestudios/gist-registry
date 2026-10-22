import "../node-runtime-admission.mjs";

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, devNull } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const exercise = resolve(dirname(fileURLToPath(import.meta.url)), "exercise.mjs");
const environment = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/iu.test(name))),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: devNull,
};

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], {
    env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    timeout: 15000,
  }).trim();
}

function fixture(t, scanner = "export const accepted = true;\n") {
  const root = mkdtempSync(join(tmpdir(), "skill-source-identity-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "tools"));
  writeFileSync(join(root, "tools/scan-secret-material.mjs"), scanner);
  writeFileSync(join(root, "tools/install-betterleaks.mjs"), "export const accepted = true;\n");
  writeFileSync(join(root, ".betterleaks.toml"), 'title = "synthetic receiver"\n');
  git(root, "init", "--initial-branch=main");
  git(root, "config", "user.name", "Synthetic Receiver");
  git(root, "config", "user.email", "synthetic@example.invalid");
  git(root, "config", "commit.gpgSign", "false");
  git(root, "add", ".");
  git(root, "commit", "-m", "accepted synthetic source");
  return { root, revision: git(root, "rev-parse", "HEAD"), marker: join(root, "import-marker") };
}

const markImport = 'import { writeFileSync } from "node:fs"; writeFileSync(process.env.SYNTHETIC_SOURCE_IMPORT_MARKER, "imported");\n';

function invoke({ root, revision, marker }, extraEnvironment = {}) {
  const result = spawnSync(process.execPath, [exercise, "--receiver", root, "--revision", revision], {
    env: { ...environment, ...extraEnvironment, SYNTHETIC_SOURCE_IMPORT_MARKER: marker },
    encoding: "utf8", timeout: 15000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(result.stdout.includes("PASS"), false);
  assert.match(result.stderr, /held during native receiver; no acceptance receipt was issued/u);
  return result;
}

test("replacement objects cannot admit different module bytes under the accepted SHA", t => {
  const selected = fixture(t);
  writeFileSync(join(selected.root, "tools/scan-secret-material.mjs"), markImport);
  git(selected.root, "add", "tools/scan-secret-material.mjs");
  git(selected.root, "commit", "-m", "synthetic replacement source");
  const replacement = git(selected.root, "rev-parse", "HEAD");
  git(selected.root, "replace", selected.revision, replacement);
  git(selected.root, "update-ref", "refs/heads/main", selected.revision);
  // The contrast demonstrates that ordinary Git lookup would supply the substitute.
  assert.equal(git(selected.root, "show", `${selected.revision}:tools/scan-secret-material.mjs`), markImport.trim());
  invoke(selected);
  assert.equal(existsSync(selected.marker), false, "source rejection precedes module import");
});

test("missing promisor bytes stay unavailable until an explicitly separate hydration", t => {
  const selected = fixture(t, markImport);
  const remote = mkdtempSync(join(tmpdir(), "skill-source-remote-"));
  t.after(() => rmSync(remote, { recursive: true, force: true }));
  git(remote, "clone", "--bare", "--no-local", selected.root, "origin.git");
  const origin = join(remote, "origin.git");
  git(origin, "config", "uploadpack.allowAnySHA1InWant", "true");
  git(origin, "config", "uploadpack.allowFilter", "true");
  git(selected.root, "remote", "add", "origin", pathToFileURL(origin).href);
  git(selected.root, "config", "remote.origin.promisor", "true");
  git(selected.root, "config", "remote.origin.partialclonefilter", "blob:none");
  git(selected.root, "config", "core.repositoryformatversion", "1");
  git(selected.root, "config", "extensions.partialClone", "origin");
  const blob = git(selected.root, "rev-parse", `${selected.revision}:tools/scan-secret-material.mjs`);
  const object = join(selected.root, ".git", "objects", blob.slice(0, 2), blob.slice(2));
  assert.equal(existsSync(object), true, "the fixture starts with an owned loose blob");
  rmSync(object);
  invoke(selected);
  assert.equal(existsSync(selected.marker), false);
  const absent = spawnSync("git", ["--no-lazy-fetch", "-C", selected.root, "cat-file", "-e", blob], {
    env: environment, stdio: "pipe", timeout: 15000,
  });
  assert.equal(absent.error, undefined);
  assert.notEqual(absent.status, 0, "inspection did not acquire the missing object");
  // This local file-transport contrast proves the fixture can actually hydrate.
  // It executes only after the protected invocation's unavailable state is checked.
  assert.equal(git(selected.root, "show", `${selected.revision}:tools/scan-secret-material.mjs`), markImport.trim());
  assert.equal(git(selected.root, "--no-lazy-fetch", "cat-file", "-t", blob), "blob");
  assert.equal(readFileSync(join(selected.root, "tools/scan-secret-material.mjs"), "utf8"), markImport);
});

test("ambient Git directory and worktree cannot substitute for the explicit receiver", t => {
  const selected = fixture(t, markImport);
  const other = fixture(t);
  invoke(selected, { GIT_DIR: join(other.root, ".git"), GIT_WORK_TREE: other.root });
  assert.equal(readFileSync(selected.marker, "utf8"), "imported", "the verified explicit receiver reached import");
  assert.equal(existsSync(other.marker), false);
  // The minimal fixture intentionally lacks native scanner APIs, so invocation
  // holds after this source/import observation and emits no acceptance receipt.
});
