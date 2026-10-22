import "../../tools/node-runtime-guard.mjs";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, win32 } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BETTERLEAKS_RELEASE,
  BetterleaksInstallError,
  betterleaksInstallDirectory,
  downloadAsset,
  releaseAsset,
  verifyBetterleaksInstall,
} from "../../tools/install-betterleaks.mjs";
import {
  SecretScanError,
  SecretScanFindingsError,
  assertSingleSuppressionSurface,
  executeSecretScan,
  generateSyntheticCanary,
  isPathWithin,
  materializeGitIndex,
  renderFindings,
  resolveArtifactTarget,
  runProcess,
  runSyntheticCanary,
} from "../../tools/scan-secret-material.mjs";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function errorCode(code) {
  return (error) => {
    assert.equal(error?.code, code);
    return true;
  };
}

test("maps every supported platform to an exact immutable release asset", () => {
  const expected = [
    "darwin-arm64",
    "darwin-x64",
    "linux-arm64",
    "linux-x64",
    "win32-arm64",
    "win32-x64",
  ];
  assert.deepEqual(Object.keys(BETTERLEAKS_RELEASE.assets), expected);
  for (const key of expected) {
    const [platform, arch] = key.split("-");
    const asset = releaseAsset(platform, arch);
    assert.equal(asset.key, key);
    assert.match(asset.name, /^betterleaks_1\.8\.1_/);
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    assert.match(asset.binarySha256, /^[a-f0-9]{64}$/);
  }
  assert.throws(
    () => releaseAsset("linux", "s390x"),
    errorCode("SECRET_SCANNER_PLATFORM_UNSUPPORTED"),
  );
});

test("bounds release downloads by response size and elapsed time", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "betterleaks-download-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const accepted = join(root, "accepted.bin");
  await downloadAsset("https://example.invalid/accepted", accepted, {
    fetchImpl: async () => new Response(Buffer.from("safe"), { status: 200 }),
    maxBytes: 4,
    timeoutMs: 1_000,
  });
  assert.equal(await readFile(accepted, "utf8"), "safe");

  await assert.rejects(
    downloadAsset("https://example.invalid/declared-large", join(root, "large.bin"), {
      fetchImpl: async () =>
        new Response(Buffer.from("large"), {
          status: 200,
          headers: { "content-length": "5" },
        }),
      maxBytes: 4,
      timeoutMs: 1_000,
    }),
    errorCode("SECRET_SCANNER_DOWNLOAD_SIZE"),
  );

  await assert.rejects(
    downloadAsset("https://example.invalid/streamed-large", join(root, "stream.bin"), {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: (async function* () {
          yield Buffer.from("large");
        })(),
      }),
      maxBytes: 4,
      timeoutMs: 1_000,
    }),
    errorCode("SECRET_SCANNER_DOWNLOAD_SIZE"),
  );

  await assert.rejects(
    downloadAsset("https://example.invalid/timeout", join(root, "timeout.bin"), {
      fetchImpl: async (_url, { signal }) =>
        await new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
      maxBytes: 4,
      timeoutMs: 5,
    }),
    errorCode("SECRET_SCANNER_DOWNLOAD_TIMEOUT"),
  );
});

test("verifies the locally installed executable against tracked release evidence", async (t) => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "betterleaks-install-test-"));
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }));
  const platform = "darwin";
  const arch = "arm64";
  const asset = releaseAsset(platform, arch);
  const installDirectory = betterleaksInstallDirectory({
    platform,
    arch,
    repositoryRoot,
  });
  const binaryPath = join(installDirectory, "betterleaks");
  const binary = Buffer.from("synthetic executable bytes\n");
  await mkdir(installDirectory, { recursive: true });
  await writeFile(binaryPath, binary);
  await writeFile(
    join(installDirectory, ".install-receipt.json"),
    JSON.stringify({
      format: BETTERLEAKS_RELEASE.receiptFormat,
      owner: BETTERLEAKS_RELEASE.owner,
      tool: BETTERLEAKS_RELEASE.tool,
      version: BETTERLEAKS_RELEASE.version,
      platform,
      arch,
      asset: asset.name,
      archiveSha256: asset.sha256,
      binarySha256: asset.binarySha256,
    }),
  );

  const verified = await verifyBetterleaksInstall({
    platform,
    arch,
    repositoryRoot,
    versionRunner: () => BETTERLEAKS_RELEASE.version,
    binaryDigestReader: async () => asset.binarySha256,
  });
  assert.equal(verified.binaryPath, binaryPath);
  assert.equal(verified.binarySha256, asset.binarySha256);

  await writeFile(binaryPath, "changed executable bytes\n");
  await assert.rejects(
    verifyBetterleaksInstall({
      platform,
      arch,
      repositoryRoot,
      versionRunner: () => BETTERLEAKS_RELEASE.version,
      binaryDigestReader: async (path) =>
        createHash("sha256").update(await readFile(path)).digest("hex"),
    }),
    errorCode("SECRET_SCANNER_INSTALL_INTEGRITY"),
  );
});

test("requires a regular non-symbolic install receipt", async (t) => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "betterleaks-receipt-test-"));
  const externalRoot = await mkdtemp(join(tmpdir(), "betterleaks-receipt-target-"));
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }));
  t.after(() => rm(externalRoot, { recursive: true, force: true }));
  const installDirectory = betterleaksInstallDirectory({
    platform: "darwin",
    arch: "arm64",
    repositoryRoot,
  });
  await mkdir(installDirectory, { recursive: true });
  const externalReceipt = join(externalRoot, "receipt.json");
  await writeFile(externalReceipt, "{}\n");
  try {
    await symlink(externalReceipt, join(installDirectory, ".install-receipt.json"), "file");
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("symbolic-link creation is unavailable on this platform");
      return;
    }
    throw error;
  }
  await assert.rejects(
    verifyBetterleaksInstall({
      platform: "darwin",
      arch: "arm64",
      repositoryRoot,
    }),
    errorCode("SECRET_SCANNER_INSTALL_RECEIPT"),
  );
});

test("rejects a scanner install path that crosses a symbolic-link parent", async (t) => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "betterleaks-parent-test-"));
  const external = await mkdtemp(join(tmpdir(), "betterleaks-parent-target-"));
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }));
  t.after(() => rm(external, { recursive: true, force: true }));
  try {
    await symlink(external, join(repositoryRoot, ".tools"), "dir");
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("symbolic-link creation is unavailable on this platform");
      return;
    }
    throw error;
  }
  await assert.rejects(
    verifyBetterleaksInstall({ repositoryRoot }),
    errorCode("SECRET_SCANNER_INSTALL_OWNERSHIP"),
  );
});

test("generates a non-live provider-shaped canary without retaining a fixture value", () => {
  const canary = generateSyntheticCanary(Buffer.alloc(36, 7));
  assert.match(canary, /^ghp_[A-Za-z0-9]{36}$/);
  assert.equal(canary.length, 40);
  assert.throws(
    () => generateSyntheticCanary(Buffer.alloc(35)),
    errorCode("SECRET_SCANNER_CANARY_SOURCE"),
  );
});

test("accepts redacted matches and emits only allowlisted finding metadata", async () => {
  const canary = generateSyntheticCanary(Buffer.alloc(36, 13));
  const finding = {
    RuleID: "github-pat",
    Secret: "REDACTED",
    Match: 'GITHUB_TOKEN="REDACTED"',
    StartLine: 17,
    Commit: "a".repeat(40),
    File: `${canary}.env`,
    Message: `candidate ${canary}`,
    Fingerprint: `github-pat:${canary}`,
    Attributes: { path: `${canary}.env`, git: { message: canary } },
  };
  const result = await executeSecretScan({
    binaryPath: "synthetic-scanner",
    scannerArguments: ["dir", "."],
    scope: "synthetic metadata",
    processRunner: async () => ({
      code: 10,
      signal: null,
      stdout: JSON.stringify([finding]),
      stderr: `scanner metadata ${canary}`,
    }),
  });
  assert.deepEqual(result.findings, [
    {
      ordinal: 1,
      rule: "github-pat",
      line: 17,
      commit: "a".repeat(12),
    },
  ]);
  assert.equal(JSON.stringify(result).includes(canary), false);
  const diagnostic = renderFindings(
    new SecretScanFindingsError("synthetic metadata", [
      {
        ...result.findings[0],
        File: `${canary}.env`,
        Message: canary,
        Attributes: { path: canary },
      },
    ]),
  );
  assert.equal(diagnostic.includes(canary), false);

  await assert.rejects(
    executeSecretScan({
      binaryPath: "synthetic-scanner",
      scannerArguments: ["dir", "."],
      scope: "unredacted synthetic metadata",
      processRunner: async () => ({
        code: 10,
        signal: null,
        stdout: JSON.stringify([{ ...finding, Secret: "unmasked-value" }]),
        stderr: "",
      }),
    }),
    errorCode("SECRET_SCANNER_REPORT_REDACTION"),
  );
  await assert.rejects(
    executeSecretScan({
      binaryPath: "synthetic-scanner",
      scannerArguments: ["dir", "."],
      scope: "invalid synthetic metadata",
      processRunner: async () => ({
        code: 10,
        signal: null,
        stdout: "not json",
        stderr: "",
      }),
    }),
    errorCode("SECRET_SCANNER_REPORT_INVALID"),
  );
});

test("requires the canary before exposing a sanitized receipt", async () => {
  let observedInput;
  const processRunner = async (_binary, _args, { input }) => {
    observedInput = input;
    return {
      code: 10,
      signal: null,
      stdout: JSON.stringify([
        {
          RuleID: "github-pat",
          Secret: "REDACTED",
          Match: 'GITHUB_TOKEN="REDACTED"',
        },
      ]),
      stderr: "one redacted finding",
    };
  };
  const canary = generateSyntheticCanary(Buffer.alloc(36, 11));
  const receipt = await runSyntheticCanary({
    binaryPath: "synthetic-scanner",
    processRunner,
    canary,
  });
  assert.deepEqual(receipt, {
    detected: true,
    redacted: true,
    rule: "github-pat",
  });
  assert.equal(observedInput.includes(canary), true);
});

test("rejects a transient canary carried in raw scanner output", async (t) => {
  const canary = generateSyntheticCanary(Buffer.alloc(36, 19));
  const redactedFinding = {
    RuleID: "github-pat",
    Secret: "REDACTED",
    Match: 'GITHUB_TOKEN="REDACTED"',
  };
  for (const channel of ["stdout", "stderr"]) {
    await t.test(channel, async () => {
      await assert.rejects(
        runSyntheticCanary({
          binaryPath: "synthetic-scanner",
          canary,
          processRunner: async () => ({
            code: 10,
            signal: null,
            stdout: JSON.stringify([
              channel === "stdout"
                ? { ...redactedFinding, Message: canary }
                : redactedFinding,
            ]),
            stderr: channel === "stderr" ? canary : "",
          }),
        }),
        errorCode("SECRET_SCANNER_TRANSCRIPT_DISCLOSURE"),
      );
    });
  }
});

test("rejects cross-drive containment results on Windows path grammar", () => {
  assert.equal(
    isPathWithin("C:\\repository", "D:\\outside", win32),
    false,
  );
  assert.equal(
    isPathWithin("C:\\repository", "C:\\repository\\artifact", win32),
    true,
  );
});

test("distinguishes scanner failure from a finding exit", async () => {
  await assert.rejects(
    executeSecretScan({
      binaryPath: "synthetic-scanner",
      scannerArguments: ["dir", "."],
      scope: "test scope",
      processRunner: async () => ({
        code: 2,
        signal: null,
        stdout: "",
        stderr: "diagnostics remain local",
      }),
    }),
    errorCode("SECRET_SCANNER_OPERATIONAL_FAILURE"),
  );
});

test("keeps provider validation off and requires complete redaction", async () => {
  let observedArguments;
  await executeSecretScan({
    binaryPath: "synthetic-scanner",
    scannerArguments: ["dir", "."],
    scope: "argument contract",
    processRunner: async (_binary, arguments_) => {
      observedArguments = arguments_;
      return { code: 0, signal: null, stdout: "[]", stderr: "" };
    },
  });
  assert.equal(observedArguments.includes("--validation=false"), true);
  assert.equal(observedArguments.includes("--redact=100"), true);
  assert.equal(observedArguments.includes("--ignore-gitleaks-allow"), true);
  const reportFormatIndex = observedArguments.indexOf("--report-format");
  assert.notEqual(reportFormatIndex, -1);
  assert.deepEqual(
    observedArguments.slice(reportFormatIndex, reportFormatIndex + 4),
    ["--report-format", "json", "--report-path", "-"],
  );
});

test("fails closed when an executable cannot start", async () => {
  await assert.rejects(
    runProcess(join(tmpdir(), "missing-betterleaks-executable"), []),
    errorCode("SECRET_SCANNER_PROCESS_START"),
  );
});

test("removes Git target overrides from the scanner child process", async () => {
  const keys = [
    "GIT_INDEX_FILE",
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  ];
  const prior = new Map(keys.map((key) => [key, process.env[key]]));
  const priorSyntheticCredential = process.env.BOUNDARY_SYNTHETIC_CREDENTIAL;
  for (const key of keys) process.env[key] = join(tmpdir(), `synthetic-${key}`);
  process.env.BOUNDARY_SYNTHETIC_CREDENTIAL = "synthetic-value-kept-from-child";
  try {
    const result = await runProcess(process.execPath, [
      "-e",
      `process.stdout.write(JSON.stringify({values:${JSON.stringify(keys)}.map((key) => process.env[key] ?? null), ambient:process.env.BOUNDARY_SYNTHETIC_CREDENTIAL ?? null, noReplace:process.env.GIT_NO_REPLACE_OBJECTS}))`,
    ]);
    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse(result.stdout), {
      values: keys.map(() => null),
      ambient: null,
      noReplace: "1",
    });
  } finally {
    for (const [key, value] of prior) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (priorSyntheticCredential === undefined) {
      delete process.env.BOUNDARY_SYNTHETIC_CREDENTIAL;
    } else {
      process.env.BOUNDARY_SYNTHETIC_CREDENTIAL = priorSyntheticCredential;
    }
  }
});

test("keeps named artifact scans inside the repository", async () => {
  assert.match(
    await resolveArtifactTarget("tests/public-boundary.test.mjs"),
    /tests\/public-boundary\.test\.mjs$/,
  );
  await assert.rejects(
    resolveArtifactTarget("../outside"),
    errorCode("SECRET_SCANNER_ARTIFACT_BOUNDARY"),
  );
  await assert.rejects(
    resolveArtifactTarget("."),
    errorCode("SECRET_SCANNER_ARTIFACT_BOUNDARY"),
  );
});

test("routes named cache and dependency artifacts to their resting boundary", async () => {
  const restingTargets = [
    ".git/config",
    ".tools/betterleaks",
    "node_modules/dependency",
    "snippet/.venv/candidate.env",
    "snippet/.ruff_cache/candidate.env",
    "snippet/__pycache__/candidate.pyc",
    ".artifacts/uv-cache/candidate.env",
  ];
  for (const target of restingTargets) {
    await assert.rejects(
      resolveArtifactTarget(target),
      errorCode("SECRET_SCANNER_ARTIFACT_RESTING"),
    );
  }
});

test("named artifact scans do not follow a parent symlink outside the repository", async (t) => {
  const fixture = await mkdtemp(join(REPOSITORY_ROOT, ".artifact-boundary-test-"));
  const external = await mkdtemp(join(tmpdir(), "betterleaks-artifact-target-"));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  t.after(() => rm(external, { recursive: true, force: true }));
  await writeFile(join(external, "candidate.txt"), "safe synthetic content\n");
  try {
    await symlink(external, join(fixture, "outside"), "dir");
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("symbolic-link creation is unavailable on this platform");
      return;
    }
    throw error;
  }

  await assert.rejects(
    resolveArtifactTarget(
      relative(REPOSITORY_ROOT, join(fixture, "outside", "candidate.txt")),
    ),
    errorCode("SECRET_SCANNER_ARTIFACT_BOUNDARY"),
  );
});

test("a candidate-shaped artifact path does not enter the command receipt", async (t) => {
  let installation;
  try {
    installation = await verifyBetterleaksInstall();
  } catch (error) {
    if (error instanceof BetterleaksInstallError) {
      t.skip("run `npm run security:secrets:install` for the Betterleaks integration case");
      return;
    }
    throw error;
  }
  assert.ok(installation.binaryPath);

  const canary = generateSyntheticCanary();
  const fixture = await mkdtemp(join(REPOSITORY_ROOT, `.artifact-${canary}-`));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  await writeFile(join(fixture, "safe.txt"), "safe synthetic content\n");
  const result = spawnSync(
    process.execPath,
    [
      join(REPOSITORY_ROOT, "tools", "scan-secret-material.mjs"),
      "artifact",
      relative(REPOSITORY_ROOT, fixture),
    ],
    { cwd: REPOSITORY_ROOT, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(`${result.stdout}${result.stderr}`.includes(canary), false);
  assert.match(result.stdout, /named repository artifact: clean\./);
});

test("the pinned scanner distinguishes each authored and resting path", async (t) => {
  let installation;
  try {
    installation = await verifyBetterleaksInstall();
  } catch (error) {
    if (error instanceof BetterleaksInstallError) {
      t.skip("run `npm run security:secrets:install` for the Betterleaks integration case");
      return;
    }
    throw error;
  }

  const cases = [
    { path: ".env", expectedFindings: 1 },
    { path: ".artifacts/pages/candidate.env", expectedFindings: 1 },
    { path: "node_modules/dependency/candidate.env", expectedFindings: 0 },
    { path: ".venv/candidate.env", expectedFindings: 0 },
    { path: "snippet/.ruff_cache/candidate.env", expectedFindings: 0 },
    { path: "snippet/__pycache__/candidate.env", expectedFindings: 0 },
    { path: ".artifacts/uv-cache/candidate.env", expectedFindings: 0 },
  ];

  for (const fixture of cases) {
    await t.test(fixture.path, async (caseTest) => {
      const root = await mkdtemp(join(tmpdir(), "betterleaks-prefilter-test-"));
      caseTest.after(() => rm(root, { recursive: true, force: true }));
      const canary = generateSyntheticCanary();
      await writeFile(join(root, ".gitignore"), ".env\n");
      const candidate = join(root, fixture.path);
      await mkdir(dirname(candidate), { recursive: true });
      await writeFile(candidate, `GITHUB_TOKEN="${canary}"\n`);

      const result = await executeSecretScan({
        binaryPath: installation.binaryPath,
        cwd: root,
        forbiddenValues: [canary],
        scannerArguments: ["dir", ".", "--isolate-rule", "github-pat"],
        scope: `Gist Registry prefilter fixture: ${fixture.path}`,
      });
      assert.equal(result.findings.length, fixture.expectedFindings);
      assert.equal(JSON.stringify(result).includes(canary), false);
    });
  }
});

test("keeps reviewed TOML filters as the single suppression surface", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "betterleaks-suppression-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "node_modules", "ignored-package"), { recursive: true });
  await writeFile(
    join(root, "node_modules", "ignored-package", ".gitleaksignore"),
    "dependency fixture\n",
  );
  await assert.doesNotReject(assertSingleSuppressionSurface(root));

  await mkdir(join(root, "nested"));
  await writeFile(join(root, "nested", ".betterleaksignore"), "candidate\n");
  await assert.rejects(
    assertSingleSuppressionSurface(root),
    errorCode("SECRET_SCANNER_SUPPRESSION_SURFACE"),
  );
});

test("rejects case-variant scanner ignore files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "betterleaks-case-ignore-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, ".GITLEAKSIGNORE"), "synthetic fingerprint\n");
  await assert.rejects(
    assertSingleSuppressionSurface(root),
    errorCode("SECRET_SCANNER_SUPPRESSION_SURFACE"),
  );
});

test("only the root tool cache receives the tool-directory resting boundary", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "betterleaks-tool-boundary-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".tools", "cache"), { recursive: true });
  await writeFile(
    join(root, ".tools", "cache", ".gitleaksignore"),
    "tool-owned fixture\n",
  );
  await assert.doesNotReject(assertSingleSuppressionSurface(root));

  await mkdir(join(root, "authored", ".tools"), { recursive: true });
  await writeFile(
    join(root, "authored", ".tools", ".gitleaksignore"),
    "authored fixture\n",
  );
  await assert.rejects(
    assertSingleSuppressionSurface(root),
    errorCode("SECRET_SCANNER_SUPPRESSION_SURFACE"),
  );
});

test("rests observed Python caches while keeping Pages output inspectable", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "betterleaks-python-cache-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const restingDirectories = [
    join(root, ".venv"),
    join(root, "snippet", ".ruff_cache"),
    join(root, "snippet", "__pycache__"),
    join(root, ".artifacts", "uv-cache"),
  ];
  for (const directory of restingDirectories) {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, ".gitleaksignore"), "dependency fixture\n");
  }
  await assert.doesNotReject(assertSingleSuppressionSurface(root));

  const pages = join(root, ".artifacts", "pages");
  await mkdir(pages, { recursive: true });
  await writeFile(join(pages, ".betterleaksignore"), "publication fixture\n");
  await assert.rejects(
    assertSingleSuppressionSurface(root),
    errorCode("SECRET_SCANNER_SUPPRESSION_SURFACE"),
  );
});

test("fails closed on symbolic-link and unreadable working-tree entries", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "betterleaks-tree-closure-test-"));
  const external = await mkdtemp(join(tmpdir(), "betterleaks-tree-external-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(external, { recursive: true, force: true }));
  await writeFile(join(external, "candidate.txt"), "safe synthetic content\n");
  try {
    await symlink(
      join(external, "candidate.txt"),
      join(root, "linked-candidate.txt"),
      "file",
    );
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("symbolic-link creation is unavailable on this platform");
      return;
    }
    throw error;
  }
  await assert.rejects(
    assertSingleSuppressionSurface(root),
    errorCode("SECRET_SCANNER_TREE_ENTRY_TYPE"),
  );
  await rm(join(root, "linked-candidate.txt"));

  if (process.platform === "win32" || process.getuid?.() === 0) return;
  const unreadable = join(root, "unreadable-candidate.txt");
  await writeFile(unreadable, "safe synthetic content\n");
  await chmod(unreadable, 0o000);
  t.after(() => chmod(unreadable, 0o600).catch(() => {}));
  await assert.rejects(
    assertSingleSuppressionSurface(root),
    errorCode("SECRET_SCANNER_TREE_CLOSURE"),
  );
});

test("staged-only suppression files are visible in the exact index snapshot", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "betterleaks-index-ignore-test-"));
  t.after(() => rm(repository, { recursive: true, force: true }));
  const git = (...args) =>
    spawnSync("git", args, { cwd: repository, encoding: "utf8" });
  assert.equal(git("init", "--quiet").status, 0);
  await writeFile(join(repository, ".betterleaksignore"), "synthetic path\n");
  assert.equal(git("add", ".betterleaksignore").status, 0);
  await rm(join(repository, ".betterleaksignore"));

  const snapshot = await materializeGitIndex(repository);
  t.after(() => rm(snapshot, { recursive: true, force: true }));
  await assert.rejects(
    assertSingleSuppressionSurface(snapshot),
    errorCode("SECRET_SCANNER_SUPPRESSION_SURFACE"),
  );
});

test("exact index materialization ignores an inherited alternate-index target", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "betterleaks-index-target-test-"));
  t.after(() => rm(repository, { recursive: true, force: true }));
  const git = (...args) =>
    spawnSync("git", args, { cwd: repository, encoding: "utf8" });
  assert.equal(git("init", "--quiet").status, 0);
  await writeFile(join(repository, "tracked.txt"), "safe tracked content\n");
  assert.equal(git("add", "tracked.txt").status, 0);

  const priorIndex = process.env.GIT_INDEX_FILE;
  process.env.GIT_INDEX_FILE = join(repository, "missing-alternate-index");
  let snapshot;
  try {
    snapshot = await materializeGitIndex(repository);
  } finally {
    if (priorIndex === undefined) delete process.env.GIT_INDEX_FILE;
    else process.env.GIT_INDEX_FILE = priorIndex;
  }
  t.after(() => rm(snapshot, { recursive: true, force: true }));
  assert.equal(await readFile(join(snapshot, "tracked.txt"), "utf8"), "safe tracked content\n");
});

test("the pinned scanner observes unchanged and skip-worktree index entries", async (t) => {
  let installation;
  try {
    installation = await verifyBetterleaksInstall();
  } catch (error) {
    if (error instanceof BetterleaksInstallError) {
      t.skip("run `npm run security:secrets:install` for the Betterleaks integration case");
      return;
    }
    throw error;
  }

  const repository = await mkdtemp(join(tmpdir(), "betterleaks-staged-test-"));
  t.after(() => rm(repository, { recursive: true, force: true }));
  const git = (...args) =>
    spawnSync("git", args, { cwd: repository, encoding: "utf8" });
  assert.equal(git("init", "--quiet").status, 0);
  assert.equal(git("config", "user.name", "Synthetic Canary").status, 0);
  assert.equal(git("config", "user.email", "canary@example.invalid").status, 0);

  const canary = generateSyntheticCanary();
  const fixture = join(repository, `${canary}.env`);
  await writeFile(fixture, `GITHUB_TOKEN="${canary}"\n`);
  assert.equal(git("add", `${canary}.env`).status, 0);
  assert.equal(git("commit", "--quiet", "-m", "synthetic baseline").status, 0);
  assert.equal(git("update-index", "--skip-worktree", `${canary}.env`).status, 0);
  await writeFile(join(repository, "candidate.txt"), "safe staged change\n");
  assert.equal(git("add", "candidate.txt").status, 0);
  await writeFile(fixture, "GITHUB_TOKEN=provided-at-runtime\n");

  const snapshot = await materializeGitIndex(repository);
  t.after(() => rm(snapshot, { recursive: true, force: true }));
  assert.equal(
    (await readFile(join(snapshot, `${canary}.env`), "utf8")).includes(canary),
    true,
  );
  const result = await executeSecretScan({
    binaryPath: installation.binaryPath,
    cwd: snapshot,
    scannerArguments: ["dir", ".", "--isolate-rule", "github-pat"],
    scope: "exact staged index fixture",
  });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].rule, "github-pat");
  assert.equal(JSON.stringify(result).includes(canary), false);
});

test("raw index materialization does not execute configured smudge filters", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "betterleaks-filter-test-"));
  t.after(() => rm(repository, { recursive: true, force: true }));
  const git = (...args) =>
    spawnSync("git", args, { cwd: repository, encoding: "utf8" });
  assert.equal(git("init", "--quiet").status, 0);
  assert.equal(git("config", "user.name", "Synthetic Canary").status, 0);
  assert.equal(git("config", "user.email", "canary@example.invalid").status, 0);

  const marker = join(repository, "smudge-was-called");
  const filterScript = join(repository, "smudge-filter.mjs");
  await writeFile(
    filterScript,
    `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "called\\n");\nprocess.stdin.pipe(process.stdout);\n`,
  );
  assert.equal(
    git("config", "filter.boundary.smudge", `node "${filterScript}"`).status,
    0,
  );
  await writeFile(join(repository, ".gitattributes"), "*.env filter=boundary\n");
  const canary = generateSyntheticCanary();
  await writeFile(join(repository, "retained.env"), `GITHUB_TOKEN="${canary}"\n`);
  assert.equal(git("add", ".gitattributes", "retained.env").status, 0);

  const snapshot = await materializeGitIndex(repository);
  t.after(() => rm(snapshot, { recursive: true, force: true }));
  assert.equal(
    (await readFile(join(snapshot, "retained.env"), "utf8")).includes(canary),
    true,
  );
  await assert.rejects(readFile(marker), (error) => error?.code === "ENOENT");
});

test("the all-ref history options observe a secret introduced by merge resolution", async (t) => {
  let installation;
  try {
    installation = await verifyBetterleaksInstall();
  } catch (error) {
    if (error instanceof BetterleaksInstallError) {
      t.skip("run `npm run security:secrets:install` for the Betterleaks integration case");
      return;
    }
    throw error;
  }

  const repository = await mkdtemp(join(tmpdir(), "betterleaks-merge-test-"));
  t.after(() => rm(repository, { recursive: true, force: true }));
  const git = (...args) =>
    spawnSync("git", args, { cwd: repository, encoding: "utf8" });
  assert.equal(git("init", "--quiet").status, 0);
  assert.equal(git("config", "user.name", "Synthetic Canary").status, 0);
  assert.equal(git("config", "user.email", "canary@example.invalid").status, 0);

  const fixture = join(repository, "merge.env");
  await writeFile(fixture, "VALUE=base\n");
  assert.equal(git("add", "merge.env").status, 0);
  assert.equal(git("commit", "--quiet", "-m", "base").status, 0);
  const primary = git("branch", "--show-current").stdout.trim();

  assert.equal(git("checkout", "--quiet", "-b", "fixture-branch").status, 0);
  await writeFile(fixture, "VALUE=feature\n");
  assert.equal(git("commit", "--quiet", "-am", "feature").status, 0);
  assert.equal(git("checkout", "--quiet", primary).status, 0);
  await writeFile(fixture, "VALUE=primary\n");
  assert.equal(git("commit", "--quiet", "-am", "primary").status, 0);
  assert.equal(git("merge", "--no-edit", "fixture-branch").status, 1);

  const canary = generateSyntheticCanary();
  await writeFile(fixture, `GITHUB_TOKEN="${canary}"\n`);
  assert.equal(git("add", "merge.env").status, 0);
  assert.equal(
    git("commit", "--quiet", "-m", `merge resolution ${canary}`).status,
    0,
  );
  await writeFile(fixture, "GITHUB_TOKEN=provided-at-runtime\n");
  assert.equal(git("commit", "--quiet", "-am", "remove synthetic canary").status, 0);

  const result = await executeSecretScan({
    binaryPath: installation.binaryPath,
    scannerArguments: [
      "git",
      repository,
      "--log-opts=--all --full-history --diff-merges=separate --diff-filter=tuxdb",
      "--isolate-rule",
      "github-pat",
    ],
    scope: "merge-only history fixture",
  });
  assert.equal(result.findings.some((finding) => finding.rule === "github-pat"), true);
  assert.equal(JSON.stringify(result).includes(canary), false);
});

test("history mode observes a secret reachable only from a non-current local ref", async (t) => {
  let installation;
  try {
    installation = await verifyBetterleaksInstall();
  } catch (error) {
    if (error instanceof BetterleaksInstallError) {
      t.skip("run `npm run security:secrets:install` for the Betterleaks integration case");
      return;
    }
    throw error;
  }

  const repository = await mkdtemp(join(tmpdir(), "betterleaks-all-ref-test-"));
  t.after(() => rm(repository, { recursive: true, force: true }));
  const git = (...args) =>
    spawnSync("git", args, { cwd: repository, encoding: "utf8" });
  assert.equal(git("init", "--quiet").status, 0);
  assert.equal(git("config", "user.name", "Synthetic Canary").status, 0);
  assert.equal(git("config", "user.email", "canary@example.invalid").status, 0);
  await writeFile(join(repository, "baseline.txt"), "safe baseline\n");
  assert.equal(git("add", "baseline.txt").status, 0);
  assert.equal(git("commit", "--quiet", "-m", "baseline").status, 0);
  const primary = git("branch", "--show-current").stdout.trim();

  assert.equal(git("checkout", "--quiet", "-b", "non-current-ref").status, 0);
  const canary = generateSyntheticCanary();
  await writeFile(join(repository, "ref-only.env"), `GITHUB_TOKEN="${canary}"\n`);
  assert.equal(git("add", "ref-only.env").status, 0);
  assert.equal(git("commit", "--quiet", "-m", "ref-only candidate").status, 0);
  assert.equal(git("checkout", "--quiet", primary).status, 0);

  const result = await executeSecretScan({
    binaryPath: installation.binaryPath,
    scannerArguments: [
      "git",
      repository,
      "--log-opts=--all --full-history --diff-merges=separate --diff-filter=tuxdb",
      "--isolate-rule",
      "github-pat",
    ],
    scope: "non-current ref history fixture",
  });
  assert.equal(result.findings.some((finding) => finding.rule === "github-pat"), true);
  assert.equal(JSON.stringify(result).includes(canary), false);
});
