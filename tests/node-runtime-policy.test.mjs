import "../tools/node-runtime-guard.mjs";

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  NODE_RUNTIME_POLICY,
  NODE_RUNTIME_DEV_ENGINE,
  NodeRuntimeAdmissionError,
  assessNodeVersion,
  assertNodeRuntime,
  buildNodeRuntimeReceipt,
  inspectPackageRuntimeContracts,
  parseNodeCoordinate,
  parseNodeVersion,
} from "../tools/check-node-runtime.mjs";
import {
  inspectMjsClassification,
  splitShellSegments,
} from "../tools/check-node-entrypoints.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const versionOverridePath = resolve(
  repositoryRoot,
  "tests/fixtures/override-node-version.mjs",
);
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

test("the reusable assertion returns accepted evidence and throws typed remediation", () => {
  assert.equal(assertNodeRuntime({ version: "v24.22.1" }).code, "NODE_RUNTIME_ACCEPTED");
  assert.throws(
    () => assertNodeRuntime({ version: "v26.11.0" }),
    (error) =>
      error instanceof NodeRuntimeAdmissionError &&
      error.code === "NODE_SECURITY_FLOOR" &&
      /26\.12\.1\+/u.test(error.remediation),
  );
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
  assert.equal(result.checked, 12);
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

test("npm and npx enforce the shared runtime at run, install, and exec boundaries", async (context) => {
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

  for (const [command, args] of [
    [npm, ["--prefix", root, "run", "probe"]],
    [npm, ["--prefix", root, "ci", "--ignore-scripts"]],
    [npx, ["--prefix", root, "-c", "node --version"]],
  ]) {
    const result = spawnSync(command, args, { encoding: "utf8" });
    assert.notEqual(result.status, 0, args.join(" "));
    assert.match(`${result.stdout}\n${result.stderr}`, /EBADDEVENGINES/u, args.join(" "));
  }
});

test("copied skill and snippet packages retain local admission and runnable routes", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "node-runtime-portable-packages-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const packages = [
    {
      source: resolve(repositoryRoot, ".agents/skills/design-token-pipeline-stewardship"),
      destination: join(root, "skill"),
      script: "exercise",
      entrypoint: "exercises/exercise.mjs",
    },
    {
      source: resolve(
        repositoryRoot,
        "snippets/figma-variable-sync-reconciliation/0.1.0",
      ),
      destination: join(root, "snippet"),
      script: "test",
      entrypoint: "src/example.mjs",
      verifyPackageManagerAdmission: true,
    },
  ];

  for (const candidate of packages) {
    await cp(candidate.source, candidate.destination, { recursive: true });
    const accepted = spawnSync(
      npm,
      ["--prefix", candidate.destination, "run", candidate.script],
      { encoding: "utf8" },
    );
    assert.equal(accepted.status, 0, `${accepted.stdout}\n${accepted.stderr}`);

    const stale = spawnSync(
      process.execPath,
      [
        "--import",
        versionOverridePath,
        resolve(candidate.destination, candidate.entrypoint),
      ],
      {
        cwd: candidate.destination,
        encoding: "utf8",
        env: { ...process.env, NODE_RUNTIME_TEST_VERSION: "v26.11.0" },
      },
    );
    assert.notEqual(stale.status, 0);
    assert.match(
      stale.stderr,
      /Error \[NodeRuntimeAdmissionError\]: NODE_SECURITY_FLOOR/u,
    );

    if (candidate.verifyPackageManagerAdmission) {
      const staleEnvironment = {
        ...process.env,
        NODE_OPTIONS: `--import=${versionOverridePath}`,
        NODE_RUNTIME_TEST_VERSION: "v26.11.0",
      };
      for (const [command, args] of [
        [npm, ["--prefix", candidate.destination, "ci", "--ignore-scripts"]],
        [npx, ["--prefix", candidate.destination, "-c", "node --version"]],
      ]) {
        const result = spawnSync(command, args, {
          cwd: candidate.destination,
          encoding: "utf8",
          env: staleEnvironment,
        });
        assert.notEqual(result.status, 0, args.join(" "));
        assert.match(
          `${result.stdout}\n${result.stderr}`,
          /EBADDEVENGINES/u,
          args.join(" "),
        );
      }
    }
  }
});

test("every portable package retains an isolated runtime-admission closure", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "node-runtime-portable-closures-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const inventory = JSON.parse(
    await readFile(resolve(repositoryRoot, "tools/node-entrypoints.json"), "utf8"),
  );
  assert.equal(inventory.packageGuardedRoots.length, 11);

  let cliHelperCount = 0;
  const canonicalCliHelper = await readFile(
    resolve(repositoryRoot, "tools/portable-node-cli-entrypoint.mjs"),
  );
  for (const [index, packageRoot] of inventory.packageGuardedRoots.entries()) {
    const source = resolve(repositoryRoot, packageRoot);
    const destination = join(root, String(index));
    await mkdir(destination);
    for (const file of ["package.json", "package-lock.json", "node-runtime-admission.mjs"]) {
      await cp(resolve(source, file), resolve(destination, file));
    }
    try {
      const cliHelper = await readFile(resolve(source, "node-cli-entrypoint.mjs"));
      assert.equal(cliHelper.equals(canonicalCliHelper), true, packageRoot);
      await writeFile(resolve(destination, "node-cli-entrypoint.mjs"), cliHelper);
      cliHelperCount += 1;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    const accepted = spawnSync(
      process.execPath,
      [resolve(destination, "node-runtime-admission.mjs")],
      { cwd: destination, encoding: "utf8" },
    );
    assert.equal(accepted.status, 0, `${packageRoot}\n${accepted.stderr}`);

    const staleEnvironment = {
      ...process.env,
      NODE_OPTIONS: `--import=${versionOverridePath}`,
      NODE_RUNTIME_TEST_VERSION: "v26.11.0",
    };
    const staleDirect = spawnSync(
      process.execPath,
      [resolve(destination, "node-runtime-admission.mjs")],
      { cwd: destination, encoding: "utf8", env: staleEnvironment },
    );
    assert.notEqual(staleDirect.status, 0, packageRoot);
    assert.match(
      staleDirect.stderr,
      /Error \[NodeRuntimeAdmissionError\]: NODE_SECURITY_FLOOR/u,
      packageRoot,
    );

    for (const [command, args] of [
      [npm, ["--prefix", destination, "ci", "--ignore-scripts"]],
      [npx, ["--prefix", destination, "-c", "node --version"]],
    ]) {
      const result = spawnSync(command, args, {
        cwd: destination,
        encoding: "utf8",
        env: staleEnvironment,
      });
      assert.notEqual(result.status, 0, `${packageRoot}: ${args.join(" ")}`);
      assert.match(
        `${result.stdout}\n${result.stderr}`,
        /EBADDEVENGINES/u,
        `${packageRoot}: ${args.join(" ")}`,
      );
    }
  }
  assert.equal(cliHelperCount, 2);
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

test("direct and symbolic-link tool routes execute owned work and hold a stale coordinate", async (context) => {
  const toolPath = resolve(repositoryRoot, "tools/check-registry.mjs");
  const root = await mkdtemp(join(tmpdir(), "node-runtime-tool-link-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const link = join(root, "check-registry.mjs");
  if (process.platform !== "win32") await symlink(toolPath, link);
  const accepted = spawnSync(process.execPath, [toolPath], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /registry check: passed/u);

  if (process.platform !== "win32") {
    const acceptedLink = spawnSync(process.execPath, [link], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    assert.equal(acceptedLink.status, 0, acceptedLink.stderr);
    assert.equal(acceptedLink.stdout, accepted.stdout);
  }

  const stale = spawnSync(
    process.execPath,
    ["--import", versionOverridePath, toolPath],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...process.env, NODE_RUNTIME_TEST_VERSION: "v26.11.0" },
    },
  );
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /NodeRuntimeAdmissionError: NODE_SECURITY_FLOOR/u);
  assert.match(stale.stderr, /26\.12\.1\+/u);
  assert.doesNotMatch(stale.stdout, /registry check: passed/u);

  if (process.platform !== "win32") {
    const staleLink = spawnSync(
      process.execPath,
      ["--import", versionOverridePath, link],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: { ...process.env, NODE_RUNTIME_TEST_VERSION: "v26.11.0" },
      },
    );
    assert.notEqual(staleLink.status, 0);
    assert.match(staleLink.stderr, /NodeRuntimeAdmissionError: NODE_SECURITY_FLOOR/u);
    assert.doesNotMatch(staleLink.stdout, /registry check: passed/u);
  }
});

test("the diagnostic CLI retains its receipt when invoked through a symbolic link", async (context) => {
  if (process.platform === "win32") return;
  const root = await mkdtemp(join(tmpdir(), "node-runtime-diagnostic-link-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const link = join(root, "runtime-diagnostic.mjs");
  await symlink(resolve(repositoryRoot, "tools/check-node-runtime.mjs"), link);

  const result = spawnSync(
    process.execPath,
    ["--import", versionOverridePath, link],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...process.env, NODE_RUNTIME_TEST_VERSION: "v26.11.0" },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /"status": "requires_update"/u);
  assert.match(result.stdout, /"code": "NODE_SECURITY_FLOOR"/u);
  assert.match(result.stderr, /Remediation:.*26\.12\.1\+/u);
});

test("the static entrypoint inventory protects tools, tests, and public exercise routes", () => {
  const result = spawnSync(
    process.execPath,
    [resolve(repositoryRoot, "tools/check-node-entrypoints.mjs")],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Node entrypoint inspection: passed/u);
});

test("global entrypoint discovery returns root and portable routes to explicit classification", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "node-entrypoint-inventory-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const rootUnowned = resolve(root, "scripts/unowned-root.mjs");
  const packageUnowned = resolve(root, "portable/scripts/unowned-package.mjs");
  await mkdir(resolve(root, "scripts"), { recursive: true });
  await mkdir(resolve(root, "portable/scripts"), { recursive: true });
  await writeFile(rootUnowned, 'console.log("unowned root route");\n');
  await writeFile(packageUnowned, 'console.log("unowned package route");\n');
  const result = await inspectMjsClassification(root, []);
  assert.deepEqual(
    result.findings
      .filter(({ code }) => code === "NODE_GLOBAL_MJS_UNCLASSIFIED")
      .map(({ path }) => path)
      .sort(),
    [
      "portable/scripts/unowned-package.mjs",
      "scripts/unowned-root.mjs",
    ],
  );
});

test("the package-script parser observes each shell branch and preserves quoted operators", () => {
  assert.deepEqual(
    splitShellSegments(
      "node first.mjs || node second.mjs; node third.mjs | node fourth.mjs && node fifth.mjs",
    ),
    {
      segments: [
        "node first.mjs",
        "node second.mjs",
        "node third.mjs",
        "node fourth.mjs",
        "node fifth.mjs",
      ],
      supported: true,
    },
  );
  assert.deepEqual(splitShellSegments('node "quoted|target.mjs"'), {
    segments: ['node "quoted|target.mjs"'],
    supported: true,
  });
  assert.equal(splitShellSegments('node "unfinished.mjs').supported, false);
});
