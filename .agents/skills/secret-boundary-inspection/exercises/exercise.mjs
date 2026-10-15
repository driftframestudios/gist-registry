import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

// This finite teaching model asks whether every requested observation completed.
// The receiver retains its production receipt shape and its resting-scope policy.
function ready({ canary, requested, scopes }) {
  return canary.detected === true && canary.redacted === true && requested.length > 0 &&
    requested.every(name => {
      const matches = scopes.filter(scope => scope.name === name);
      return matches.length === 1 && matches[0].status === "clean";
    });
}

function exerciseDisposition() {
  const clean = { canary: { detected: true, redacted: true }, requested: ["artifact"],
    scopes: [{ name: "artifact", status: "clean" }] };
  assert.equal(ready(clean), true);
  for (const status of ["finding", "error", "unobserved", "resting"]) {
    assert.equal(ready({ ...clean, scopes: [{ name: "artifact", status }] }), false);
  }
  assert.equal(ready({ ...clean, canary: { detected: false, redacted: true } }), false);
  assert.equal(ready({ ...clean, canary: { detected: true, redacted: false } }), false);
  assert.equal(ready({ ...clean, scopes: [] }), false);
  assert.equal(ready({ ...clean, scopes: [...clean.scopes, ...clean.scopes] }), false);
  assert.equal(ready({ ...clean, requested: [] }), false);
  const detectorFailed = { ...clean, scopes: [{ name: "artifact", status: "error" }] };
  const faultyAdapter = () => true;
  assert.notEqual(faultyAdapter(detectorFailed), ready(detectorFailed));
}

async function verifySource(root, revision) {
  assert.match(revision, /^[a-f0-9]{40}$/u);
  // Explicit flags make unsupported Git versions stop before source admission.
  const gitArguments = ["--no-lazy-fetch", "--no-replace-objects", "--no-optional-locks", "-C", root];
  // The explicit receiver owns repository selection; ambient Git overrides rest.
  const gitEnvironment = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => !name.toUpperCase().startsWith("GIT_")));
  const git = (...args) => execFileSync("git", [...gitArguments, ...args], {
    env: gitEnvironment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  assert.equal(git("rev-parse", "HEAD"), revision);
  // Exact object comparison also observes changes hidden by index flags.
  for (const name of ["tools/scan-secret-material.mjs", "tools/install-betterleaks.mjs", ".betterleaks.toml"]) {
    const path = resolve(root, name);
    const state = await lstat(path);
    assert.equal(state.isFile() && !state.isSymbolicLink(), true);
    assert.equal(await realpath(path), path);
    const expected = execFileSync("git", [...gitArguments, "show", `${revision}:${name}`], {
      env: gitEnvironment, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 4 * 1024 * 1024,
    });
    assert.deepEqual(await readFile(path), expected);
  }
}

async function exerciseNative(root, revision) {
  await verifySource(root, revision);
  const scanner = await import(pathToFileURL(resolve(root, "tools/scan-secret-material.mjs")));
  const installer = await import(pathToFileURL(resolve(root, "tools/install-betterleaks.mjs")));
  const installation = await installer.verifyBetterleaksInstall({ repositoryRoot: root });
  const configPath = resolve(root, ".betterleaks.toml");
  const canary = await scanner.runSyntheticCanary({ binaryPath: installation.binaryPath, configPath });
  assert.deepEqual(canary, { detected: true, redacted: true, rule: "github-pat" });
  const finding = { RuleID: "github-pat", Secret: "REDACTED", Match: "REDACTED", StartLine: 1 };
  const cases = [
    [{ code: 2, signal: null, stdout: "", stderr: "synthetic private diagnostic" }, "SECRET_SCANNER_OPERATIONAL_FAILURE"],
    [{ code: null, signal: "SIGTERM", stdout: "", stderr: "" }, "SECRET_SCANNER_OPERATIONAL_FAILURE"],
    [{ code: 0, signal: null, stdout: "malformed", stderr: "" }, "SECRET_SCANNER_REPORT_INVALID"],
    [{ code: 10, signal: null, stdout: JSON.stringify([{ ...finding, Secret: "synthetic unmasked" }]), stderr: "" }, "SECRET_SCANNER_REPORT_REDACTION"],
    [{ code: 0, signal: null, stdout: JSON.stringify([finding]), stderr: "" }, "SECRET_SCANNER_EXIT_CONTRACT"],
    [{ code: 10, signal: null, stdout: "[]", stderr: "" }, "SECRET_SCANNER_EXIT_CONTRACT"],
  ];
  for (const [result, code] of cases) {
    await assert.rejects(scanner.executeSecretScan({
      binaryPath: installation.binaryPath, configPath, scannerArguments: [], scope: "synthetic receiver fault",
      processRunner: async () => result,
    }), error => error.code === code && !error.message.includes("synthetic private diagnostic"));
  }
  await assert.rejects(scanner.runSyntheticCanary({
    binaryPath: installation.binaryPath, configPath,
    processRunner: async () => ({ code: 0, signal: null, stdout: "[]", stderr: "" }),
  }), error => error.code === "SECRET_SCANNER_CANARY_NOT_DETECTED");

  const token = scanner.generateSyntheticCanary();
  const result = await scanner.executeSecretScan({
    binaryPath: installation.binaryPath, configPath, scannerArguments: [], scope: "synthetic receiver metadata",
    processRunner: async () => ({ code: 10, signal: null,
      stdout: JSON.stringify([{ ...finding, File: token, Message: token, Fingerprint: token, Attributes: { path: token } }]),
      stderr: token }),
  });
  assert.deepEqual(result.findings, [{ ordinal: 1, rule: "github-pat", line: 1, commit: null }]);
  assert.equal(JSON.stringify(result).includes(token), false);
  const rendered = scanner.renderFindings(new scanner.SecretScanFindingsError("synthetic receiver", result.findings));
  assert.equal(rendered.includes(token), false);
  await verifySource(root, revision);
  return { receiverRevision: revision, engineVersion: installation.version,
    configSha256: createHash("sha256").update(await readFile(configPath)).digest("hex"),
    observation: "native canary and eight bounded failure/output controls passed" };
}

let phase = "synthetic disposition";
try {
  const { values } = parseArgs({ options: { receiver: { type: "string" }, revision: { type: "string" } } });
  exerciseDisposition();
  if (values.receiver !== undefined || values.revision !== undefined) {
    assert.equal(typeof values.receiver === "string" && typeof values.revision === "string", true);
    phase = "native receiver";
    const root = await realpath(resolve(values.receiver));
    const result = await exerciseNative(root, values.revision);
    console.log(JSON.stringify(result));
  }
  console.log("PASS: canary, scope and failure dispositions preserve the handoff boundary");
} catch {
  // Raw assertions, process output and causes remain inside this local invocation.
  console.error(`Secret-boundary exercise held during ${phase}; no acceptance receipt was issued`);
  process.exitCode = 1;
}
