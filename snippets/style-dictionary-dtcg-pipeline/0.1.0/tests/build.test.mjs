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
  sanitizeDiagnostic,
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

function assertReferenceUnreachable(root, target) {
  const pending = [root];
  const visited = new WeakSet();
  while (pending.length > 0) {
    const value = pending.pop();
    assert.notStrictEqual(value, target);
    if ((typeof value !== "object" && typeof value !== "function") || value === null || visited.has(value)) continue;
    visited.add(value);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if (Object.hasOwn(descriptor, "value")) pending.push(descriptor.value);
    }
  }
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

test("bounded source capture binds descriptor metadata and the final addressed path", async () => {
  const bytes = Buffer.from("bounded");
  const openedEntry = {
    dev: 1,
    ino: 10,
    size: bytes.length,
    mtimeMs: 100,
    ctimeMs: 200,
    isFile: () => true,
    isSymbolicLink: () => false,
  };
  for (const fixture of [
    {
      label: "descriptor ctime drift",
      settledEntry: { ...openedEntry, ctimeMs: 201 },
      settledPathEntry: openedEntry,
    },
    {
      label: "same-size pathname replacement",
      settledEntry: openedEntry,
      settledPathEntry: { ...openedEntry, ino: 11 },
    },
    {
      label: "same-inode final-path metadata drift",
      settledEntry: openedEntry,
      settledPathEntry: { ...openedEntry, ctimeMs: 201 },
    },
  ]) {
    let statCalls = 0;
    let pathCalls = 0;
    let closed = false;
    const fileSystem = {
      lstat: async () => (pathCalls++ === 0 ? openedEntry : fixture.settledPathEntry),
      open: async () => ({
        stat: async () => (statCalls++ === 0 ? openedEntry : fixture.settledEntry),
        read: async (buffer, offset, length, position) => {
          const count = Math.max(0, Math.min(length, bytes.length - position));
          if (count > 0) bytes.copy(buffer, offset, position, position + count);
          return { bytesRead: count };
        },
        close: async () => { closed = true; },
      }),
    };

    await assert.rejects(
      readBoundedFile("synthetic-source.json", { maxBytes: bytes.length, fileSystem }),
      error => error instanceof PipelineError && error.code === "SOURCE_FILE_CHANGED",
      fixture.label,
    );
    assert.equal(closed, true, fixture.label);
  }
});

test("bounded source capture owns hostile descriptor failures without invoking traps", async () => {
  const entry = {
    dev: 1,
    ino: 10,
    size: 1,
    mtimeMs: 100,
    ctimeMs: 200,
    isFile: () => true,
    isSymbolicLink: () => false,
  };
  let trapCalls = 0;
  let closed = false;
  const failTrap = () => {
    trapCalls += 1;
    throw new Error("hostile failure trap escaped bounded capture");
  };
  const hostileFailure = new Proxy(new Error("private descriptor failure"), {
    get: failTrap,
    getOwnPropertyDescriptor: failTrap,
    getPrototypeOf: failTrap,
    ownKeys: failTrap,
  });
  const fileSystem = {
    lstat: async () => entry,
    open: async () => ({
      stat: async () => entry,
      read: async () => { throw hostileFailure; },
      close: async () => { closed = true; },
    }),
  };

  await assert.rejects(
    readBoundedFile("synthetic-source.json", { maxBytes: 1, fileSystem }),
    error => error instanceof PipelineError
      && error.code === "SOURCE_CAPTURE_FAILED"
      && error.details.reason === "source_capture_failed",
  );
  assert.equal(trapCalls, 0);
  assert.equal(closed, true);
});

test("bounded source capture owns prototype-hostile and mutated typed failures", async () => {
  const entry = {
    dev: 1,
    ino: 10,
    size: 1,
    mtimeMs: 100,
    ctimeMs: 200,
    isFile: () => true,
    isSymbolicLink: () => false,
  };
  const exercise = async failure => {
    let closed = false;
    let observed;
    const fileSystem = {
      lstat: async () => entry,
      open: async () => ({
        stat: async () => entry,
        read: async () => { throw failure; },
        close: async () => { closed = true; },
      }),
    };
    await assert.rejects(
      readBoundedFile("synthetic-source.json", { maxBytes: 1, fileSystem }),
      error => {
        observed = error;
        return error instanceof PipelineError && error.code === "SOURCE_CAPTURE_FAILED";
      },
    );
    assert.equal(closed, true);
    assert.notEqual(observed, failure);
  };

  let prototypeTrapCalls = 0;
  const hostilePrototype = new Proxy({}, {
    getPrototypeOf() {
      prototypeTrapCalls += 1;
      throw new Error("prototype trap must remain idle");
    },
  });
  await exercise(Object.create(hostilePrototype));
  assert.equal(prototypeTrapCalls, 0);

  let getterCalls = 0;
  const mutatedTypedFailure = new PipelineError("CALLER_TYPED_FAILURE", "Caller failure.", { stage: "caller" });
  Object.defineProperty(mutatedTypedFailure, "details", {
    configurable: true,
    get() {
      getterCalls += 1;
      throw new Error("details getter must remain idle");
    },
  });
  await exercise(mutatedTypedFailure);
  assert.equal(getterCalls, 0);
});

test("diagnostic sanitization returns owned data and keeps hostile behavior idle", () => {
  const source = new PipelineError("SYNTHETIC", "Synthetic diagnostic.", { stage: "test" });
  const diagnostic = sanitizeDiagnostic(source);
  assert.deepEqual(diagnostic, {
    code: "SYNTHETIC",
    message: "Synthetic diagnostic.",
    details: { stage: "test" },
  });
  assert.notEqual(diagnostic.details, source.details);

  let prototypeTrapCalls = 0;
  const hostilePrototype = new Proxy({}, {
    getPrototypeOf() {
      prototypeTrapCalls += 1;
      throw new Error("prototype trap must remain idle");
    },
  });
  assert.equal(sanitizeDiagnostic(Object.create(hostilePrototype)).code, "UNEXPECTED_PIPELINE_FAILURE");
  assert.equal(prototypeTrapCalls, 0);

  for (const field of ["code", "message", "details", "toJSON"]) {
    let getterCalls = 0;
    const mutated = new PipelineError("SYNTHETIC", "Synthetic diagnostic.", { stage: "test" });
    Object.defineProperty(mutated, field, {
      configurable: true,
      get() {
        getterCalls += 1;
        throw new Error(`${field} getter must remain idle`);
      },
    });
    assert.equal(
      sanitizeDiagnostic(mutated).code,
      field === "toJSON" ? "SYNTHETIC" : "UNEXPECTED_PIPELINE_FAILURE",
      field,
    );
    assert.equal(getterCalls, 0, field);
  }
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
    error => error instanceof PipelineError
      && error.code === "ACCEPTED_INTEGRITY_MISMATCH"
      && error.details.restartFrom === "accepted_coordinate_recovery"
      && error.details.action === "inspect_or_quarantine"
      && error.details.acceptedCoordinate === manifest.manifestDigest
      && error.details.relativePath === "manifest.json",
  );
  assert.deepEqual(await readdir(destinationPath), []);
  await assert.rejects(readAcceptedPointer(accepted), error => (
    error instanceof PipelineError
    && error.code === "SOURCE_FILE_UNREADABLE"
    && error.details.stage === "accepted_pointer"
  ));
});

test("reservation replacement stops pointer promotion at accepted-coordinate recovery", async t => {
  const root = await temporaryRoot("dtcg-reservation-replacement");
  const candidate = resolve(root, "candidate");
  const accepted = resolve(root, "accepted");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: candidate });
  const manifest = await createManifest({ outputRoot: candidate });
  const pointer = await promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest });
  const alternate = alternateManifest(manifest, "reservation replacement");
  let replacementPath;
  let heldPath;

  await assert.rejects(
    promoteCandidate({
      candidateRoot: candidate,
      acceptedRoot: accepted,
      manifest: alternate,
      injectFault: async ({ checkpoint, reservationPath }) => {
        if (checkpoint !== "before_reservation_release") return;
        replacementPath = reservationPath;
        heldPath = `${reservationPath}.held`;
        await rename(reservationPath, heldPath);
        await mkdir(reservationPath);
      },
    }),
    error => error instanceof PipelineError
      && error.code === "PUBLICATION_RESERVATION_RELEASE_FAILED"
      && error.details.restartFrom === "accepted_coordinate_recovery"
      && error.details.action === "inspect_or_quarantine"
      && error.details.acceptedCoordinate === alternate.manifestDigest
      && error.details.failure.boundary === "destination_reservation",
  );
  assert.deepEqual(await readdir(replacementPath), []);
  assert.ok((await readFile(heldPath)).byteLength > 0);
  assert.deepEqual(await readAcceptedPointer(accepted), pointer);
});

test("a nonempty replacement reservation remains inspectable and stops pointer promotion", async t => {
  const root = await temporaryRoot("dtcg-reservation-nonempty");
  const candidate = resolve(root, "candidate");
  const accepted = resolve(root, "accepted");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: candidate });
  const manifest = await createManifest({ outputRoot: candidate });
  const pointer = await promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest });
  const alternate = alternateManifest(manifest, "nonempty reservation replacement");
  let retainedFile;

  await assert.rejects(
    promoteCandidate({
      candidateRoot: candidate,
      acceptedRoot: accepted,
      manifest: alternate,
      injectFault: async ({ checkpoint, reservationPath }) => {
        if (checkpoint !== "before_reservation_release") return;
        await rename(reservationPath, `${reservationPath}.held`);
        await mkdir(reservationPath);
        retainedFile = resolve(reservationPath, "owner-note.txt");
        await writeFile(retainedFile, "retained for accepted-coordinate inspection\n");
      },
    }),
    error => error instanceof PipelineError
      && error.code === "PUBLICATION_RESERVATION_RELEASE_FAILED"
      && error.details.restartFrom === "accepted_coordinate_recovery"
      && error.details.acceptedCoordinate === alternate.manifestDigest
      && error.details.failure.boundary === "destination_reservation",
  );
  assert.equal(await readFile(retainedFile, "utf8"), "retained for accepted-coordinate inspection\n");
  assert.deepEqual(await readAcceptedPointer(accepted), pointer);
});

test("a primary promotion failure retains bounded reservation-cleanup context", async t => {
  const root = await temporaryRoot("dtcg-reservation-primary-cleanup");
  const candidate = resolve(root, "candidate");
  const accepted = resolve(root, "accepted");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: candidate });
  const manifest = await createManifest({ outputRoot: candidate });
  const pointer = await promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest });
  const alternate = alternateManifest(manifest, "primary and cleanup failure");

  await assert.rejects(
    promoteCandidate({
      candidateRoot: candidate,
      acceptedRoot: accepted,
      manifest: alternate,
      injectFault: async ({ checkpoint, reservationPath }) => {
        if (checkpoint !== "before_reservation_release") return;
        await rename(reservationPath, `${reservationPath}.held`);
        await mkdir(reservationPath);
        await writeFile(resolve(reservationPath, "owner-note.txt"), "retained after primary failure\n");
        throw new PipelineError(
          "INJECTED_PRIMARY",
          "The injected primary failure stopped promotion before reservation release.",
          { stage: "promotion", checkpoint: "before_reservation_release" },
        );
      },
    }),
    error => error instanceof PipelineError
      && error.code === "INJECTED_PRIMARY"
      && error.details.checkpoint === "destination_reservation_release"
      && error.details.restartFrom === "accepted_coordinate_recovery"
      && error.details.action === "inspect_or_quarantine"
      && error.details.acceptedCoordinate === alternate.manifestDigest
      && Object.keys(error.details.cleanupFailure).sort().join(",") === "boundary,code,recovery"
      && error.details.cleanupFailure.code === "PUBLICATION_RESERVATION_RELEASE_FAILED"
      && error.details.cleanupFailure.boundary === "destination_reservation"
      && error.details.cleanupFailure.recovery === "accepted_coordinate_recovery",
  );
  assert.deepEqual(await readAcceptedPointer(accepted), pointer);
});

test("cleanup reporting admits a hostile primary error without invoking proxy traps", async t => {
  const root = await temporaryRoot("dtcg-reservation-hostile-primary");
  const candidate = resolve(root, "candidate");
  const accepted = resolve(root, "accepted");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: candidate });
  const manifest = await createManifest({ outputRoot: candidate });
  const pointer = await promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest });
  const alternate = alternateManifest(manifest, "hostile primary and cleanup failure");
  let trapCalls = 0;
  const hostilePrimary = new Proxy(
    new PipelineError("HOSTILE_PRIMARY", "A caller-controlled primary failure.", { boundary: "caller" }),
    {
      get() {
        trapCalls += 1;
        throw new Error("primary get trap must remain idle");
      },
      getOwnPropertyDescriptor() {
        trapCalls += 1;
        throw new Error("primary descriptor trap must remain idle");
      },
      getPrototypeOf() {
        trapCalls += 1;
        throw new Error("primary prototype trap must remain idle");
      },
    },
  );
  let observed;

  await assert.rejects(
    promoteCandidate({
      candidateRoot: candidate,
      acceptedRoot: accepted,
      manifest: alternate,
      injectFault: async ({ checkpoint, reservationPath }) => {
        if (checkpoint !== "before_reservation_release") return;
        await rename(reservationPath, `${reservationPath}.held`);
        await mkdir(reservationPath);
        await writeFile(resolve(reservationPath, "owner-note.txt"), "retained after hostile primary\n");
        throw hostilePrimary;
      },
    }),
    error => {
      observed = error;
      return error instanceof PipelineError
        && error.code === "PUBLICATION_FAILED"
        && !Object.hasOwn(error, "cause")
        && error.details.primaryFailure.code === "PUBLICATION_FAILED"
        && error.details.cleanupFailure.code === "PUBLICATION_RESERVATION_RELEASE_FAILED";
    },
  );
  assertReferenceUnreachable(observed, hostilePrimary);
  assert.equal(trapCalls, 0);
  assert.deepEqual(await readAcceptedPointer(accepted), pointer);
});

test("successful cleanup reconstructs an admitted typed promotion failure", async t => {
  const root = await temporaryRoot("dtcg-owned-typed-primary");
  const candidate = resolve(root, "candidate");
  const accepted = resolve(root, "accepted");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: candidate });
  const manifest = await createManifest({ outputRoot: candidate });
  const pointer = await promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest });
  const alternate = alternateManifest(manifest, "owned typed primary");
  const callerFailure = new PipelineError(
    "INJECTED_TYPED_PRIMARY",
    "A caller-supplied typed failure stopped promotion.",
    { stage: "promotion", checkpoint: "before_reservation_release", restartFrom: "pointer" },
  );
  let getterCalls = 0;
  Object.defineProperty(callerFailure, "toJSON", {
    configurable: true,
    get() {
      getterCalls += 1;
      throw new Error("caller toJSON getter must remain idle");
    },
  });
  let observed;

  await assert.rejects(
    promoteCandidate({
      candidateRoot: candidate,
      acceptedRoot: accepted,
      manifest: alternate,
      injectFault: async ({ checkpoint }) => {
        if (checkpoint === "before_reservation_release") throw callerFailure;
      },
    }),
    error => {
      observed = error;
      return error instanceof PipelineError
        && error.code === "INJECTED_TYPED_PRIMARY"
        && error.message === "A caller-supplied typed failure stopped promotion."
        && error.details.checkpoint === "before_reservation_release"
        && error.details.restartFrom === "pointer"
        && !Object.hasOwn(error, "cause");
    },
  );
  assert.notEqual(observed, callerFailure);
  assertReferenceUnreachable(observed, callerFailure);
  assert.equal(getterCalls, 0);
  assert.deepEqual(await readAcceptedPointer(accepted), pointer);
});

test("cleanup reporting inspects primary accessors as descriptors and leaves their getters idle", async t => {
  const root = await temporaryRoot("dtcg-reservation-accessor-primary");
  const candidate = resolve(root, "candidate");
  const accepted = resolve(root, "accepted");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: candidate });
  const manifest = await createManifest({ outputRoot: candidate });
  const pointer = await promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest });
  const alternate = alternateManifest(manifest, "accessor primary and cleanup failure");
  let getterCalls = 0;
  const hostilePrimary = new Error("A caller-controlled accessor primary failure.");
  for (const field of ["code", "details"]) {
    Object.defineProperty(hostilePrimary, field, {
      configurable: true,
      get() {
        getterCalls += 1;
        throw new Error(`${field} getter must remain idle`);
      },
    });
  }

  await assert.rejects(
    promoteCandidate({
      candidateRoot: candidate,
      acceptedRoot: accepted,
      manifest: alternate,
      injectFault: async ({ checkpoint, reservationPath }) => {
        if (checkpoint !== "before_reservation_release") return;
        await rename(reservationPath, `${reservationPath}.held`);
        await mkdir(reservationPath);
        await writeFile(resolve(reservationPath, "owner-note.txt"), "retained after accessor primary\n");
        throw hostilePrimary;
      },
    }),
    error => error instanceof PipelineError
      && error.code === "PUBLICATION_FAILED"
      && !Object.hasOwn(error, "cause")
      && error.details.primaryFailure.code === "PUBLICATION_FAILED"
      && error.details.cleanupFailure.code === "PUBLICATION_RESERVATION_RELEASE_FAILED",
  );
  assert.equal(getterCalls, 0);
  assert.deepEqual(await readAcceptedPointer(accepted), pointer);
});

test("cleanup reporting bounds oversized primary strings before UTF-8 measurement", async t => {
  const root = await temporaryRoot("dtcg-reservation-oversized-primary");
  const candidate = resolve(root, "candidate");
  const accepted = resolve(root, "accepted");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: candidate });
  const manifest = await createManifest({ outputRoot: candidate });
  const pointer = await promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest });
  const alternate = alternateManifest(manifest, "oversized primary and cleanup failure");
  const oversizedPrimary = new PipelineError("C".repeat(513), "M".repeat(4_097));

  await assert.rejects(
    promoteCandidate({
      candidateRoot: candidate,
      acceptedRoot: accepted,
      manifest: alternate,
      injectFault: async ({ checkpoint, reservationPath }) => {
        if (checkpoint !== "before_reservation_release") return;
        await rename(reservationPath, `${reservationPath}.held`);
        await mkdir(reservationPath);
        await writeFile(resolve(reservationPath, "owner-note.txt"), "retained after oversized primary\n");
        throw oversizedPrimary;
      },
    }),
    error => error instanceof PipelineError
      && error.code === "PUBLICATION_FAILED"
      && !Object.hasOwn(error, "cause")
      && error.details.restartFrom === "accepted_coordinate_recovery"
      && error.details.action === "inspect_or_quarantine"
      && error.details.acceptedCoordinate === alternate.manifestDigest
      && error.details.primaryFailure.code === "PUBLICATION_FAILED"
      && error.details.cleanupFailure.code === "PUBLICATION_RESERVATION_RELEASE_FAILED",
  );
  assert.deepEqual(await readAcceptedPointer(accepted), pointer);
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
    error => error instanceof PipelineError
      && error.code === "ACCEPTED_INTEGRITY_MISMATCH"
      && error.details.restartFrom === "accepted_coordinate_recovery"
      && error.details.action === "inspect_or_quarantine"
      && error.details.acceptedCoordinate === alternate.manifestDigest
      && error.details.relativePath === artifact.path,
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
      && error.details.reason === "file_identity_changed"
      && error.details.restartFrom === "accepted_coordinate_recovery"
      && error.details.action === "inspect_or_quarantine"
      && error.details.acceptedCoordinate === alternate.manifestDigest,
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
    "before_reservation_release",
    "before_pointer_reservation_acquire",
    "after_pointer_reservation_acquired",
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

test("different-digest publishers compare the captured pointer under one process-safe reservation", async t => {
  const root = await temporaryRoot("dtcg-cross-digest-pointer-cas");
  const candidate = resolve(root, "candidate");
  const accepted = resolve(root, "accepted");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: candidate });
  const manifest = await createManifest({ outputRoot: candidate });
  const baseline = await promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest });
  const firstManifest = alternateManifest(manifest, "first concurrent pointer candidate");
  const secondManifest = alternateManifest(manifest, "second concurrent pointer candidate");
  let releaseFirst;
  const firstMayCommit = new Promise(resolvePromise => { releaseFirst = resolvePromise; });
  let firstOwnsPointer;
  const firstOwnsPointerSignal = new Promise(resolvePromise => { firstOwnsPointer = resolvePromise; });
  let secondCapturedPrior;
  const secondCapturedPriorSignal = new Promise(resolvePromise => { secondCapturedPrior = resolvePromise; });

  const first = promoteCandidate({
    candidateRoot: candidate,
    acceptedRoot: accepted,
    manifest: firstManifest,
    injectFault: async ({ checkpoint }) => {
      if (checkpoint !== "after_pointer_reservation_acquired") return;
      firstOwnsPointer();
      await firstMayCommit;
    },
  });
  await firstOwnsPointerSignal;
  const second = promoteCandidate({
    candidateRoot: candidate,
    acceptedRoot: accepted,
    manifest: secondManifest,
    injectFault: async ({ checkpoint }) => {
      if (checkpoint === "before_pointer_reservation_acquire") secondCapturedPrior();
    },
  });
  await secondCapturedPriorSignal;
  releaseFirst();

  const firstPointer = await first;
  await assert.rejects(
    second,
    error => error instanceof PipelineError && error.code === "PUBLICATION_POINTER_CONFLICT",
  );
  assert.notDeepEqual(firstPointer, baseline);
  assert.deepEqual(await readAcceptedPointer(accepted), firstPointer);
  assert.equal((await readdir(accepted)).includes(".current.reservation"), false);
});

test("pointer commit rejects a replaced pointer reservation and preserves primary authority", async t => {
  const root = await temporaryRoot("dtcg-pointer-reservation-replacement");
  const candidate = resolve(root, "candidate");
  const accepted = resolve(root, "accepted");
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildCandidates({ outputRoot: candidate });
  const manifest = await createManifest({ outputRoot: candidate });
  const pointer = await promoteCandidate({ candidateRoot: candidate, acceptedRoot: accepted, manifest });
  const alternate = alternateManifest(manifest, "pointer reservation replacement");
  let replacementPath;

  await assert.rejects(
    promoteCandidate({
      candidateRoot: candidate,
      acceptedRoot: accepted,
      manifest: alternate,
      injectFault: async ({ checkpoint, pointerReservationPath }) => {
        if (checkpoint !== "after_pointer_reservation_acquired") return;
        await rename(pointerReservationPath, `${pointerReservationPath}.held`);
        replacementPath = pointerReservationPath;
        await writeFile(pointerReservationPath, "replacement pointer owner\n", "utf8");
      },
    }),
    error => error instanceof PipelineError
      && error.code === "PUBLICATION_BOUNDARY_INVALID"
      && error.details.boundary === "pointer_reservation"
      && error.details.checkpoint === "pointer_reservation_release"
      && error.details.restartFrom === "accepted_coordinate_recovery"
      && error.details.action === "inspect_or_quarantine"
      && error.details.acceptedCoordinate === alternate.manifestDigest
      && error.details.cleanupFailure.code === "PUBLICATION_POINTER_RESERVATION_RELEASE_FAILED"
      && error.details.cleanupFailure.boundary === "pointer_reservation",
  );
  assert.equal(await readFile(replacementPath, "utf8"), "replacement pointer owner\n");
  assert.deepEqual(await readAcceptedPointer(accepted), pointer);
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
    error => error instanceof PipelineError
      && error.code === "ACCEPTED_INTEGRITY_MISMATCH"
      && error.details.restartFrom === "accepted_coordinate_recovery"
      && error.details.action === "inspect_or_quarantine"
      && error.details.acceptedCoordinate === manifest.manifestDigest
      && error.details.relativePath === "acme-light/tokens.css",
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
      && error.details.boundary === "accepted_destination"
      && error.details.restartFrom === "accepted_coordinate_recovery"
      && error.details.action === "inspect_or_quarantine"
      && error.details.acceptedCoordinate === manifest.manifestDigest,
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
