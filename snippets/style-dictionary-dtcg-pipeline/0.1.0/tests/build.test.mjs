import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_LIMITS, PipelineError, sha256, stableStringify } from "../src/contract.mjs";
import { promoteCandidate, readAcceptedPointer } from "../src/publication.mjs";
import { buildCandidates } from "../tools/build-candidates.mjs";
import { createManifest } from "../tools/make-manifest.mjs";
import { loadCoordinate } from "../tools/load-coordinate.mjs";
import { verifyGenerated } from "../tools/verify-generated.mjs";

async function temporaryRoot(name) {
  return mkdtemp(join(tmpdir(), `${name}-`));
}

test("two clean builds produce byte-identical artifact inventories", async t => {
  const left = await temporaryRoot("dtcg-left");
  const right = await temporaryRoot("dtcg-right");
  t.after(async () => Promise.all([rm(left, { recursive: true, force: true }), rm(right, { recursive: true, force: true })]));
  await buildCandidates({ outputRoot: left });
  await buildCandidates({ outputRoot: right });
  const [leftManifest, rightManifest] = await Promise.all([
    createManifest({ outputRoot: left }),
    createManifest({ outputRoot: right }),
  ]);
  assert.deepEqual(leftManifest.artifacts, rightManifest.artifacts);
  assert.equal(leftManifest.sourceDigest, rightManifest.sourceDigest);
  assert.deepEqual(leftManifest.sourceInputs, rightManifest.sourceInputs);
  assert.equal(leftManifest.sourceInputs.length, 4);
  assert.equal(leftManifest.manifestDigest, rightManifest.manifestDigest);
  assert.equal(leftManifest.artifactCount, 12);
  assert.deepEqual(leftManifest.compiler, { package: "style-dictionary", version: "5.7.0" });
});

test("manifest creation rejects a captured source changed after the build", async t => {
  const root = await temporaryRoot("dtcg-captured-source-drift");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: root });
  const inputPath = resolve(root, "inputs/acme-light.tokens.json");
  const captured = JSON.parse(await readFile(inputPath, "utf8"));
  captured.$description = `${captured.$description} altered after build`;
  await writeFile(inputPath, stableStringify(captured), "utf8");

  await assert.rejects(
    createManifest({ outputRoot: root }),
    error => error instanceof PipelineError && error.code === "SOURCE_DRIFT",
  );
});

test("manifest creation rejects authored source drift after candidate capture", async t => {
  const root = await temporaryRoot("dtcg-live-source-drift");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: root });

  await assert.rejects(
    createManifest({
      outputRoot: root,
      sourceLoader: async coordinate => {
        const loaded = await loadCoordinate(coordinate);
        if (coordinate.brand === "acme" && coordinate.mode === "light") {
          loaded.document.$description = `${loaded.document.$description} changed live source`;
        }
        return loaded;
      },
    }),
    error => error instanceof PipelineError && error.code === "SOURCE_DRIFT",
  );
});

test("manifest creation rejects a sparse captured source before reading its body", async t => {
  const root = await temporaryRoot("dtcg-sparse-captured-source");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: root });
  await truncate(resolve(root, "inputs/acme-light.tokens.json"), DEFAULT_LIMITS.sourceBytes + 1);

  await assert.rejects(
    createManifest({ outputRoot: root }),
    error => error instanceof PipelineError
      && error.code === "RESOURCE_ENVELOPE_EXCEEDED"
      && error.details.dimension === "source_bytes",
  );
});

test("manifest creation returns the typed depth boundary before canonical serialization", async t => {
  const root = await temporaryRoot("dtcg-deep-captured-source");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: root });
  let document = { leaf: { $type: "number", $value: 1 } };
  for (let index = 0; index < 100; index += 1) document = { branch: document };
  await writeFile(resolve(root, "inputs/acme-light.tokens.json"), `${JSON.stringify(document)}\n`, "utf8");

  await assert.rejects(
    createManifest({ outputRoot: root }),
    error => error instanceof PipelineError
      && error.code === "RESOURCE_ENVELOPE_EXCEEDED"
      && error.details.dimension === "depth",
  );
});

test("manifest creation rejects a symlinked captured source", async t => {
  const root = await temporaryRoot("dtcg-symlinked-captured-source");
  const outputRoot = resolve(root, "candidate");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot });
  const sourcePath = resolve(outputRoot, "inputs/acme-light.tokens.json");
  const outsidePath = resolve(root, "outside-source.json");
  await writeFile(outsidePath, await readFile(sourcePath));
  await rm(sourcePath);
  await symlink(outsidePath, sourcePath);

  await assert.rejects(
    createManifest({ outputRoot }),
    /captured source acme-light must be a regular file/u,
  );
});

test("the stable manifest coordinate binds both downstream receivers", async t => {
  const root = await temporaryRoot("dtcg-receiver-coordinate");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: root });
  const manifest = await createManifest({ outputRoot: root });
  const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const snippetsRoot = resolve(packageRoot, "../..");
  const receiver = JSON.parse(await readFile(
    resolve(snippetsRoot, "react-aria-visual-contract-receiver/0.1.0/source/token-coordinate.json"),
    "utf8",
  ));
  const observer = JSON.parse(await readFile(
    resolve(snippetsRoot, "cross-browser-visual-contract-observer/0.1.0/source/coordinates.json"),
    "utf8",
  ));
  assert.equal(receiver.acceptedCoordinate.manifestSha256, manifest.manifestDigest);
  assert.equal(observer.tokenSource.manifestSha256, manifest.manifestDigest);
});

test("generated CSS, JavaScript, and declarations carry matching representative state", async t => {
  const root = await temporaryRoot("dtcg-targets");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: root });
  const css = await readFile(resolve(root, "acme-light/tokens.css"), "utf8");
  const javascript = await readFile(resolve(root, "acme-light/tokens.js"), "utf8");
  const declarations = await readFile(resolve(root, "acme-light/tokens.d.ts"), "utf8");
  assert.match(css, /--component-action-button-focus-ring:/u);
  assert.match(css, /--layout-select-caret-inset:/u);
  assert.match(javascript, /"component\.select\.caret-inset-inline-end"/u);
  assert.match(declarations, /"component\.select\.caret-inset-inline-end"/u);
});

test("verification reads generated modules as static data and leaves side effects inert", async t => {
  const root = await temporaryRoot("dtcg-static-verification");
  t.after(async () => {
    Reflect.deleteProperty(globalThis, "__syntheticGeneratedSideEffect");
    await rm(root, { recursive: true, force: true });
  });
  await buildCandidates({ outputRoot: root });
  const target = resolve(root, "acme-dark/tokens.js");
  const original = await readFile(target, "utf8");
  await writeFile(
    target,
    `${original}globalThis.__syntheticGeneratedSideEffect = "executed";\n`,
    "utf8",
  );

  await assert.rejects(
    verifyGenerated({ outputRoot: root }),
    /JavaScript requires the complete generated static-module structure/u,
  );
  assert.equal(globalThis.__syntheticGeneratedSideEffect, undefined);
});

test("verification rejects a generated-file symlink that targets outside the output root", async t => {
  const root = await temporaryRoot("dtcg-symlink-verification");
  const outputRoot = resolve(root, "candidate");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot });
  const target = resolve(outputRoot, "acme-dark/tokens.js");
  const escapedTarget = resolve(root, "outside-tokens.js");
  await writeFile(escapedTarget, await readFile(target));
  await rm(target);
  await symlink(escapedTarget, target);

  await assert.rejects(
    verifyGenerated({ outputRoot }),
    /must be a regular file/u,
  );
});

test("verification rejects a sparse generated artifact before reading its body", async t => {
  const root = await temporaryRoot("dtcg-sparse-generated-verification");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: root });
  await truncate(resolve(root, "acme-dark/tokens.css"), DEFAULT_LIMITS.generatedBytes + 1);

  await assert.rejects(
    verifyGenerated({ outputRoot: root }),
    error => error instanceof PipelineError
      && error.code === "RESOURCE_ENVELOPE_EXCEEDED"
      && error.details.dimension === "generated_bytes",
  );
});

test("promotion rejects an intermediate candidate-directory symlink", async t => {
  const root = await temporaryRoot("dtcg-promotion-directory-symlink");
  const candidate = resolve(root, "candidate");
  const outside = resolve(root, "outside-coordinate");
  const accepted = resolve(root, "accepted");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: candidate });
  const manifest = await createManifest({ outputRoot: candidate });
  await cp(resolve(candidate, "acme-light"), outside, { recursive: true });
  await rm(resolve(candidate, "acme-light"), { recursive: true });
  await symlink(outside, resolve(candidate, "acme-light"));

  await assert.rejects(
    promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest }),
    /must traverse regular directories/u,
  );
  await assert.rejects(readAcceptedPointer(accepted), error => error.code === "ENOENT");
});

test("candidate building preserves a caller directory that already contains material", async t => {
  const root = await temporaryRoot("dtcg-occupied-candidate");
  const sentinel = resolve(root, "caller-material.txt");
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(sentinel, "preserve me", "utf8");

  await assert.rejects(
    buildCandidates({ outputRoot: root }),
    /empty caller-selected directory/u,
  );
  assert.equal(await readFile(sentinel, "utf8"), "preserve me");
});

test("candidate building gives one invocation ownership of an empty output directory", async t => {
  const root = await temporaryRoot("dtcg-owned-candidate");
  t.after(() => rm(root, { recursive: true, force: true }));
  let releaseFirstCoordinate;
  let signalFirstCoordinate;
  const firstCoordinateReached = new Promise(resolveReached => {
    signalFirstCoordinate = resolveReached;
  });
  const continueFirstBuild = new Promise(resolveContinue => {
    releaseFirstCoordinate = resolveContinue;
  });
  let paused = false;
  const first = buildCandidates({
    outputRoot: root,
    beforeCoordinate: async () => {
      if (paused) return;
      paused = true;
      signalFirstCoordinate();
      await continueFirstBuild;
    },
  });
  await firstCoordinateReached;

  await assert.rejects(
    buildCandidates({ outputRoot: root }),
    /empty caller-selected directory/u,
  );
  releaseFirstCoordinate();
  const result = await first;
  assert.equal(result.built.length, 4);
});

test("promotion moves one pointer after complete verification", async t => {
  const root = await temporaryRoot("dtcg-promotion");
  const candidate = resolve(root, "candidate");
  const accepted = resolve(root, "accepted");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: candidate });
  const manifest = await createManifest({ outputRoot: candidate });
  const pointer = await promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest });
  assert.deepEqual(await readAcceptedPointer(accepted), pointer);
  assert.deepEqual(
    await promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest }),
    pointer,
  );
  await assert.rejects(
    readFile(resolve(accepted, "artifacts", manifest.manifestDigest, "inputs", "acme-light.tokens.json")),
    error => error.code === "ENOENT",
  );

  const candidateManifest = structuredClone(manifest);
  delete candidateManifest.manifestDigest;
  candidateManifest.formatProfile = `${candidateManifest.formatProfile} synthetic alternate`;
  candidateManifest.manifestDigest = sha256(stableStringify(candidateManifest));
  await assert.rejects(
    promoteCandidate({
      candidateRoot: candidate,
      acceptedRoot: accepted,
      manifest: candidateManifest,
      injectFault: "before_pointer",
    }),
    /injected promotion fault/u,
  );
  assert.deepEqual(await readAcceptedPointer(accepted), pointer);
  assert.deepEqual(
    JSON.parse(await readFile(resolve(accepted, "artifacts", candidateManifest.manifestDigest, "manifest.json"), "utf8")),
    candidateManifest,
  );

  await assert.rejects(
    promoteCandidate({
      candidateRoot: candidate,
      acceptedRoot: accepted,
      manifest: candidateManifest,
      injectFault: "after_pointer_write",
    }),
    /injected promotion fault/u,
  );
  assert.deepEqual(await readAcceptedPointer(accepted), pointer);
  assert.deepEqual((await readdir(accepted)).filter(name => name.startsWith(".current-")), []);

  await assert.rejects(
    promoteCandidate({
      candidateRoot: candidate,
      acceptedRoot: accepted,
      manifest: { ...manifest, manifestDigest: "../outside" },
    }),
    /lowercase SHA-256/u,
  );
});

test("promotion rejects an over-count manifest before staging artifact paths", async t => {
  const root = await temporaryRoot("dtcg-promotion-count-envelope");
  const candidate = resolve(root, "candidate");
  const accepted = resolve(root, "accepted");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: candidate });
  const manifest = await createManifest({ outputRoot: candidate });
  const oversized = structuredClone(manifest);
  oversized.artifacts = Array.from({ length: DEFAULT_LIMITS.generatedFiles + 1 }, (_, index) => ({
    coordinate: "synthetic",
    path: `synthetic/${index}.css`,
    bytes: 0,
    sha256: sha256(""),
  }));
  oversized.artifactCount = oversized.artifacts.length;
  oversized.generatedBytes = 0;
  delete oversized.manifestDigest;
  oversized.manifestDigest = sha256(stableStringify(oversized));

  await assert.rejects(
    promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest: oversized }),
    /artifact count exceeds the configured envelope/u,
  );
  await assert.rejects(readAcceptedPointer(accepted), error => error.code === "ENOENT");
});

test("promotion rejects captured-input tampering before accepted staging", async t => {
  const root = await temporaryRoot("dtcg-promotion-input-drift");
  const candidate = resolve(root, "candidate");
  const accepted = resolve(root, "accepted");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: candidate });
  const manifest = await createManifest({ outputRoot: candidate });
  const sourcePath = resolve(candidate, manifest.sourceInputs[0].candidatePath);
  await writeFile(sourcePath, `${await readFile(sourcePath, "utf8")} `, "utf8");

  await assert.rejects(
    promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest }),
    /candidate source .* bytes differ from the manifest/u,
  );
  await assert.rejects(readAcceptedPointer(accepted), error => error.code === "ENOENT");
});

test("concurrent replay keeps invocation-owned staging separate and promotes one complete coordinate", async t => {
  const root = await temporaryRoot("dtcg-concurrent-promotion");
  const candidate = resolve(root, "candidate");
  const accepted = resolve(root, "accepted");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: candidate });
  const manifest = await createManifest({ outputRoot: candidate });

  const pointers = await Promise.all(
    Array.from({ length: 4 }, () => promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest })),
  );

  for (const pointer of pointers) assert.deepEqual(pointer, pointers[0]);
  assert.deepEqual(await readAcceptedPointer(accepted), pointers[0]);
  assert.deepEqual(
    (await readdir(resolve(accepted, "artifacts"))).sort(),
    [manifest.manifestDigest],
  );
});

test("promotion rejects a corrupted preexisting digest directory and preserves the pointer", async t => {
  const root = await temporaryRoot("dtcg-existing-integrity");
  const candidate = resolve(root, "candidate");
  const accepted = resolve(root, "accepted");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: candidate });
  const manifest = await createManifest({ outputRoot: candidate });
  const pointer = await promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest });
  const corruptedPath = resolve(accepted, "artifacts", manifest.manifestDigest, "acme-light", "tokens.css");
  await writeFile(corruptedPath, ":root { --corrupted: true; }\n", "utf8");

  await assert.rejects(
    promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest }),
    /artifact destination integrity mismatch: acme-light\/tokens\.css bytes differ/u,
  );
  assert.deepEqual(await readAcceptedPointer(accepted), pointer);
  assert.equal(await readFile(corruptedPath, "utf8"), ":root { --corrupted: true; }\n");
});

test("promotion rejects a symlinked preexisting digest directory", async t => {
  const root = await temporaryRoot("dtcg-existing-destination-symlink");
  const candidate = resolve(root, "candidate");
  const outsideAccepted = resolve(root, "outside-accepted");
  const accepted = resolve(root, "accepted");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: candidate });
  const manifest = await createManifest({ outputRoot: candidate });
  await promoteCandidate({ candidateRoot: candidate, acceptedRoot: outsideAccepted, manifest });
  await cp(resolve(outsideAccepted, "artifacts"), resolve(accepted, "artifacts"), { recursive: true });
  await rm(resolve(accepted, "artifacts", manifest.manifestDigest), { recursive: true });
  await symlink(
    resolve(outsideAccepted, "artifacts", manifest.manifestDigest),
    resolve(accepted, "artifacts", manifest.manifestDigest),
  );

  await assert.rejects(
    promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest }),
    /artifact destination integrity root must be a regular directory/u,
  );
  await assert.rejects(readAcceptedPointer(accepted), error => error.code === "ENOENT");
});

test("the build awaits each asynchronous coordinate hook", async t => {
  const root = await temporaryRoot("dtcg-async-hook");
  t.after(() => rm(root, { recursive: true, force: true }));
  const observed = [];
  const result = await buildCandidates({
    outputRoot: root,
    beforeCoordinate: async ({ coordinate }) => {
      await new Promise(resolveDelay => setTimeout(resolveDelay, 2));
      observed.push(coordinate);
    },
  });
  assert.deepEqual(observed, result.built.map(entry => entry.coordinate));
  assert.deepEqual(result.observation.runtime, {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
  });
  assert.equal(result.built.length, 4);
  assert.equal(result.observation.coordinates, 4);
  assert.equal(result.observation.platforms, 2);
  assert.equal(result.observation.generatedFilesExpected, 12);
  assert.ok(result.observation.sourceBytes > 0);
  assert.ok(result.observation.elapsedMilliseconds > 0);
  assert.ok(result.observation.peakRssBytes > 0);
});
