import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {parseCustomProperties, projectCustomProperties} from "../tools/token-projection.mjs";

const packageRoot = new URL("../", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, packageRoot), "utf8");
}

test("direct runtime and test dependencies use exact coordinates", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  assert.deepEqual(packageJson.dependencies, {
    react: "19.3.1",
    "react-aria-components": "1.22.1",
    "react-dom": "19.3.1",
    "react-stately": "3.51.0"
  });
  assert.deepEqual(packageJson.devDependencies, {
    "@testing-library/react": "16.3.3",
    "@testing-library/user-event": "14.6.8",
    jsdom: "30.1.3",
    vite: "8.3.5",
    vitest: "5.0.5"
  });

  for (const version of [
    ...Object.values(packageJson.dependencies),
    ...Object.values(packageJson.devDependencies)
  ]) {
    assert.match(version, /^\d+\.\d+\.\d+$/);
  }
});

test("the bounded fixture digest and Issue 61 coordinate stay inspectable", async () => {
  const coordinate = JSON.parse(await read("source/token-coordinate.json"));
  const upstream = await read("tests/fixtures/acme-light.tokens.css");
  const fixture = await read("source/accepted-token-fixture.css");
  const digest = createHash("sha256").update(fixture).digest("hex");

  assert.equal(coordinate.acceptedCoordinate.semanticId, "style-dictionary-dtcg-pipeline");
  assert.equal(coordinate.acceptedCoordinate.version, "0.1.0");
  assert.equal(coordinate.acceptedCoordinate.brand, "acme");
  assert.equal(coordinate.acceptedCoordinate.mode, "light");
  assert.equal(coordinate.acceptedCoordinate.manifestKind, "generated_output_manifest");
  assert.equal(
    coordinate.acceptedCoordinate.manifestSha256,
    "6d93df6cd3c1b80076e3d4b0e162899381cfb4d82b1c28ff9c8a2a64d30a6e68"
  );
  assert.equal(coordinate.acceptedCoordinate.manifestStanding, "candidate_source_coordinate");
  assert.deepEqual(coordinate.acceptedCoordinate.generatedArtifact, {
    artifactKind: "generated_css_artifact",
    path: "acme-light/tokens.css",
    sha256: "7a5d1503f28c80f671fc27a6fbe879fbc532a55879d0f82db1c871158f29a632"
  });
  assert.equal(
    createHash("sha256").update(upstream).digest("hex"),
    coordinate.acceptedCoordinate.generatedArtifact.sha256
  );
  assert.equal(coordinate.boundedFixture.sha256, digest);
  assert.equal(coordinate.boundedFixture.adapter.id, "receiver-css-token-projection-v1");
  assert.deepEqual(
    parseCustomProperties(fixture),
    projectCustomProperties(upstream, coordinate.boundedFixture.adapter)
  );
});

test("the production build owns every linked receiver route and relative assets", async () => {
  const viteConfig = await read("vite.config.mjs");

  assert.match(viteConfig, /base:\s*"\.\/"/u);
  assert.match(viteConfig, /sourcemapPathTransform:\s*stableSourcemapPath/u);
  assert.match(viteConfig, /source\/native-receiver\.html/u);
  assert.match(viteConfig, /source\/semantic-reading\.html/u);
});

test("semantic documents retain labels, status, disclosure, and reading order", async () => {
  const index = await read("receiver-entry.html");
  const nativeRoute = await read("source/native-receiver.html");
  const semanticReading = await read("source/semantic-reading.html");

  assert.match(index, /class="semantic-companion"/);
  assert.match(index, /<noscript>/);
  assert.match(nativeRoute, /<label for="standalone-specimen">Specimen state<\/label>/);
  assert.match(nativeRoute, /role="status"/);
  assert.match(nativeRoute, /<details>/);
  assert.match(semanticReading, /<th scope="row">Draft<\/th>/);
  assert.match(semanticReading, /<th scope="row">Released<\/th>/);
});

test("receiver CSS carries logical, reflow, contrast, motion, and print contracts", async () => {
  const styles = await read("src/styles.css");

  assert.match(styles, /inset-inline-end:\s*var\(--select-caret-inset\)/);
  assert.match(styles, /padding-inline-end:\s*calc\(var\(--select-caret-inset\)/);
  assert.match(styles, /:dir\(rtl\)/);
  assert.match(styles, /@media \(max-width: 34rem\)/);
  assert.match(styles, /@media \(forced-colors: active\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /@media print/);
});

test("each measured build dimension carries an explicit review threshold", async () => {
  const budgets = JSON.parse(await read("config/build-budgets.json"));
  const expected = JSON.parse(await read("expected/build-budget-contract.json"));

  assert.equal(budgets.coordinate, "react-aria-visual-contract-receiver@0.1.0");
  assert.equal(expected.coordinate, budgets.coordinate);
  assert.match(expected.deterministicManifestSha256, /^[a-f0-9]{64}$/u);
  const profiledMeasurements = Object.fromEntries(
    Object.entries(expected.profiledMeasurements).map(([name, entry]) => [name, entry.observed])
  );
  const measurements = {...expected.deterministicMeasurements, ...profiledMeasurements};
  assert.deepEqual(
    Object.keys(measurements).sort(),
    Object.keys(budgets.thresholds).sort()
  );
  assert.equal(
    Object.keys(expected.deterministicMeasurements).length + Object.keys(expected.profiledMeasurements).length,
    Object.keys(measurements).length,
    "each measurement must have one comparison owner"
  );
  for (const [name, value] of Object.entries(measurements)) {
    assert.ok(value > 0, `${name} must carry a measured value`);
    assert.ok(value <= budgets.thresholds[name], `${name} must remain inside its review threshold`);
  }
  assert.deepEqual(expected.profiledMeasurements.runtimeJavaScriptGzipBytes.coordinate, {
    node: "26.11.0",
    zlib: "1.2.12",
    platform: "darwin",
    architecture: "arm64",
    format: "gzip",
    level: 9
  });
});
