#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const NODE_RUNTIME_POLICY = Object.freeze({
  engineRange: ">=22.23.4 <23 || >=24.22.1 <25 || >=26.12.1 <27",
  localDefault: "24.22.1",
  floors: Object.freeze(
    new Map([
      [22, Object.freeze([22, 23, 4])],
      [24, Object.freeze([24, 22, 1])],
      [26, Object.freeze([26, 12, 1])],
    ]),
  ),
});

export const NODE_RUNTIME_DEV_ENGINE = Object.freeze({
  name: "node",
  version: NODE_RUNTIME_POLICY.engineRange,
  onFail: "error",
});

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

function compareTriples(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

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

export function parseNodeVersion(version) {
  const coordinate = parseNodeCoordinate(version);
  if (!coordinate || coordinate.prerelease) return null;
  return coordinate.version;
}

export function parseNodeCoordinate(version) {
  const match =
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u.exec(
      version,
    );
  if (!match) return null;
  return {
    version: match.slice(1, 4).map(Number),
    prerelease: match[4] ?? null,
    build: match[5] ?? null,
  };
}

export function assessNodeVersion(version) {
  const coordinate = parseNodeCoordinate(version);
  const remediation =
    "Select Node.js 22.23.4+, 24.22.1+, or 26.12.1+ within its major line; " +
    `the reviewed local default is ${NODE_RUNTIME_POLICY.localDefault} via .nvmrc.`;

  if (!coordinate) {
    return {
      accepted: false,
      code: "NODE_VERSION_FORMAT",
      reason: `The active version value ${JSON.stringify(version)} needs a stable major.minor.patch coordinate.`,
      remediation,
    };
  }

  if (coordinate.prerelease) {
    return {
      accepted: false,
      code: "NODE_PRERELEASE_OUTSIDE_POLICY",
      reason: `Node.js ${version} is a prerelease coordinate; production admission uses a stable release at or above the accepted floor.`,
      remediation,
    };
  }

  const parsed = coordinate.version;

  const floor = NODE_RUNTIME_POLICY.floors.get(parsed[0]);
  if (!floor) {
    return {
      accepted: false,
      code: "NODE_MAJOR_OUTSIDE_POLICY",
      reason: `Node.js ${parsed.join(".")} sits outside the supported 22, 24, and 26 release lines.`,
      remediation,
    };
  }

  if (compareTriples(parsed, floor) < 0) {
    return {
      accepted: false,
      code: "NODE_SECURITY_FLOOR",
      reason: `Node.js ${parsed.join(".")} precedes the accepted ${floor.join(".")} security floor for this release line.`,
      remediation,
    };
  }

  return {
    accepted: true,
    code: "NODE_RUNTIME_ACCEPTED",
    reason: `Node.js ${parsed.join(".")} satisfies the accepted ${floor.join(".")} security floor for this release line.`,
  };
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

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) await main();
