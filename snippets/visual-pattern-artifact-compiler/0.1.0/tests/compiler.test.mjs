import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import sharp from "sharp";

import {
  DEFAULT_RESOURCE_LIMITS,
  VisualArtifactError,
  compareOrdinalText,
  compileArtifactFamily,
  publishArtifactFamily,
  validateContract,
  validateGalleryShell,
  validateSvg,
} from "../src/compiler.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePaths = {
  contractPath: path.join(packageRoot, "source", "pattern-contract.json"),
  svgPath: path.join(packageRoot, "source", "pattern.svg"),
  galleryShellPath: path.join(packageRoot, "source", "gallery-shell.html"),
};

async function temporaryDirectory(name) {
  return mkdtemp(path.join(os.tmpdir(), `visual-pattern-${name}-`));
}

test("compiles responsive derivatives, an accessible gallery, and a semantic companion", async () => {
  const root = await temporaryDirectory("compile");
  const result = await compileArtifactFamily({ ...sourcePaths, outputDir: path.join(root, "candidate") });
  assert.equal(result.manifest.outputs.length, 6);
  assert.equal(result.manifest.metadataStanding, "inspected_clean");
  assert.equal(result.manifest.sourceAdmission.standing, "static_self_contained");
  assert.deepEqual(result.manifest.resourceLimits, DEFAULT_RESOURCE_LIMITS);
  assert.equal(result.manifest.runtime.sharp, sharp.versions.sharp);
  assert.equal(result.manifest.runtime.libvips, sharp.versions.vips);
  assert.equal(result.manifest.runtime.node, process.versions.node);
  assert.equal(result.manifest.runtime.platform, process.platform);
  assert.equal(result.manifest.runtime.osRelease, os.release());
  assert.equal(result.manifest.runtime.architecture, process.arch);
  assert.equal(typeof result.manifest.runtime.libc.family, "string");
  assert.match(result.manifest.source.aggregateSha256, /^[a-f0-9]{64}$/u);
  assert.ok(result.measurement.inputBytes > 0);
  assert.ok(result.measurement.outputBytes > result.measurement.inputBytes);
  assert.ok(result.measurement.elapsedMilliseconds > 0);
  assert.ok(result.measurement.maxRssKiB > 0);
  assert.equal(result.measurement.derivativeWidths, 3);
  const gallery = await readFile(path.join(root, "candidate", "gallery.html"), "utf8");
  assert.match(gallery, /<picture>/);
  assert.match(gallery, /srcset="source-to-decision-route-640\.webp 640w, source-to-decision-route-1280\.webp 1280w, source-to-decision-route-1600\.webp 1600w"/);
  assert.match(gallery, /alt="Four connected panels/);
  assert.match(gallery, /Semantic companion/);
  const semantic = JSON.parse(await readFile(path.join(root, "candidate", "semantic-companion.json"), "utf8"));
  assert.deepEqual(semantic.readingOrder, ["source", "translation", "receiver", "receipt"]);
  for (const width of [640, 1280, 1600]) {
    const metadata = await sharp(path.join(root, "candidate", `source-to-decision-route-${width}.webp`)).metadata();
    assert.equal(metadata.width, width);
    assert.equal(metadata.height, Math.round(width * 720 / 1200));
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.icc, undefined);
    assert.equal(metadata.xmp, undefined);
  }
});

test("repeats exact bytes at one declared runtime coordinate", async () => {
  const root = await temporaryDirectory("repeat");
  const first = await compileArtifactFamily({ ...sourcePaths, outputDir: path.join(root, "first") });
  const second = await compileArtifactFamily({ ...sourcePaths, outputDir: path.join(root, "second") });
  assert.equal(first.manifestDigest, second.manifestDigest);
  assert.deepEqual(first.manifest, second.manifest);
  for (const output of first.manifest.outputs) {
    assert.deepEqual(
      await readFile(path.join(root, "first", output.path)),
      await readFile(path.join(root, "second", output.path)),
      output.path,
    );
  }
});

test("orders manifest paths by locale-independent ordinal identity", () => {
  const candidates = ["éclair.webp", "zeta.webp", "Alpha.webp", "Älpha.webp", "alpha.webp", "Zeta.webp"];
  const expected = ["Alpha.webp", "Zeta.webp", "alpha.webp", "zeta.webp", "Älpha.webp", "éclair.webp"];
  assert.deepEqual([...candidates].sort(compareOrdinalText), expected);

  const compilerUrl = new URL("../src/compiler.mjs", import.meta.url).href;
  const program = `import {compareOrdinalText} from ${JSON.stringify(compilerUrl)}; console.log(JSON.stringify(${JSON.stringify(candidates)}.sort(compareOrdinalText)));`;
  const observations = ["C", "tr_TR.UTF-8"].map((locale) => {
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", program], {
      encoding: "utf8",
      env: { ...process.env, LANG: locale, LC_ALL: locale },
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  });
  assert.deepEqual(observations, [expected, expected]);
});

test("one compiler atomically owns a fresh output directory", async () => {
  const root = await temporaryDirectory("concurrent-compile");
  const outputDir = path.join(root, "nested", "candidate");
  const results = await Promise.allSettled([
    compileArtifactFamily({ ...sourcePaths, outputDir }),
    compileArtifactFamily({ ...sourcePaths, outputDir }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejection = results.find((result) => result.status === "rejected");
  assert.ok(rejection);
  assert.ok(rejection.reason instanceof VisualArtifactError);
  assert.equal(rejection.reason.code, "output_exists");
  assert.equal((await readdir(outputDir)).includes("manifest.json"), true);
});

test("admits unique SVG references and protects connector painter order", async () => {
  const source = await readFile(sourcePaths.svgPath, "utf8");
  const inspection = validateSvg(source);
  assert.equal(inspection.connectorBeforeCards, true);
  assert.ok(inspection.ids.includes("vf-arrow"));
  assert.ok(inspection.references.includes("vf-arrow"));
  const repeated = await readFile(path.join(packageRoot, "fixtures", "rejected", "repeated-id.svg"), "utf8");
  assert.throws(() => validateSvg(repeated), (error) => error instanceof VisualArtifactError && error.code === "repeated_svg_id");
});

test("admits only script-independent SVG and gallery-shell sources", async () => {
  const svg = await readFile(sourcePaths.svgPath, "utf8");
  const galleryShell = await readFile(sourcePaths.galleryShellPath, "utf8");
  const cases = JSON.parse(await readFile(path.join(packageRoot, "fixtures", "rejected", "source-admission-cases.json"), "utf8"));
  assert.equal(validateGalleryShell(galleryShell).scriptIndependent, true);
  for (const fixture of cases.svg) {
    assert.ok(svg.includes(fixture.needle), fixture.id);
    const candidate = svg.replace(fixture.needle, fixture.replacement);
    assert.throws(
      () => validateSvg(candidate),
      (error) => error instanceof VisualArtifactError && error.code === fixture.expectedCode,
      fixture.id,
    );
  }
  for (const fixture of cases.galleryShell) {
    assert.ok(galleryShell.includes(fixture.needle), fixture.id);
    const candidate = galleryShell.replace(fixture.needle, fixture.replacement);
    assert.throws(
      () => validateGalleryShell(candidate),
      (error) => error instanceof VisualArtifactError && error.code === fixture.expectedCode,
      fixture.id,
    );
  }
});

test("rejects an active gallery shell before creating a candidate boundary", async () => {
  const root = await temporaryDirectory("active-gallery");
  const galleryShell = await readFile(sourcePaths.galleryShellPath, "utf8");
  const cases = JSON.parse(await readFile(path.join(packageRoot, "fixtures", "rejected", "source-admission-cases.json"), "utf8"));
  const fixture = cases.galleryShell.find((entry) => entry.id === "script-element");
  const activeShellPath = path.join(root, "active-gallery-shell.html");
  const outputDir = path.join(root, "candidate");
  await writeFile(activeShellPath, galleryShell.replace(fixture.needle, fixture.replacement));
  await assert.rejects(
    compileArtifactFamily({ ...sourcePaths, galleryShellPath: activeShellPath, outputDir }),
    (error) => error instanceof VisualArtifactError && error.code === "active_source_content",
  );
  await assert.rejects(readdir(outputDir), (error) => error.code === "ENOENT");
});

test("returns typed contract rejections for missing meaning and escaped output names", async () => {
  const missingAlt = JSON.parse(await readFile(path.join(packageRoot, "fixtures", "rejected", "missing-alt.json"), "utf8"));
  const escaped = JSON.parse(await readFile(path.join(packageRoot, "fixtures", "rejected", "path-escape.json"), "utf8"));
  assert.throws(() => validateContract(missingAlt), (error) => error instanceof VisualArtifactError && error.code === "missing_text");
  assert.throws(() => validateContract(escaped), (error) => error instanceof VisualArtifactError && error.code === "unsafe_output_name");
});

test("returns every contract mutation to its named recovery boundary", async () => {
  const base = JSON.parse(await readFile(sourcePaths.contractPath, "utf8"));
  const mutations = JSON.parse(await readFile(path.join(packageRoot, "fixtures", "rejected", "contract-mutations.json"), "utf8"));
  for (const mutation of mutations) {
    const candidate = structuredClone(base);
    Object.assign(candidate, mutation.replace);
    assert.throws(
      () => validateContract(candidate),
      (error) => error instanceof VisualArtifactError && error.code === mutation.expectedCode,
      mutation.id,
    );
  }
});

test("enforces source, semantic-state, width, pixel, and output ceilings before rendering", async () => {
  const contract = JSON.parse(await readFile(sourcePaths.contractPath, "utf8"));
  const expectation = JSON.parse(await readFile(path.join(packageRoot, "expected", "contract-expectation.json"), "utf8"));
  assert.deepEqual(DEFAULT_RESOURCE_LIMITS, expectation.resourceLimits);
  const contractCases = [
    { resource: "states", limits: { states: contract.states.length - 1 } },
    { resource: "widths", limits: { widths: contract.widths.length - 1 } },
    { resource: "intrinsicPixels", limits: { intrinsicPixels: 1 } },
    { resource: "derivativePixels", limits: { derivativePixels: 1 } },
  ];
  for (const fixture of contractCases) {
    assert.throws(
      () => validateContract(contract, { limits: fixture.limits }),
      (error) => error instanceof VisualArtifactError
        && error.code === "resource_limit_exceeded"
        && error.details.resource === fixture.resource,
      fixture.resource,
    );
  }

  const sourceRoot = await temporaryDirectory("source-limit");
  const sourceOutput = path.join(sourceRoot, "candidate");
  await assert.rejects(
    compileArtifactFamily({ ...sourcePaths, outputDir: sourceOutput, limits: { svgBytes: 1 } }),
    (error) => error instanceof VisualArtifactError
      && error.code === "resource_limit_exceeded"
      && error.details.resource === "svgBytes",
  );
  await assert.rejects(readdir(sourceOutput), (error) => error.code === "ENOENT");

  const outputRoot = await temporaryDirectory("output-limit");
  const boundedOutput = path.join(outputRoot, "candidate");
  await assert.rejects(
    compileArtifactFamily({ ...sourcePaths, outputDir: boundedOutput, limits: { outputBytes: 1 } }),
    (error) => error instanceof VisualArtifactError
      && error.code === "resource_limit_exceeded"
      && error.details.resource === "outputBytes",
  );
  await assert.rejects(readdir(boundedOutput), (error) => error.code === "ENOENT");

  const galleryShell = await readFile(sourcePaths.galleryShellPath, "utf8");
  const galleryWithCandidates = galleryShell.replace(
    "{{PICTURE}}",
    '<img srcset="#candidate-one 1x, #candidate-two 2x" alt="synthetic bounded-source fixture" />\n    {{PICTURE}}',
  );
  assert.throws(
    () => validateGalleryShell(galleryWithCandidates, { limits: { sourceReferences: 1 } }),
    (error) => error instanceof VisualArtifactError
      && error.code === "resource_limit_exceeded"
      && error.details.resource === "sourceReferences",
  );
});

test("publication clears a partial render and reports its durable checkpoint", async () => {
  const root = await temporaryDirectory("render-interruption");
  const publicationRoot = path.join(root, "publication");
  await assert.rejects(
    publishArtifactFamily({ ...sourcePaths, publicationRoot, faultAt: "after_first_derivative" }),
    (error) => error instanceof VisualArtifactError && error.details.checkpoint === "first_derivative_written",
  );
  assert.deepEqual(await readdir(path.join(publicationRoot, ".candidates")), []);
});

test("gallery admission requires the semantic companion marker", async () => {
  const root = await temporaryDirectory("gallery-companion");
  const publicationRoot = path.join(root, "publication");
  const galleryShellPath = path.join(packageRoot, "fixtures", "rejected", "missing-semantic-companion.html");
  await assert.rejects(
    publishArtifactFamily({ ...sourcePaths, galleryShellPath, publicationRoot }),
    (error) => error instanceof VisualArtifactError && error.code === "missing_gallery_marker",
  );
  assert.deepEqual(await readdir(path.join(publicationRoot, ".candidates")), []);
});

test("keeps the accepted pointer stable when publication stops before promotion", async () => {
  const root = await temporaryDirectory("publish");
  const publicationRoot = path.join(root, "publication");
  const first = await publishArtifactFamily({ ...sourcePaths, publicationRoot });
  const pointerPath = path.join(publicationRoot, "accepted-pointer.json");
  const firstPointer = await readFile(pointerPath, "utf8");

  const changedContract = JSON.parse(await readFile(sourcePaths.contractPath, "utf8"));
  changedContract.caption = "A successor caption creates a distinct candidate coordinate.";
  const changedContractPath = path.join(root, "changed-contract.json");
  await writeFile(changedContractPath, `${JSON.stringify(changedContract, null, 2)}\n`);
  await assert.rejects(
    publishArtifactFamily({ ...sourcePaths, contractPath: changedContractPath, publicationRoot, faultAt: "after_accept_before_pointer" }),
    (error) => error instanceof VisualArtifactError && error.code === "injected_fault" && error.details.checkpoint === "accepted_bytes_verified",
  );
  assert.equal(await readFile(pointerPath, "utf8"), firstPointer);

  const successor = await publishArtifactFamily({ ...sourcePaths, contractPath: changedContractPath, publicationRoot });
  assert.notEqual(successor.manifestDigest, first.manifestDigest);
  assert.equal(JSON.parse(await readFile(pointerPath, "utf8")).manifestDigest, successor.manifestDigest);
});

test("keeps a concurrently promoted digest valid when its creating publisher faults", async () => {
  const root = await temporaryDirectory("concurrent-publish");
  const publicationRoot = path.join(root, "publication");
  let releaseCreator;
  const creatorCanFault = new Promise((resolve) => { releaseCreator = resolve; });
  let acceptedCreated;
  const acceptedCreatedSignal = new Promise((resolve) => { acceptedCreated = resolve; });

  const creator = publishArtifactFamily({
    ...sourcePaths,
    publicationRoot,
    faultAt: "after_accept_before_pointer",
    checkpointObserver: async ({ checkpoint }) => {
      assert.equal(checkpoint, "accepted_bytes_verified");
      acceptedCreated();
      await creatorCanFault;
    },
  });

  await acceptedCreatedSignal;
  let reuser;
  try {
    reuser = await publishArtifactFamily({ ...sourcePaths, publicationRoot });
  } finally {
    releaseCreator();
  }
  await assert.rejects(
    creator,
    (error) => error instanceof VisualArtifactError
      && error.code === "injected_fault"
      && error.details.checkpoint === "accepted_bytes_verified",
  );

  const pointerPath = path.join(publicationRoot, "accepted-pointer.json");
  const pointer = JSON.parse(await readFile(pointerPath, "utf8"));
  assert.equal(pointer.manifestDigest, reuser.manifestDigest);
  assert.equal(pointer.relativePath, path.posix.join("accepted", reuser.manifestDigest));
  const acceptedManifestPath = path.join(publicationRoot, pointer.relativePath, "manifest.json");
  const acceptedManifest = JSON.parse(await readFile(acceptedManifestPath, "utf8"));
  assert.equal(acceptedManifest.artifactId, reuser.contract.artifactId);
  assert.deepEqual(await readdir(path.join(publicationRoot, ".candidates")), []);
});

test("rejects a corrupted preexisting accepted directory and preserves the pointer", async () => {
  const root = await temporaryDirectory("corrupted-accepted");
  const publicationRoot = path.join(root, "publication");
  const first = await publishArtifactFamily({ ...sourcePaths, publicationRoot });
  const pointerPath = path.join(publicationRoot, "accepted-pointer.json");
  const firstPointer = await readFile(pointerPath, "utf8");
  const replay = await publishArtifactFamily({ ...sourcePaths, publicationRoot });
  assert.deepEqual(replay.pointer, first.pointer);
  const corruptedPath = path.join(
    publicationRoot,
    "accepted",
    first.manifestDigest,
    "semantic-companion.json",
  );
  await writeFile(corruptedPath, "{\"corrupted\":true}\n");

  await assert.rejects(
    publishArtifactFamily({ ...sourcePaths, publicationRoot }),
    (error) => error instanceof VisualArtifactError
      && error.code === "accepted_integrity_mismatch"
      && error.details.checkpoint === "existing_accepted_verified"
      && error.details.relativePath === "semantic-companion.json",
  );
  assert.equal(await readFile(pointerPath, "utf8"), firstPointer);
  assert.equal(await readFile(corruptedPath, "utf8"), "{\"corrupted\":true}\n");
});
