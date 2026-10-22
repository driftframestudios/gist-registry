import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  NODE_RUNTIME_POLICY,
  NODE_RUNTIME_DEV_ENGINE,
  assessNodeVersion,
  buildNodeRuntimeReceipt,
  inspectPackageRuntimeContracts,
  parseNodeCoordinate,
  parseNodeVersion,
} from "../tools/check-node-runtime.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const acceptedVersions = ["v22.23.4", "22.99.0", "v24.22.1", "24.30.0", "v26.12.1", "26.99.0"];
const earlierVersions = ["v22.0.0", "22.23.3", "v24.0.0", "24.22.0", "v26.0.0", "26.12.0"];

test("the runtime policy accepts every first-fixed coordinate and later patches in its line", () => {
  for (const version of acceptedVersions) {
    assert.equal(assessNodeVersion(version).accepted, true, version);
  }
});

test("the runtime policy classifies each earlier advisory coordinate with upgrade guidance", () => {
  for (const version of earlierVersions) {
    const result = assessNodeVersion(version);
    assert.equal(result.accepted, false, version);
    assert.equal(result.code, "NODE_SECURITY_FLOOR", version);
    assert.match(result.remediation, /22\.23\.4\+.*24\.22\.1\+.*26\.12\.1\+/u);
  }
});

test("the runtime policy classifies neighboring majors and prereleases explicitly", () => {
  for (const version of ["v23.0.0", "v25.0.0", "v27.0.0"])
    assert.equal(assessNodeVersion(version).code, "NODE_MAJOR_OUTSIDE_POLICY", version);
  assert.equal(
    assessNodeVersion("v24.22.1-rc.1").code,
    "NODE_PRERELEASE_OUTSIDE_POLICY",
  );
  assert.equal(
    assessNodeVersion("v24.22.1-rc.1+vendor.2").code,
    "NODE_PRERELEASE_OUTSIDE_POLICY",
  );
  assert.equal(assessNodeVersion("v24.22.1+vendor.1").code, "NODE_RUNTIME_ACCEPTED");
  assert.deepEqual(parseNodeVersion("v24.22.1"), [24, 22, 1]);
  assert.deepEqual(parseNodeVersion("v24.22.1+vendor.1"), [24, 22, 1]);
  assert.deepEqual(parseNodeCoordinate("v24.22.1-rc.1+vendor.2"), {
    version: [24, 22, 1],
    prerelease: "rc.1",
    build: "vendor.2",
  });
});

test("local and CI selectors name the reviewed first-fixed coordinates", async () => {
  assert.equal(await readFile(resolve(repositoryRoot, ".nvmrc"), "utf8"), "24.22.1\n");
  assert.equal(await readFile(resolve(repositoryRoot, ".npmrc"), "utf8"), "engine-strict=true\n");

  const registryWorkflow = await readFile(
    resolve(repositoryRoot, ".github/workflows/registry-checks.yml"),
    "utf8",
  );
  const secretWorkflow = await readFile(
    resolve(repositoryRoot, ".github/workflows/secret-material.yml"),
    "utf8",
  );
  assert.match(registryWorkflow, /node-version: "22\.23\.4"/u);
  assert.match(registryWorkflow, /node-version: \["24\.22\.1", "26\.12\.1"\]/u);
  assert.match(registryWorkflow, /run: node tools\/check-node-runtime\.mjs/u);
  assert.match(registryWorkflow, /run: npm run test:node-owned/u);
  assert.match(secretWorkflow, /node-version: "22\.23\.4"/u);
  assert.match(secretWorkflow, /run: node tools\/check-node-runtime\.mjs/u);
});

test("the repository package and lock contracts share the accepted range", async () => {
  const result = await inspectPackageRuntimeContracts();
  assert.equal(result.checked, 7);
  assert.deepEqual(result.findings, []);
});

test("package-contract diagnostics identify the responsible manifest and lock", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "node-runtime-policy-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "nested"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "root",
      engines: { node: NODE_RUNTIME_POLICY.engineRange },
      devEngines: { runtime: NODE_RUNTIME_DEV_ENGINE },
    }),
  );
  await writeFile(
    join(root, "package-lock.json"),
    JSON.stringify({
      packages: {
        "": {
          engines: { node: NODE_RUNTIME_POLICY.engineRange },
        },
      },
    }),
  );
  await writeFile(
    join(root, "nested", "package.json"),
    JSON.stringify({
      name: "nested",
      engines: { node: ">=22" },
      devEngines: { runtime: { ...NODE_RUNTIME_DEV_ENGINE, version: ">=22" } },
    }),
  );
  await writeFile(
    join(root, "nested", "package-lock.json"),
    JSON.stringify({
      packages: {
        "": {
          engines: { node: ">=22" },
        },
      },
    }),
  );

  const result = await inspectPackageRuntimeContracts(root);
  assert.deepEqual(
    result.findings.map(({ code, path }) => ({ code, path })),
    [
      { code: "NODE_ENGINE_RANGE_DRIFT", path: "nested/package.json" },
      { code: "NODE_DEV_ENGINE_DRIFT", path: "nested/package.json" },
      { code: "NODE_LOCK_ENGINE_RANGE_DRIFT", path: "nested/package-lock.json" },
    ],
  );
});

test("npm enforces the shared development runtime at run and ignore-scripts install boundaries", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "node-runtime-dev-engine-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const rejectedRuntime = {
    name: "node",
    version: ">=999.0.0",
    onFail: "error",
  };
  const manifest = {
    name: "runtime-admission-probe",
    version: "0.0.0",
    private: true,
    scripts: { probe: "node --version" },
    devEngines: { runtime: rejectedRuntime },
  };
  await writeFile(join(root, "package.json"), JSON.stringify(manifest));
  await writeFile(
    join(root, "package-lock.json"),
    JSON.stringify({
      name: manifest.name,
      version: manifest.version,
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": {
          name: manifest.name,
          version: manifest.version,
        },
      },
    }),
  );

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  for (const args of [
    ["--prefix", root, "run", "probe"],
    ["--prefix", root, "ci", "--ignore-scripts"],
  ]) {
    const result = spawnSync(npm, args, { encoding: "utf8" });
    assert.notEqual(result.status, 0, args.join(" "));
    assert.match(`${result.stdout}\n${result.stderr}`, /EBADDEVENGINES/u, args.join(" "));
  }
});

test("the runtime receipt keeps Node-core evidence distinct from package-contract evidence", async () => {
  const receipt = await buildNodeRuntimeReceipt({
    version: "v24.22.1",
    versions: {
      node: "24.22.1",
      modules: "137",
      openssl: "3.5.4",
      zlib: "1.3.1",
      brotli: "1.1.0",
    },
  });
  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.runtime.code, "NODE_RUNTIME_ACCEPTED");
  assert.equal(receipt.packageContracts.status, "aligned");
  assert.equal(Object.hasOwn(receipt, "npmAudit"), false);
});
