import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_LIMITS,
  PipelineError,
  readBoundedFile,
  readJson,
  sha256,
  stableStringify,
} from "../src/contract.mjs";
import { promoteCandidate, readAcceptedPointer } from "../src/publication.mjs";
import { buildCandidates } from "../tools/build-candidates.mjs";
import { createManifest } from "../tools/make-manifest.mjs";
import { loadCoordinate } from "../tools/load-coordinate.mjs";
import { verifyGenerated } from "../tools/verify-generated.mjs";

async function temporaryRoot(name) {
  return mkdtemp(join(tmpdir(), `${name}-`));
}

function alternateManifest(manifest, suffix) {
  const alternate = structuredClone(manifest);
  delete alternate.manifestDigest;
  alternate.formatProfile = `${alternate.formatProfile} ${suffix}`;
  alternate.manifestDigest = sha256(stableStringify(alternate));
  return alternate;
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

test("authored source admission rejects a symbolic-link coordinate", async t => {
  const root = await temporaryRoot("dtcg-symlinked-authored-source");
  t.after(() => rm(root, { recursive: true, force: true }));
  const outsidePath = resolve(root, "outside-source.json");
  const linkedPath = resolve(root, "linked-source.json");
  await writeFile(outsidePath, '{"token":{"$type":"number","$value":1}}\n', "utf8");
  await symlink(outsidePath, linkedPath);

  await assert.rejects(
    readJson(linkedPath),
    error => error instanceof PipelineError && error.code === "REGULAR_FILE_REQUIRED",
  );
});

test("bounded source capture rejects a path replaced before descriptor ownership", async () => {
  const pathEntry = {
    dev: 1,
    ino: 10,
    size: 1,
    isFile: () => true,
    isSymbolicLink: () => false,
  };
  let closed = false;
  const fileSystem = {
    lstat: async () => pathEntry,
    open: async () => ({
      stat: async () => ({ ...pathEntry, ino: 11 }),
      close: async () => { closed = true; },
    }),
  };

  await assert.rejects(
    readBoundedFile("synthetic-source.json", { maxBytes: 1, fileSystem }),
    error => error instanceof PipelineError && error.code === "SOURCE_FILE_CHANGED",
  );
  assert.equal(closed, true);
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
  await assert.rejects(
    readAcceptedPointer(accepted),
    error => error instanceof PipelineError
      && error.code === "SOURCE_FILE_UNREADABLE"
      && error.details.stage === "accepted_pointer"
      && error.details.restartFrom === "promotion",
  );
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

  const candidateManifest = alternateManifest(manifest, "synthetic alternate");
  await assert.rejects(
    promoteCandidate({
      candidateRoot: candidate,
      acceptedRoot: accepted,
      manifest: candidateManifest,
      injectFault: "after_copy",
    }),
    /injected promotion fault/u,
  );
  assert.deepEqual(await readAcceptedPointer(accepted), pointer);
  await assert.rejects(
    readFile(resolve(accepted, "artifacts", candidateManifest.manifestDigest, "manifest.json")),
    error => error.code === "ENOENT",
  );

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

test("promotion admits the manifest as plain data before reading its fields", async t => {
  const root = await temporaryRoot("dtcg-manifest-data-admission");
  const candidate = resolve(root, "candidate");
  const accepted = resolve(root, "accepted");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: candidate });
  const manifest = await createManifest({ outputRoot: candidate });

  let getterCalls = 0;
  const accessorManifest = structuredClone(manifest);
  Object.defineProperty(accessorManifest, "manifestDigest", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return manifest.manifestDigest;
    },
  });
  await assert.rejects(
    promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest: accessorManifest }),
    /plain data object/u,
  );
  assert.equal(getterCalls, 0);

  const symbolManifest = structuredClone(manifest);
  symbolManifest[Symbol("hidden authority")] = true;
  await assert.rejects(
    promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest: symbolManifest }),
    /plain data object/u,
  );

  const customPrototypeManifest = Object.assign(
    Object.create({ inheritedAuthority: true }),
    structuredClone(manifest),
  );
  await assert.rejects(
    promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest: customPrototypeManifest }),
    /plain data object/u,
  );

  const hiddenFieldManifest = structuredClone(manifest);
  Object.defineProperty(hiddenFieldManifest, "hiddenAuthority", {
    enumerable: false,
    value: true,
  });
  await assert.rejects(
    promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest: hiddenFieldManifest }),
    /plain data object/u,
  );

  const accessorMatrix = structuredClone(manifest);
  let matrixGetterCalls = 0;
  Object.defineProperty(accessorMatrix.matrix, "0", {
    enumerable: true,
    get() {
      matrixGetterCalls += 1;
      return manifest.matrix[0];
    },
  });
  await assert.rejects(
    promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest: accessorMatrix }),
    /dense data array/u,
  );
  assert.equal(matrixGetterCalls, 0);
  await assert.rejects(readAcceptedPointer(accepted), error => (
    error instanceof PipelineError
    && error.code === "SOURCE_FILE_UNREADABLE"
    && error.details.stage === "accepted_pointer"
  ));
});

test("promotion rejects an accepted-root identity swap before candidate rename", async t => {
  const root = await temporaryRoot("dtcg-promotion-root-swap");
  const candidate = resolve(root, "candidate");
  const accepted = resolve(root, "accepted");
  const heldAccepted = resolve(root, "accepted-held");
  const outside = resolve(root, "outside");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: candidate });
  const manifest = await createManifest({ outputRoot: candidate });
  await mkdir(outside);

  await assert.rejects(
    promoteCandidate({
      candidateRoot: candidate,
      acceptedRoot: accepted,
      manifest,
      injectFault: async ({ checkpoint }) => {
        if (checkpoint !== "before_candidate_rename") return;
        await rename(accepted, heldAccepted);
        await symlink(outside, accepted);
      },
    }),
    error => error instanceof PipelineError
      && error.code === "PUBLICATION_BOUNDARY_INVALID"
      && error.details.boundary === "accepted_root",
  );
  assert.deepEqual(await readdir(outside), []);
  await rm(accepted);
  await rename(heldAccepted, accepted);
  await assert.rejects(readAcceptedPointer(accepted), error => (
    error instanceof PipelineError
    && error.code === "SOURCE_FILE_UNREADABLE"
    && error.details.stage === "accepted_pointer"
  ));
});

test("promotion rejects symbolic links at its accepted root and artifacts child", async t => {
  const root = await temporaryRoot("dtcg-promotion-static-boundaries");
  const candidate = resolve(root, "candidate");
  const accepted = resolve(root, "accepted");
  const outside = resolve(root, "outside");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: candidate });
  const manifest = await createManifest({ outputRoot: candidate });
  await mkdir(outside);
  await symlink(outside, accepted);

  await assert.rejects(
    promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest }),
    error => error instanceof PipelineError
      && error.code === "PUBLICATION_BOUNDARY_INVALID"
      && error.details.boundary === "accepted_root",
  );
  await rm(accepted);
  await mkdir(accepted);
  await symlink(outside, resolve(accepted, "artifacts"));
  await assert.rejects(
    promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest }),
    error => error instanceof PipelineError
      && error.code === "PUBLICATION_BOUNDARY_INVALID"
      && error.details.boundary === "accepted_artifacts_root",
  );
  assert.deepEqual(await readdir(outside), []);
});

test("promotion rejects an artifacts-directory identity swap before candidate rename", async t => {
  const root = await temporaryRoot("dtcg-promotion-artifacts-swap");
  const candidate = resolve(root, "candidate");
  const accepted = resolve(root, "accepted");
  const heldArtifacts = resolve(root, "artifacts-held");
  const outside = resolve(root, "outside");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: candidate });
  const manifest = await createManifest({ outputRoot: candidate });
  await mkdir(outside);

  await assert.rejects(
    promoteCandidate({
      candidateRoot: candidate,
      acceptedRoot: accepted,
      manifest,
      injectFault: async ({ checkpoint, artifactsRoot }) => {
        if (checkpoint !== "before_candidate_rename") return;
        await rename(artifactsRoot, heldArtifacts);
        await symlink(outside, artifactsRoot);
      },
    }),
    error => error instanceof PipelineError
      && error.code === "PUBLICATION_BOUNDARY_INVALID"
      && error.details.boundary === "accepted_artifacts_root",
  );
  assert.deepEqual(await readdir(outside), []);
  await rm(resolve(accepted, "artifacts"));
  await rename(heldArtifacts, resolve(accepted, "artifacts"));
  await assert.rejects(readAcceptedPointer(accepted), error => (
    error instanceof PipelineError
    && error.code === "SOURCE_FILE_UNREADABLE"
    && error.details.stage === "accepted_pointer"
  ));
});

test("promotion preserves a replaced staging leaf and refuses to claim it", async t => {
  const root = await temporaryRoot("dtcg-promotion-staging-leaf-swap");
  const candidate = resolve(root, "candidate");
  const accepted = resolve(root, "accepted");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: candidate });
  const manifest = await createManifest({ outputRoot: candidate });
  const artifact = manifest.artifacts[0];
  let replacementPath;
  let heldPath;
  let destinationPath;

  await assert.rejects(
    promoteCandidate({
      candidateRoot: candidate,
      acceptedRoot: accepted,
      manifest,
      injectFault: async ({ checkpoint, staging, destination }) => {
        if (checkpoint !== "before_candidate_rename") return;
        destinationPath = destination;
        replacementPath = resolve(staging, artifact.path);
        heldPath = `${replacementPath}.held`;
        const bytes = await readFile(replacementPath);
        await rename(replacementPath, heldPath);
        await writeFile(replacementPath, bytes);
      },
    }),
    error => error instanceof PipelineError
      && error.code === "PUBLICATION_BOUNDARY_INVALID"
      && error.details.reason === "file_identity_changed",
  );
  assert.deepEqual(await readFile(replacementPath), await readFile(heldPath));
  await assert.rejects(readFile(resolve(destinationPath, "manifest.json")), error => error.code === "ENOENT");
  await assert.rejects(readAcceptedPointer(accepted), error => (
    error instanceof PipelineError
    && error.code === "SOURCE_FILE_UNREADABLE"
    && error.details.stage === "accepted_pointer"
  ));
});

test("promotion never replaces a concurrently reserved empty digest directory", async t => {
  const root = await temporaryRoot("dtcg-promotion-empty-destination");
  const candidate = resolve(root, "candidate");
  const accepted = resolve(root, "accepted");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: candidate });
  const manifest = await createManifest({ outputRoot: candidate });
  let destinationPath;

  await assert.rejects(
    promoteCandidate({
      candidateRoot: candidate,
      acceptedRoot: accepted,
      manifest,
      injectFault: async ({ checkpoint, destination }) => {
        if (checkpoint !== "before_candidate_rename") return;
        destinationPath = destination;
        await mkdir(destination);
      },
    }),
    /artifact destination integrity mismatch: manifest\.json must be a regular file/u,
  );
  assert.deepEqual(await readdir(destinationPath), []);
  await assert.rejects(readAcceptedPointer(accepted), error => (
    error instanceof PipelineError
    && error.code === "SOURCE_FILE_UNREADABLE"
    && error.details.stage === "accepted_pointer"
  ));
});

test("pointer commit revalidates accepted leaf bytes after the final interleaving", async t => {
  const root = await temporaryRoot("dtcg-promotion-accepted-leaf-drift");
  const candidate = resolve(root, "candidate");
  const accepted = resolve(root, "accepted");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: candidate });
  const manifest = await createManifest({ outputRoot: candidate });
  const pointer = await promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest });
  const alternate = alternateManifest(manifest, "accepted leaf drift");
  const artifact = alternate.artifacts[0];
  let corruptedPath;

  await assert.rejects(
    promoteCandidate({
      candidateRoot: candidate,
      acceptedRoot: accepted,
      manifest: alternate,
      injectFault: async ({ checkpoint, destination }) => {
        if (checkpoint !== "before_pointer_rename") return;
        corruptedPath = resolve(destination, artifact.path);
        const bytes = await readFile(corruptedPath);
        bytes[0] ^= 1;
        await writeFile(corruptedPath, bytes);
      },
    }),
    new RegExp(`artifact destination integrity mismatch: ${artifact.path.replace(".", "\\.")} bytes differ`, "u"),
  );
  assert.deepEqual(await readAcceptedPointer(accepted), pointer);
  assert.notEqual(sha256(await readFile(corruptedPath)), artifact.sha256);
});

test("pointer commit rejects a same-content accepted leaf replacement", async t => {
  const root = await temporaryRoot("dtcg-promotion-accepted-leaf-identity");
  const candidate = resolve(root, "candidate");
  const accepted = resolve(root, "accepted");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: candidate });
  const manifest = await createManifest({ outputRoot: candidate });
  const pointer = await promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest });
  const alternate = alternateManifest(manifest, "accepted leaf identity drift");
  const artifact = alternate.artifacts[0];
  let replacementPath;
  let heldPath;

  await assert.rejects(
    promoteCandidate({
      candidateRoot: candidate,
      acceptedRoot: accepted,
      manifest: alternate,
      injectFault: async ({ checkpoint, destination }) => {
        if (checkpoint !== "before_pointer_rename") return;
        replacementPath = resolve(destination, artifact.path);
        heldPath = `${replacementPath}.held`;
        const bytes = await readFile(replacementPath);
        await rename(replacementPath, heldPath);
        await writeFile(replacementPath, bytes);
      },
    }),
    error => error instanceof PipelineError
      && error.code === "PUBLICATION_BOUNDARY_INVALID"
      && error.details.boundary === `accepted_file.${artifact.path}`
      && error.details.reason === "file_identity_changed",
  );
  assert.deepEqual(await readAcceptedPointer(accepted), pointer);
  assert.deepEqual(await readFile(replacementPath), await readFile(heldPath));
});

test("pointer commit rejects in-place temporary-pointer drift and removes only its own inode", async t => {
  const root = await temporaryRoot("dtcg-promotion-pointer-byte-drift");
  const candidate = resolve(root, "candidate");
  const accepted = resolve(root, "accepted");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: candidate });
  const manifest = await createManifest({ outputRoot: candidate });
  const pointer = await promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest });
  const pointerBytes = await readFile(resolve(accepted, "current.json"));
  const alternate = alternateManifest(manifest, "temporary pointer byte drift");
  let temporaryPointerPath;

  await assert.rejects(
    promoteCandidate({
      candidateRoot: candidate,
      acceptedRoot: accepted,
      manifest: alternate,
      injectFault: async ({ checkpoint, temporaryPointer }) => {
        if (checkpoint !== "before_pointer_rename") return;
        temporaryPointerPath = temporaryPointer;
        await writeFile(temporaryPointer, pointerBytes);
      },
    }),
    error => error instanceof PipelineError
      && error.code === "PUBLICATION_BOUNDARY_INVALID"
      && error.details.boundary === "temporary_pointer"
      && error.details.reason === "file_bytes_changed",
  );
  assert.deepEqual(await readAcceptedPointer(accepted), pointer);
  await assert.rejects(readFile(temporaryPointerPath), error => error.code === "ENOENT");
});

test("pointer cleanup preserves a replacement temporary file it did not create", async t => {
  const root = await temporaryRoot("dtcg-promotion-pointer-inode-swap");
  const candidate = resolve(root, "candidate");
  const accepted = resolve(root, "accepted");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: candidate });
  const manifest = await createManifest({ outputRoot: candidate });
  const pointer = await promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest });
  const alternate = alternateManifest(manifest, "temporary pointer inode swap");
  const foreignBytes = Buffer.from("foreign temporary pointer\n", "utf8");
  let temporaryPointerPath;
  let heldPath;

  await assert.rejects(
    promoteCandidate({
      candidateRoot: candidate,
      acceptedRoot: accepted,
      manifest: alternate,
      injectFault: async ({ checkpoint, temporaryPointer }) => {
        if (checkpoint !== "before_pointer_rename") return;
        temporaryPointerPath = temporaryPointer;
        heldPath = `${temporaryPointer}.held`;
        await rename(temporaryPointer, heldPath);
        await writeFile(temporaryPointer, foreignBytes);
      },
    }),
    error => error instanceof PipelineError
      && error.code === "PUBLICATION_BOUNDARY_INVALID"
      && error.details.boundary === "temporary_pointer"
      && error.details.reason === "file_identity_changed",
  );
  assert.deepEqual(await readAcceptedPointer(accepted), pointer);
  assert.deepEqual(await readFile(temporaryPointerPath), foreignBytes);
  assert.ok((await readFile(heldPath)).byteLength > 0);
});

test("promotion preserves the accepted pointer when the root moves before pointer rename", async t => {
  const root = await temporaryRoot("dtcg-promotion-pointer-root-swap");
  const candidate = resolve(root, "candidate");
  const accepted = resolve(root, "accepted");
  const heldAccepted = resolve(root, "accepted-held");
  const outside = resolve(root, "outside");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: candidate });
  const manifest = await createManifest({ outputRoot: candidate });
  const pointer = await promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest });
  const alternate = alternateManifest(manifest, "pointer-boundary swap");
  await mkdir(outside);

  await assert.rejects(
    promoteCandidate({
      candidateRoot: candidate,
      acceptedRoot: accepted,
      manifest: alternate,
      injectFault: async ({ checkpoint }) => {
        if (checkpoint !== "before_pointer_rename") return;
        await rename(accepted, heldAccepted);
        await symlink(outside, accepted);
      },
    }),
    error => error instanceof PipelineError
      && error.code === "PUBLICATION_BOUNDARY_INVALID"
      && error.details.boundary === "accepted_root",
  );
  assert.deepEqual(await readdir(outside), []);
  await rm(accepted);
  await rename(heldAccepted, accepted);
  assert.deepEqual(await readAcceptedPointer(accepted), pointer);
  const recoveryPointers = (await readdir(accepted)).filter(name => name.startsWith(".current-"));
  assert.equal(recoveryPointers.length, 1);
  assert.equal(
    JSON.parse(await readFile(resolve(accepted, recoveryPointers[0]), "utf8")).acceptedDigest,
    alternate.manifestDigest,
  );
});

test("promotion awaits a function interruption and retains the established pointer", async t => {
  const root = await temporaryRoot("dtcg-promotion-function-interruption");
  const candidate = resolve(root, "candidate");
  const accepted = resolve(root, "accepted");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: candidate });
  const manifest = await createManifest({ outputRoot: candidate });
  const pointer = await promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest });
  const alternate = alternateManifest(manifest, "function interruption");
  const checkpoints = [];

  await assert.rejects(
    promoteCandidate({
      candidateRoot: candidate,
      acceptedRoot: accepted,
      manifest: alternate,
      injectFault: async ({ checkpoint }) => {
        checkpoints.push(checkpoint);
        await new Promise(resolveDelay => setTimeout(resolveDelay, 2));
        if (checkpoint === "before_pointer_rename") {
          throw new Error("injected function interruption before pointer rename");
        }
      },
    }),
    /injected function interruption before pointer rename/u,
  );
  assert.deepEqual(checkpoints, [
    "before_candidate_rename",
    "before_pointer_write",
    "before_pointer_rename",
  ]);
  assert.deepEqual(await readAcceptedPointer(accepted), pointer);
  assert.deepEqual((await readdir(accepted)).filter(name => name.startsWith(".current-")), []);
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
    /artifacts count exceeds the configured envelope/u,
  );
  await assert.rejects(
    readAcceptedPointer(accepted),
    error => error instanceof PipelineError
      && error.code === "SOURCE_FILE_UNREADABLE"
      && error.details.stage === "accepted_pointer"
      && error.details.restartFrom === "promotion",
  );
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
  await assert.rejects(
    readAcceptedPointer(accepted),
    error => error instanceof PipelineError
      && error.code === "SOURCE_FILE_UNREADABLE"
      && error.details.stage === "accepted_pointer"
      && error.details.restartFrom === "promotion",
  );
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
    error => error instanceof PipelineError
      && error.code === "PUBLICATION_BOUNDARY_INVALID"
      && error.details.boundary === "accepted_destination",
  );
  await assert.rejects(
    readAcceptedPointer(accepted),
    error => error instanceof PipelineError
      && error.code === "SOURCE_FILE_UNREADABLE"
      && error.details.stage === "accepted_pointer"
      && error.details.restartFrom === "promotion",
  );
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
