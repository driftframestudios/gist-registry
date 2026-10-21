import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, extname, join, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {gzipSync} from "node:zlib";
import {build} from "vite";
import {SPECIMENS} from "../src/model.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../../..");
const artifactsRoot = resolve(repositoryRoot, ".artifacts/react-aria-visual-contract-receiver");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function walkFiles(root, directory = root) {
  const paths = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await walkFiles(root, path));
    else if (entry.isFile()) paths.push(relative(root, path).replaceAll("\\", "/"));
  }
  return paths.sort();
}

function mediaType(path) {
  return ({
    ".css": "text/css",
    ".html": "text/html",
    ".js": "text/javascript",
    ".map": "application/json"
  })[extname(path)] ?? "application/octet-stream";
}

async function compile(outDir) {
  await build({
    root: packageRoot,
    configFile: resolve(packageRoot, "vite.config.mjs"),
    logLevel: "silent",
    build: {outDir, emptyOutDir: true}
  });

  const files = [];
  for (const path of await walkFiles(outDir)) {
    const bytes = await readFile(resolve(outDir, path));
    files.push({path, mediaType: mediaType(path), bytes: bytes.length, sha256: sha256(bytes)});
  }
  return {schemaVersion: "0.1.0", files};
}

async function authoredSourceBytes(paths) {
  let total = 0;
  for (const path of paths) total += (await readFile(resolve(packageRoot, path))).length;
  return total;
}

async function measurements(manifest, budgets) {
  const packageJson = await readJson(resolve(packageRoot, "package.json"));
  const packageLock = await readJson(resolve(packageRoot, "package-lock.json"));
  const model = await readFile(resolve(packageRoot, "src/model.mjs"), "utf8");
  const javascript = manifest.files.filter(file => extname(file.path) === ".js");
  const runtime = manifest.files.filter(file => extname(file.path) !== ".map");
  const sourceMaps = manifest.files.filter(file => extname(file.path) === ".map");
  assert.equal(javascript.length, 1, "the receiver build must emit one JavaScript entry asset");
  const javascriptBytes = await readFile(resolve(budgets.firstBuildDirectory, javascript[0].path));

  return {
    authoredSourceBytes: await authoredSourceBytes(budgets.authoredSourcePaths),
    directDependencyCount:
      Object.keys(packageJson.dependencies ?? {}).length +
      Object.keys(packageJson.devDependencies ?? {}).length,
    resolvedPackageCount: Object.keys(packageLock.packages ?? {}).length,
    specimenCount: SPECIMENS.length,
    transitionOperationCount: [...model.matchAll(
      /export function (?:chooseDraft|beginPreview|settlePreview|releaseAccepted)\b/gu
    )].length,
    runtimeJavaScriptBytes: javascript.reduce((sum, file) => sum + file.bytes, 0),
    runtimeJavaScriptGzipBytes: gzipSync(javascriptBytes, {level: 9}).length,
    runtimeAssetBytes: runtime.reduce((sum, file) => sum + file.bytes, 0),
    sourceMapBytes: sourceMaps.reduce((sum, file) => sum + file.bytes, 0),
    completeBuildBytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0)
  };
}

function checkRouteInventory(manifest) {
  const paths = new Set(manifest.files.map(file => file.path));
  for (const path of [
    "receiver-entry.html",
    "source/native-receiver.html",
    "source/semantic-reading.html"
  ]) {
    assert.ok(paths.has(path), `the production build must carry ${path}`);
  }
}

function checkThresholds(observed, thresholds) {
  assert.deepEqual(
    Object.keys(observed).sort(),
    Object.keys(thresholds).sort(),
    "every measurement must have one explicit review threshold"
  );
  for (const [name, value] of Object.entries(observed)) {
    assert.ok(
      value <= thresholds[name],
      `${name} ${value} exceeds review threshold ${thresholds[name]}`
    );
  }
}

function gzipMeasurementCoordinate() {
  return {
    node: process.versions.node,
    zlib: process.versions.zlib,
    platform: process.platform,
    architecture: process.arch,
    format: "gzip",
    level: 9
  };
}

function checkExpectedMeasurements(observed, expected, thresholds) {
  const deterministic = expected.deterministicMeasurements;
  const profiled = expected.profiledMeasurements;
  assert.ok(deterministic && typeof deterministic === "object" && !Array.isArray(deterministic));
  assert.ok(profiled && typeof profiled === "object" && !Array.isArray(profiled));

  const declared = [...Object.keys(deterministic), ...Object.keys(profiled)].sort();
  assert.equal(new Set(declared).size, declared.length, "measurement owners must remain distinct");
  assert.deepEqual(declared, Object.keys(observed).sort(), "each measurement requires one comparison owner");
  assert.deepEqual(declared, Object.keys(thresholds).sort(), "each measurement requires one review threshold");

  for (const [name, value] of Object.entries(deterministic)) {
    assert.equal(observed[name], value, `${name} changed from its deterministic baseline`);
  }

  const currentCoordinates = {
    runtimeJavaScriptGzipBytes: gzipMeasurementCoordinate()
  };
  for (const [name, baseline] of Object.entries(profiled)) {
    assert.ok(Number.isFinite(baseline.observed) && baseline.observed > 0, `${name} requires a finite reviewed observation`);
    assert.ok(baseline.coordinate && typeof baseline.coordinate === "object" && !Array.isArray(baseline.coordinate), `${name} requires a measurement coordinate`);
    assert.ok(currentCoordinates[name], `${name} requires an executable coordinate owner`);
    if (canonicalJson(baseline.coordinate) === canonicalJson(currentCoordinates[name])) {
      assert.equal(observed[name], baseline.observed, `${name} changed at its reviewed measurement coordinate`);
    }
  }
}

const budgets = await readJson(resolve(packageRoot, "config/build-budgets.json"));
const expected = await readJson(resolve(packageRoot, "expected/build-budget-contract.json"));
const temporaryRoot = await mkdtemp(join(tmpdir(), "visual-contract-receiver-"));
const firstBuildDirectory = resolve(temporaryRoot, "first");
const secondBuildDirectory = resolve(temporaryRoot, "second");
const startedAt = process.hrtime.bigint();

try {
  const first = await compile(firstBuildDirectory);
  const second = await compile(secondBuildDirectory);
  assert.deepEqual(second, first, "two clean builds must produce byte-identical manifests");
  checkRouteInventory(first);

  const deterministicManifestSha256 = sha256(canonicalJson(first));
  const observed = await measurements(first, {...budgets, firstBuildDirectory});
  checkThresholds(observed, budgets.thresholds);
  assert.equal(expected.coordinate, budgets.coordinate);
  assert.equal(expected.deterministicManifestSha256, deterministicManifestSha256);
  checkExpectedMeasurements(observed, expected, budgets.thresholds);

  const elapsedMilliseconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  const receipt = {
    schemaVersion: "0.1.0",
    coordinate: budgets.coordinate,
    deterministicManifestSha256,
    manifest: first,
    measurements: observed,
    measurementCoordinates: {
      runtimeJavaScriptGzipBytes: gzipMeasurementCoordinate()
    },
    thresholds: budgets.thresholds,
    observation: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      elapsedMilliseconds: Number(elapsedMilliseconds.toFixed(3)),
      peakRssBytes: process.resourceUsage().maxRSS * 1024
    }
  };
  await mkdir(artifactsRoot, {recursive: true});
  await writeFile(resolve(artifactsRoot, "last-receipt.json"), canonicalJson(receipt), "utf8");
  console.log(canonicalJson(receipt));
} finally {
  await rm(temporaryRoot, {recursive: true, force: true});
}
