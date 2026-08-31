import { createHash, randomBytes } from "node:crypto";
import { constants as filesystemConstants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  BetterleaksInstallError,
  verifyBetterleaksInstall,
} from "./install-betterleaks.mjs";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = resolve(REPOSITORY_ROOT, ".betterleaks.toml");
const FINDINGS_EXIT_CODE = 10;
const MAX_CAPTURE_BYTES = 16 * 1024 * 1024;
const CANARY_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const SCANNER_IGNORE_FILENAMES = new Set([
  ".betterleaksignore",
  ".gitleaksignore",
]);
const RESTING_DEPENDENCY_DIRECTORY_NAMES = new Set([
  "node_modules",
  ".venv",
  ".ruff_cache",
  "__pycache__",
]);
const GIT_TARGET_ENVIRONMENT_KEYS = new Set([
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_CONFIG",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_DIR",
  "GIT_EXEC_PATH",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NAMESPACE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_REPLACE_REF_BASE",
  "GIT_SHALLOW_FILE",
  "GIT_WORK_TREE",
]);
const CHILD_ENVIRONMENT_KEYS = [
  "COMSPEC",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "TZ",
  "USERPROFILE",
  "WINDIR",
  "XDG_CONFIG_HOME",
];

export class SecretScanError extends Error {
  constructor(code, message, options) {
    super(`${code}: ${message}`, options);
    this.name = "SecretScanError";
    this.code = code;
  }
}

export class SecretScanFindingsError extends SecretScanError {
  constructor(scope, findings) {
    super(
      "SECRET_SCAN_FINDINGS",
      `${scope} contains ${findings.length} unresolved secret-shaped candidate${findings.length === 1 ? "" : "s"}`,
    );
    this.name = "SecretScanFindingsError";
    this.scope = scope;
    this.findings = findings;
  }
}

export function isPathWithin(
  parent,
  candidate,
  pathFunctions = { isAbsolute, relative, sep },
) {
  const path = pathFunctions.relative(parent, candidate);
  return (
    path === "" ||
    (!pathFunctions.isAbsolute(path) &&
      path !== ".." &&
      !path.startsWith(`..${pathFunctions.sep}`))
  );
}

function safeRuleId(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,127}$/i.test(value)
    ? value
    : "unknown-rule";
}

function appendBounded(chunks, chunk, state, child) {
  state.bytes += chunk.length;
  if (state.bytes > MAX_CAPTURE_BYTES) {
    child.kill();
    state.exceeded = true;
    return;
  }
  chunks.push(chunk);
}

function repositoryProcessEnvironment() {
  const environment = {};
  for (const key of CHILD_ENVIRONMENT_KEYS) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  for (const key of Object.keys(environment)) {
    const normalized = key.toUpperCase();
    if (
      GIT_TARGET_ENVIRONMENT_KEYS.has(normalized) ||
      normalized.startsWith("GIT_CONFIG_KEY_") ||
      normalized.startsWith("GIT_CONFIG_VALUE_") ||
      normalized.startsWith("GIT_TRACE")
    ) {
      delete environment[key];
    }
  }
  environment.GIT_NO_REPLACE_OBJECTS = "1";
  environment.GIT_TERMINAL_PROMPT = "0";
  environment.NO_COLOR = "1";
  return environment;
}

export function runProcess(binaryPath, args, { input, cwd = REPOSITORY_ROOT } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(binaryPath, args, {
      cwd,
      env: repositoryProcessEnvironment(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    const state = { bytes: 0, exceeded: false };

    child.once("error", (error) => {
      rejectPromise(
        new SecretScanError(
          "SECRET_SCANNER_PROCESS_START",
          "the pinned scanner executable could not start",
          { cause: error },
        ),
      );
    });
    child.stdout.on("data", (chunk) =>
      appendBounded(stdoutChunks, chunk, state, child),
    );
    child.stderr.on("data", (chunk) =>
      appendBounded(stderrChunks, chunk, state, child),
    );
    child.once("close", (code, signal) => {
      if (state.exceeded) {
        rejectPromise(
          new SecretScanError(
            "SECRET_SCANNER_OUTPUT_BOUNDARY",
            "scanner output exceeded the in-memory redacted-report boundary",
          ),
        );
        return;
      }
      resolvePromise({
        code,
        signal,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });

    if (input === undefined) child.stdin.end();
    else child.stdin.end(input);
  });
}

function parseScannerFindings(reportText) {
  let parsed;
  try {
    parsed = JSON.parse(reportText || "null");
  } catch (error) {
    throw new SecretScanError(
      "SECRET_SCANNER_REPORT_INVALID",
      "the scanner did not return its expected JSON report",
      { cause: error },
    );
  }
  const findings = parsed === null ? [] : parsed;
  if (!Array.isArray(findings)) {
    throw new SecretScanError(
      "SECRET_SCANNER_REPORT_INVALID",
      "the scanner report is not a finding array",
    );
  }

  for (const finding of findings) {
    if (
      finding?.Secret !== "REDACTED" ||
      typeof finding?.Match !== "string" ||
      !finding.Match.includes("REDACTED")
    ) {
      throw new SecretScanError(
        "SECRET_SCANNER_REPORT_REDACTION",
        "the scanner report did not fully mask a candidate value",
      );
    }
  }
  return findings;
}

function safeFinding(finding, index) {
  return {
    ordinal: index + 1,
    rule: safeRuleId(finding.RuleID),
    line: Number.isSafeInteger(finding.StartLine) ? finding.StartLine : null,
    commit:
      typeof finding.Commit === "string" &&
      /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(finding.Commit)
        ? finding.Commit.slice(0, 12)
        : null,
  };
}

function commonArguments(configPath) {
  return [
    "--config",
    configPath,
    "--redact=100",
    "--report-format",
    "json",
    "--report-path",
    "-",
    "--exit-code",
    String(FINDINGS_EXIT_CODE),
    "--no-banner",
    "--no-color",
    "--ignore-gitleaks-allow",
    "--timeout",
    "180",
    "--validation=false",
  ];
}

export async function executeSecretScan({
  binaryPath,
  configPath = CONFIG_PATH,
  cwd = REPOSITORY_ROOT,
  forbiddenValues = [],
  scannerArguments,
  input,
  processRunner = runProcess,
  scope,
}) {
  const result = await processRunner(
    binaryPath,
    [...scannerArguments, ...commonArguments(configPath)],
    { input, cwd },
  );

  const rawTranscript = `${result.stdout}${result.stderr}`;
  if (
    forbiddenValues.some(
      (value) =>
        typeof value === "string" &&
        value.length > 0 &&
        rawTranscript.includes(value),
    )
  ) {
    throw new SecretScanError(
      "SECRET_SCANNER_TRANSCRIPT_DISCLOSURE",
      "scanner output crossed the transient-value boundary",
    );
  }

  if (result.signal || ![0, FINDINGS_EXIT_CODE].includes(result.code)) {
    throw new SecretScanError(
      "SECRET_SCANNER_OPERATIONAL_FAILURE",
      `${scope} did not complete; scanner diagnostics remain in the local process boundary`,
    );
  }

  const sensitiveFindings = parseScannerFindings(result.stdout);
  if (result.code === 0 && sensitiveFindings.length > 0) {
    throw new SecretScanError(
      "SECRET_SCANNER_EXIT_CONTRACT",
      `${scope} returned findings with a clean exit status`,
    );
  }
  if (result.code === FINDINGS_EXIT_CODE && sensitiveFindings.length === 0) {
    throw new SecretScanError(
      "SECRET_SCANNER_EXIT_CONTRACT",
      `${scope} returned a finding exit status without a redacted finding`,
    );
  }

  return {
    findings: sensitiveFindings.map(safeFinding),
  };
}

export function generateSyntheticCanary(bytes = randomBytes(36)) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== 36) {
    throw new SecretScanError(
      "SECRET_SCANNER_CANARY_SOURCE",
      "the synthetic canary requires 36 random bytes",
    );
  }
  let token = "ghp_";
  for (const byte of bytes) token += CANARY_ALPHABET[byte % CANARY_ALPHABET.length];
  return token;
}

export async function runSyntheticCanary({
  binaryPath,
  configPath = CONFIG_PATH,
  processRunner = runProcess,
  canary = generateSyntheticCanary(),
} = {}) {
  const input = `GITHUB_TOKEN="${canary}"\n`;
  const result = await executeSecretScan({
    binaryPath,
    configPath,
    scannerArguments: ["stdin", "--isolate-rule", "github-pat"],
    forbiddenValues: [canary],
    input,
    processRunner,
    scope: "synthetic canary",
  });

  if (
    result.findings.length !== 1 ||
    result.findings[0]?.rule !== "github-pat"
  ) {
    throw new SecretScanError(
      "SECRET_SCANNER_CANARY_NOT_DETECTED",
      "the scanner did not detect exactly one generated GitHub-token canary",
    );
  }
  if (
    JSON.stringify(result).includes(canary)
  ) {
    throw new SecretScanError(
      "SECRET_SCANNER_CANARY_DISCLOSED",
      "the generated canary crossed the redacted scanner-output boundary",
    );
  }

  return { detected: true, redacted: true, rule: "github-pat" };
}

function runGit(args, repositoryRoot = REPOSITORY_ROOT) {
  const result = spawnSync("git", ["-C", repositoryRoot, ...args], {
    encoding: "utf8",
    env: repositoryProcessEnvironment(),
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || ![0, 1].includes(result.status)) {
    throw new SecretScanError(
      "SECRET_SCANNER_GIT_STATE",
      "the repository state required for the selected scan is unavailable",
      { cause: result.error },
    );
  }
  return result;
}

function assertCompleteHistoryAvailable(repositoryRoot = REPOSITORY_ROOT) {
  const result = runGit(["rev-parse", "--is-shallow-repository"], repositoryRoot);
  if (result.status !== 0 || result.stdout.trim() !== "false") {
    throw new SecretScanError(
      "SECRET_SCANNER_SHALLOW_HISTORY",
      "fetch complete repository history and refs before using history mode",
    );
  }
}

function hasStagedChanges(repositoryRoot = REPOSITORY_ROOT) {
  const result = runGit(
    ["diff", "--cached", "--quiet", "--exit-code"],
    repositoryRoot,
  );
  return result.status === 1;
}

function isRestingToolOrDependencyEntry(directory, entry, root) {
  return (
    RESTING_DEPENDENCY_DIRECTORY_NAMES.has(entry.name) ||
    (directory === root && [".git", ".tools"].includes(entry.name)) ||
    (directory === join(root, ".artifacts") && entry.name === "uv-cache")
  );
}

async function findScannerIgnoreSurfaces(directory, found = [], root = directory) {
  await access(
    directory,
    filesystemConstants.R_OK | filesystemConstants.X_OK,
  );
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (SCANNER_IGNORE_FILENAMES.has(entry.name.toLowerCase())) {
      found.push(join(directory, entry.name));
      continue;
    }
    const prefiltered = isRestingToolOrDependencyEntry(
      directory,
      entry,
      root,
    );
    if (prefiltered) {
      const acceptedGitFile = entry.name === ".git" && entry.isFile();
      if (!entry.isDirectory() && !acceptedGitFile) {
        throw new SecretScanError(
          "SECRET_SCANNER_TREE_ENTRY_TYPE",
          "a prefiltered scanner path is not its expected regular directory type",
        );
      }
      continue;
    }
    if (entry.isDirectory()) {
      await findScannerIgnoreSurfaces(join(directory, entry.name), found, root);
    } else if (entry.isFile()) {
      await access(join(directory, entry.name), filesystemConstants.R_OK);
    } else {
      throw new SecretScanError(
        "SECRET_SCANNER_TREE_ENTRY_TYPE",
        "the scanned tree contains a symbolic link or special filesystem entry",
      );
    }
  }
  return found;
}

export async function assertSingleSuppressionSurface(
  repositoryRoot = REPOSITORY_ROOT,
) {
  let ignoreSurfaces;
  try {
    ignoreSurfaces = await findScannerIgnoreSurfaces(repositoryRoot);
  } catch (error) {
    if (error instanceof SecretScanError) throw error;
    throw new SecretScanError(
      "SECRET_SCANNER_TREE_CLOSURE",
      "the repository contains a path that cannot be read before scanning",
      { cause: error },
    );
  }
  if (ignoreSurfaces.length > 0) {
    throw new SecretScanError(
      "SECRET_SCANNER_SUPPRESSION_SURFACE",
      "route reviewed exceptions through .betterleaks.toml; ignore files are not part of this contract",
    );
  }
}

function inspectIndex(repositoryRoot) {
  const result = runGit(["ls-files", "--stage", "-z"], repositoryRoot);
  if (result.status !== 0) {
    throw new SecretScanError(
      "SECRET_SCANNER_INDEX_UNAVAILABLE",
      "the Git index could not be inspected",
    );
  }
  const entries = [];
  for (const record of result.stdout.split("\0")) {
    if (record === "") continue;
    const match = /^(\d+) ([a-f0-9]{40,64}) (\d)\t([\s\S]+)$/.exec(record);
    if (!match) {
      throw new SecretScanError(
        "SECRET_SCANNER_INDEX_INVALID",
        "the Git index contains an unreadable entry",
      );
    }
    const [, mode, oid, stage, path] = match;
    if (stage !== "0") {
      throw new SecretScanError(
        "SECRET_SCANNER_INDEX_CONFLICT",
        "resolve index conflicts before scanning staged material",
      );
    }
    if (!["100644", "100755", "120000"].includes(mode)) {
      throw new SecretScanError(
        "SECRET_SCANNER_INDEX_ENTRY_TYPE",
        "the Git index contains an entry that cannot be materialized as a regular scan input",
      );
    }
    entries.push({ mode, oid, path });
  }
  return entries;
}

function readIndexBlob(repositoryRoot, oid) {
  const result = spawnSync(
    "git",
    ["-C", repositoryRoot, "cat-file", "blob", oid],
    {
      encoding: null,
      env: repositoryProcessEnvironment(),
      windowsHide: true,
      maxBuffer: 128 * 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new SecretScanError(
      "SECRET_SCANNER_INDEX_BLOB",
      "an indexed blob could not be read without worktree conversion",
      { cause: result.error },
    );
  }
  return result.stdout;
}

export async function materializeGitIndex(
  repositoryRoot = REPOSITORY_ROOT,
) {
  const entries = inspectIndex(repositoryRoot);
  const snapshot = await mkdtemp(join(tmpdir(), "secret-scan-index-"));
  try {
    for (const entry of entries) {
      if (
        isAbsolute(entry.path) ||
        entry.path.split("/").some((part) => part === "" || part === "." || part === "..")
      ) {
        throw new SecretScanError(
          "SECRET_SCANNER_INDEX_PATH",
          "the Git index contains a path outside the materialization grammar",
        );
      }
      const target = resolve(snapshot, entry.path);
      if (!isPathWithin(snapshot, target) || target === snapshot) {
        throw new SecretScanError(
          "SECRET_SCANNER_INDEX_PATH",
          "the Git index contains a path outside the materialized scan boundary",
        );
      }
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, readIndexBlob(repositoryRoot, entry.oid), {
        flag: "wx",
      });
    }
  } catch (error) {
    await rm(snapshot, { recursive: true, force: true });
    if (error instanceof SecretScanError) throw error;
    throw new SecretScanError(
      "SECRET_SCANNER_INDEX_MATERIALIZATION",
      "the exact Git index could not be materialized for scanning",
      { cause: error },
    );
  }
  return snapshot;
}

export async function resolveArtifactTarget(target) {
  if (typeof target !== "string" || target.trim() === "") {
    throw new SecretScanError(
      "SECRET_SCANNER_ARTIFACT_REQUIRED",
      "artifact mode requires one repository-relative file or directory",
    );
  }
  const resolved = resolve(REPOSITORY_ROOT, target);
  if (!isPathWithin(REPOSITORY_ROOT, resolved) || resolved === REPOSITORY_ROOT) {
    throw new SecretScanError(
      "SECRET_SCANNER_ARTIFACT_BOUNDARY",
      "artifact mode accepts one path inside the repository",
    );
  }
  const relativeTarget = relative(REPOSITORY_ROOT, resolved);
  const targetParts = relativeTarget.split(sep);
  const restsOutsideArtifactScanning =
    [".git", ".tools"].includes(targetParts[0]) ||
    targetParts.some((part) => RESTING_DEPENDENCY_DIRECTORY_NAMES.has(part)) ||
    (targetParts[0] === ".artifacts" && targetParts[1] === "uv-cache");
  if (restsOutsideArtifactScanning) {
    throw new SecretScanError(
      "SECRET_SCANNER_ARTIFACT_RESTING",
      "the selected path belongs to a named cache or dependency boundary",
    );
  }
  let state;
  try {
    state = await lstat(resolved);
  } catch (error) {
    throw new SecretScanError(
      "SECRET_SCANNER_ARTIFACT_UNAVAILABLE",
      "the selected artifact is unavailable",
      { cause: error },
    );
  }
  if (state.isSymbolicLink() || (!state.isFile() && !state.isDirectory())) {
    throw new SecretScanError(
      "SECRET_SCANNER_ARTIFACT_TYPE",
      "the selected artifact must be a regular file or directory",
    );
  }
  let repositoryRealPath;
  let targetRealPath;
  try {
    [repositoryRealPath, targetRealPath] = await Promise.all([
      realpath(REPOSITORY_ROOT),
      realpath(resolved),
    ]);
  } catch (error) {
    throw new SecretScanError(
      "SECRET_SCANNER_ARTIFACT_UNAVAILABLE",
      "the selected artifact could not be resolved",
      { cause: error },
    );
  }
  if (!isPathWithin(repositoryRealPath, targetRealPath)) {
    throw new SecretScanError(
      "SECRET_SCANNER_ARTIFACT_BOUNDARY",
      "artifact mode does not follow a parent symlink outside the repository",
    );
  }
  return targetRealPath;
}

async function scanScope({
  binaryPath,
  configPath,
  cwd = REPOSITORY_ROOT,
  scope,
  scannerArguments,
}) {
  const result = await executeSecretScan({
    binaryPath,
    configPath,
    cwd,
    scannerArguments,
    scope,
  });
  if (result.findings.length > 0) {
    throw new SecretScanFindingsError(scope, result.findings);
  }
  return { scope, status: "clean" };
}

async function scanStaged({ binaryPath, configPath }) {
  if (!hasStagedChanges()) return { scope: "staged index", status: "resting" };
  const snapshot = await materializeGitIndex();
  try {
    await assertSingleSuppressionSurface(snapshot);
    return await scanScope({
      binaryPath,
      configPath,
      cwd: snapshot,
      scope: "exact staged index",
      scannerArguments: ["dir", "."],
    });
  } finally {
    await rm(snapshot, { recursive: true, force: true });
  }
}

export async function runRepositorySecretScan({
  mode,
  artifact,
  repositoryRoot = REPOSITORY_ROOT,
  configPath = CONFIG_PATH,
  installVerifier = verifyBetterleaksInstall,
} = {}) {
  if (repositoryRoot !== REPOSITORY_ROOT) {
    throw new SecretScanError(
      "SECRET_SCANNER_REPOSITORY_BOUNDARY",
      "this scanner contract is rooted at Gist Registry",
    );
  }
  await assertSingleSuppressionSurface(repositoryRoot);
  const installation = await installVerifier({ repositoryRoot });
  const config = await readFile(configPath);
  const configSha256 = createHash("sha256").update(config).digest("hex");
  const binaryPath = installation.binaryPath;
  const canary = await runSyntheticCanary({ binaryPath, configPath });
  const scopes = [];

  if (mode === "canary") {
    return { canary, configSha256, scopes, version: installation.version };
  }

  if (mode === "tree" || mode === "all") {
    scopes.push(
      await scanScope({
        binaryPath,
        configPath,
        scope: "working tree and ignored local material",
        scannerArguments: ["dir", "."],
      }),
    );
  }

  if (mode === "staged" || mode === "all") {
    scopes.push(await scanStaged({ binaryPath, configPath }));
  }

  if (mode === "history" || mode === "all") {
    assertCompleteHistoryAvailable();
    scopes.push(
      await scanScope({
        binaryPath,
        configPath,
        scope: "diff-visible history across all locally available refs",
        scannerArguments: [
          "git",
          REPOSITORY_ROOT,
          "--log-opts=--all --full-history --diff-merges=separate --diff-filter=tuxdb",
        ],
      }),
    );
  }

  if (mode === "artifact") {
    const target = await resolveArtifactTarget(artifact);
    scopes.push(
      await scanScope({
        binaryPath,
        configPath,
        scope: "named repository artifact",
        scannerArguments: ["dir", relative(REPOSITORY_ROOT, target)],
      }),
    );
  }

  if (!["tree", "staged", "history", "all", "artifact"].includes(mode)) {
    throw new SecretScanError(
      "SECRET_SCANNER_MODE",
      "choose canary, tree, staged, history, artifact, or all",
    );
  }

  return { canary, configSha256, scopes, version: installation.version };
}

function renderReceipt(receipt) {
  const lines = [
    `Secret-material boundary passed with Betterleaks ${receipt.version}.`,
    `Configuration: sha256:${receipt.configSha256}`,
    "Synthetic canary: detected and fully redacted.",
  ];
  for (const scope of receipt.scopes) {
    lines.push(`${scope.scope}: ${scope.status}.`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderFindings(error) {
  const lines = [error.message];
  for (const finding of error.findings.slice(0, 50)) {
    const location = `finding ${finding.ordinal}${finding.line ? ` at line ${finding.line}` : ""}`;
    const commit = finding.commit ? ` @ ${finding.commit}` : "";
    lines.push(`- ${finding.rule}: ${location}${commit}`);
  }
  if (error.findings.length > 50) {
    lines.push(`- ${error.findings.length - 50} additional redacted locations remain local.`);
  }
  return `${lines.join("\n")}\n`;
}

function usage() {
  return `Usage: node tools/scan-secret-material.mjs <mode> [artifact]\n\nModes:\n  canary   Prove detection and redaction with a generated non-live token shape.\n  tree     Scan tracked, untracked, and ignored local material.\n  staged   Scan the exact Git index when staged changes exist.\n  history  Scan diff-visible history across local refs in a complete clone.\n  artifact Scan one named repository-local generated artifact.\n  all      Run canary, tree, staged, and history modes.\n`;
}

async function main() {
  const [mode, artifact, ...extra] = process.argv.slice(2);
  if (mode === "--help" || mode === "-h") {
    process.stdout.write(usage());
    return;
  }
  if (extra.length > 0 || (mode !== "artifact" && artifact !== undefined)) {
    throw new SecretScanError(
      "SECRET_SCANNER_ARGUMENTS",
      "the selected mode received unexpected arguments",
    );
  }
  const receipt = await runRepositorySecretScan({ mode, artifact });
  process.stdout.write(renderReceipt(receipt));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    if (error instanceof SecretScanFindingsError) {
      process.stderr.write(renderFindings(error));
    } else if (
      error instanceof SecretScanError ||
      error instanceof BetterleaksInstallError
    ) {
      process.stderr.write(`${error.message}\n`);
    } else {
      process.stderr.write(
        "SECRET_SCANNER_FAILED: the secret-material boundary did not complete\n",
      );
    }
    process.exitCode = 1;
  });
}
