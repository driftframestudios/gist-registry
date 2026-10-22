#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  NODE_RUNTIME_DEV_ENGINE,
  NODE_RUNTIME_POLICY,
  assessNodeVersion,
} from "./node-runtime-policy.mjs";
import { isDirectNodeInvocation } from "./node-cli-entrypoint.mjs";

export {
  NODE_RUNTIME_DEV_ENGINE,
  NODE_RUNTIME_POLICY,
  assessNodeVersion,
  assertNodeRuntime,
  NodeRuntimeAdmissionError,
  parseNodeCoordinate,
  parseNodeVersion,
} from "./node-runtime-policy.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirectories = new Set([".artifacts", ".git", "node_modules"]);
const receiptVersionKeys = [
  "node",
  "modules",
  "napi",
  "openssl",
  "v8",
  "uv",
  "zlib",
  "brotli",
];

function matchesDevEngine(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.keys(value).length === 3 &&
    value.name === NODE_RUNTIME_DEV_ENGINE.name &&
    value.version === NODE_RUNTIME_DEV_ENGINE.version &&
    value.onFail === NODE_RUNTIME_DEV_ENGINE.onFail
  );
}

async function findPackageManifests(directory = repositoryRoot) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        paths.push(...(await findPackageManifests(join(directory, entry.name))));
      }
    } else if (entry.name === "package.json") {
      paths.push(join(directory, entry.name));
    }
  }
  return paths.sort();
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function inspectPackageRuntimeContracts(root = repositoryRoot) {
  const resolvedRoot = resolve(root);
  const manifests = await findPackageManifests(resolvedRoot);
  const findings = [];
  const repositoryPath = (path) => relative(resolvedRoot, path).split(sep).join("/");

  for (const manifestPath of manifests) {
    const manifest = await readJson(manifestPath);
    if (manifest.engines?.node !== NODE_RUNTIME_POLICY.engineRange) {
      findings.push({
        code: "NODE_ENGINE_RANGE_DRIFT",
        path: repositoryPath(manifestPath),
        observed: manifest.engines?.node ?? null,
        expected: NODE_RUNTIME_POLICY.engineRange,
      });
    }
    if (!matchesDevEngine(manifest.devEngines?.runtime)) {
      findings.push({
        code: "NODE_DEV_ENGINE_DRIFT",
        path: repositoryPath(manifestPath),
        observed: manifest.devEngines?.runtime ?? null,
        expected: NODE_RUNTIME_DEV_ENGINE,
      });
    }

    const lockPath = join(dirname(manifestPath), "package-lock.json");
    let lock;
    try {
      lock = await readJson(lockPath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        findings.push({
          code: "NODE_LOCK_MISSING",
          path: repositoryPath(lockPath),
          expected: NODE_RUNTIME_POLICY.engineRange,
        });
        continue;
      }
      throw error;
    }

    if (lock.packages?.[""]?.engines?.node !== NODE_RUNTIME_POLICY.engineRange) {
      findings.push({
        code: "NODE_LOCK_ENGINE_RANGE_DRIFT",
        path: repositoryPath(lockPath),
        observed: lock.packages?.[""]?.engines?.node ?? null,
        expected: NODE_RUNTIME_POLICY.engineRange,
      });
    }
  }

  return { checked: manifests.length, findings };
}

function selectedProcessVersions(versions) {
  return Object.fromEntries(
    receiptVersionKeys.filter((key) => versions[key] !== undefined).map((key) => [key, versions[key]]),
  );
}

export async function buildNodeRuntimeReceipt({
  version = process.version,
  versions = process.versions,
  root = repositoryRoot,
} = {}) {
  const runtime = assessNodeVersion(version);
  const packageContracts = await inspectPackageRuntimeContracts(root);
  const accepted = runtime.accepted && packageContracts.findings.length === 0;

  return {
    schemaVersion: "1.0.0",
    status: accepted ? "accepted" : "requires_update",
    processVersion: version,
    processVersions: selectedProcessVersions(versions),
    policy: NODE_RUNTIME_POLICY.engineRange,
    localDefault: NODE_RUNTIME_POLICY.localDefault,
    runtime,
    packageContracts: {
      status: packageContracts.findings.length === 0 ? "aligned" : "requires_update",
      ...packageContracts,
    },
  };
}

async function main() {
  const receipt = await buildNodeRuntimeReceipt();
  console.log(JSON.stringify({ nodeRuntimeAdmission: receipt }, null, 2));
  if (receipt.status !== "accepted") {
    if (receipt.runtime.remediation) console.error(`Remediation: ${receipt.runtime.remediation}`);
    if (receipt.packageContracts.findings.length > 0) {
      console.error(
        `Remediation: align each listed package and lock engine with ${NODE_RUNTIME_POLICY.engineRange}.`,
      );
    }
    process.exitCode = 1;
  }
}

if (isDirectNodeInvocation(import.meta.url)) await main();
