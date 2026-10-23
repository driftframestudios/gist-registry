import "../node-runtime-admission.mjs";

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, symlink, truncate, writeFile } from "node:fs/promises";
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
  readBoundedFile,
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
  assert.match(gallery, /main \{[^}]*overflow-wrap: anywhere;[^}]*\}/u);
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

test("source admission rejects a symbolic-link coordinate before rendering", async () => {
  const root = await temporaryDirectory("source-symlink");
  const contractLink = path.join(root, "pattern-contract-link.json");
  await symlink(sourcePaths.contractPath, contractLink);

  await assert.rejects(
    compileArtifactFamily({
      ...sourcePaths,
      contractPath: contractLink,
      outputDir: path.join(root, "candidate"),
    }),
    error => error instanceof VisualArtifactError && error.code === "invalid_source_file",
  );
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
      readBoundedFile("synthetic-source.svg", "svgBytes", bytes.length, { fileSystem }),
      error => error instanceof VisualArtifactError && error.code === "source_file_changed",
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
    readBoundedFile("synthetic-source.svg", "svgBytes", 1, { fileSystem }),
    error => error instanceof VisualArtifactError
      && error.code === "source_capture_failed"
      && error.details.cause === "source_capture_failed",
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
  const exercise = async (failure, expectedCode) => {
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
      readBoundedFile("synthetic-source.svg", "svgBytes", 1, { fileSystem }),
      error => {
        observed = error;
        return error instanceof VisualArtifactError && error.code === expectedCode;
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
  await exercise(Object.create(hostilePrototype), "source_capture_failed");
  assert.equal(prototypeTrapCalls, 0);

  for (const field of ["code", "message", "details"]) {
    let getterCalls = 0;
    const mutatedTypedFailure = new VisualArtifactError("caller_typed_failure", "Caller failure.", { boundary: "caller" });
    Object.defineProperty(mutatedTypedFailure, field, {
      configurable: true,
      get() {
        getterCalls += 1;
        throw new Error(`${field} getter must remain idle`);
      },
    });
    await exercise(
      mutatedTypedFailure,
      "source_capture_failed",
    );
    assert.equal(getterCalls, 0, field);
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

test("accounts for each encoded derivative before persisting it", async () => {
  const baselineRoot = await temporaryDirectory("encoded-output-baseline");
  const baseline = await compileArtifactFamily({
    ...sourcePaths,
    outputDir: path.join(baselineRoot, "candidate"),
  });
  const outputByRole = new Map(baseline.manifest.outputs.map(output => [output.path, output]));
  const sourceBytes = outputByRole.get("source.svg").bytes;
  const semanticBytes = outputByRole.get("semantic-companion.json").bytes;
  const galleryBytes = outputByRole.get("gallery.html").bytes;
  const firstDerivative = outputByRole.get("source-to-decision-route-640.webp");
  const beforeFirstDerivative = sourceBytes + semanticBytes;
  const firstDerivativeBoundary = beforeFirstDerivative + firstDerivative.bytes;
  assert.ok(firstDerivativeBoundary > sourceBytes + semanticBytes + galleryBytes);

  const rejectedRoot = await temporaryDirectory("encoded-output-over-boundary");
  const rejectedOutput = path.join(rejectedRoot, "candidate");
  await assert.rejects(
    compileArtifactFamily({
      ...sourcePaths,
      outputDir: rejectedOutput,
      limits: { outputBytes: firstDerivativeBoundary - 1 },
    }),
    error => error instanceof VisualArtifactError
      && error.code === "resource_limit_exceeded"
      && error.details.resource === "outputBytes",
  );
  assert.equal(
    (await readdir(rejectedOutput)).some(name => name.endsWith(".webp")),
    false,
  );

  const exactRoot = await temporaryDirectory("encoded-output-exact-boundary");
  const exactOutput = path.join(exactRoot, "candidate");
  await assert.rejects(
    compileArtifactFamily({
      ...sourcePaths,
      outputDir: exactOutput,
      limits: { outputBytes: firstDerivativeBoundary },
    }),
    error => error instanceof VisualArtifactError
      && error.code === "resource_limit_exceeded"
      && error.details.resource === "outputBytes",
  );
  assert.equal(
    (await readdir(exactOutput)).includes("source-to-decision-route-640.webp"),
    true,
  );
  assert.equal(
    (await readdir(exactOutput)).includes("source-to-decision-route-1280.webp"),
    false,
  );
});

test("accepts the exact aggregate output-byte boundary and rejects the prior byte", async () => {
  const baselineRoot = await temporaryDirectory("aggregate-output-baseline");
  const baseline = await compileArtifactFamily({
    ...sourcePaths,
    outputDir: path.join(baselineRoot, "candidate"),
  });
  let boundary = baseline.measurement.outputBytes;
  let exactResult;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const root = await temporaryDirectory(`aggregate-output-converge-${attempt}`);
    try {
      const result = await compileArtifactFamily({
        ...sourcePaths,
        outputDir: path.join(root, "candidate"),
        limits: { outputBytes: boundary },
      });
      if (result.measurement.outputBytes === boundary) {
        exactResult = result;
        break;
      }
      boundary = result.measurement.outputBytes;
    } catch (error) {
      assert.ok(error instanceof VisualArtifactError);
      assert.equal(error.code, "resource_limit_exceeded");
      boundary = error.details.observed;
    }
  }
  assert.ok(exactResult, "aggregate byte boundary converges");
  assert.equal(exactResult.measurement.outputBytes, boundary);

  const rejectedRoot = await temporaryDirectory("aggregate-output-prior-byte");
  await assert.rejects(
    compileArtifactFamily({
      ...sourcePaths,
      outputDir: path.join(rejectedRoot, "candidate"),
      limits: { outputBytes: boundary - 1 },
    }),
    error => error instanceof VisualArtifactError
      && error.code === "resource_limit_exceeded"
      && error.details.resource === "outputBytes",
  );
});

test("publication rejects symlinked root and owned directory coordinates before compiling", async () => {
  for (const boundary of ["root", ".candidates", "accepted"]) {
    const container = await temporaryDirectory(`publication-boundary-${boundary.replace(".", "")}`);
    const actualRoot = path.join(container, "actual-root");
    const outside = path.join(container, "outside");
    await mkdir(actualRoot);
    await mkdir(outside);
    let publicationRoot = actualRoot;
    if (boundary === "root") {
      publicationRoot = path.join(container, "publication");
      await symlink(actualRoot, publicationRoot);
    } else {
      await symlink(outside, path.join(publicationRoot, boundary));
    }

    await assert.rejects(
      publishArtifactFamily({ ...sourcePaths, publicationRoot }),
      error => error instanceof VisualArtifactError
        && error.code === "publication_boundary_invalid"
        && error.details.boundary === boundary,
    );
    assert.deepEqual(await readdir(outside), []);
  }
});

for (const swapBoundary of [".candidates", "accepted"]) {
  test(`publication rejects ${swapBoundary} replacement before promotion`, async () => {
    const container = await temporaryDirectory(`publication-swap-${swapBoundary.slice(1)}`);
    const publicationRoot = path.join(container, "publication");
    const outside = path.join(container, "outside");
    await mkdir(outside);
    await publishArtifactFamily({ ...sourcePaths, publicationRoot });
    const pointerPath = path.join(publicationRoot, "accepted-pointer.json");
    const pointerBefore = await readFile(pointerPath);

    await assert.rejects(
      publishArtifactFamily({
        ...sourcePaths,
        publicationRoot,
        faultInjector: async ({ checkpoint }) => {
          if (checkpoint !== "before_candidate_rename") return;
          const ownedPath = path.join(publicationRoot, swapBoundary);
          await rename(ownedPath, `${ownedPath}-held`);
          await symlink(outside, ownedPath);
        },
      }),
      error => error instanceof VisualArtifactError
        && error.code === "publication_boundary_invalid"
        && error.details.boundary === swapBoundary,
    );
    assert.deepEqual(await readdir(outside), []);
    assert.deepEqual(await readFile(pointerPath), pointerBefore);
  });
}

test("publication stops before another output when its private candidate coordinate changes", async () => {
  const container = await temporaryDirectory("candidate-write-swap");
  const publicationRoot = path.join(container, "publication");
  const heldCandidate = path.join(container, "candidate-held");
  const outside = path.join(container, "outside");
  await mkdir(outside);

  await assert.rejects(
    publishArtifactFamily({
      ...sourcePaths,
      publicationRoot,
      faultInjector: async ({ checkpoint, outputDir, relativePath }) => {
        if (checkpoint !== "candidate_output_written" || relativePath !== "source.svg") return;
        await rename(outputDir, heldCandidate);
        await symlink(outside, outputDir);
      },
    }),
    error => error instanceof VisualArtifactError
      && error.code === "publication_boundary_invalid"
      && error.details.boundary === "candidate_output",
  );
  assert.deepEqual(await readdir(outside), []);
  assert.deepEqual(await readdir(heldCandidate), ["source.svg"]);
});

test("publication stops before another output when an admitted candidate leaf changes", async () => {
  const container = await temporaryDirectory("candidate-leaf-swap");
  const publicationRoot = path.join(container, "publication");
  let candidateDir;
  let heldSource;

  await assert.rejects(
    publishArtifactFamily({
      ...sourcePaths,
      publicationRoot,
      faultInjector: async ({ checkpoint, outputDir, relativePath }) => {
        if (checkpoint !== "candidate_output_written" || relativePath !== "source.svg") return;
        candidateDir = outputDir;
        const sourcePath = path.join(outputDir, "source.svg");
        heldSource = path.join(outputDir, "source-owned-by-first-writer.svg");
        await rename(sourcePath, heldSource);
        await writeFile(sourcePath, "replacement owned by another writer\n");
      },
    }),
    error => error instanceof VisualArtifactError
      && error.code === "publication_boundary_invalid"
      && error.details.boundary === "candidate_output.source.svg",
  );
  assert.equal(
    await readFile(path.join(candidateDir, "source.svg"), "utf8"),
    "replacement owned by another writer\n",
  );
  assert.ok((await lstat(heldSource)).isFile());
  assert.deepEqual(
    (await readdir(candidateDir)).sort(),
    ["source-owned-by-first-writer.svg", "source.svg"],
  );
});

test("publication rejects root replacement before pointer promotion", async () => {
  const container = await temporaryDirectory("publication-root-swap");
  const publicationRoot = path.join(container, "publication");
  const heldRoot = path.join(container, "publication-held");
  const outside = path.join(container, "outside");
  await mkdir(outside);
  await publishArtifactFamily({ ...sourcePaths, publicationRoot });
  const pointerBefore = await readFile(path.join(publicationRoot, "accepted-pointer.json"));

  await assert.rejects(
    publishArtifactFamily({
      ...sourcePaths,
      publicationRoot,
      faultInjector: async ({ checkpoint }) => {
        if (checkpoint !== "before_pointer_rename") return;
        await rename(publicationRoot, heldRoot);
        await symlink(outside, publicationRoot);
      },
    }),
    error => error instanceof VisualArtifactError
      && error.code === "publication_boundary_invalid"
      && error.details.boundary === "root",
  );
  assert.deepEqual(await readdir(outside), []);
  assert.deepEqual(await readFile(path.join(heldRoot, "accepted-pointer.json")), pointerBefore);
});

test("pointer promotion revalidates accepted leaf bytes after the first complete verification", async () => {
  const root = await temporaryDirectory("accepted-leaf-swap");
  const publicationRoot = path.join(root, "publication");
  const first = await publishArtifactFamily({ ...sourcePaths, publicationRoot });
  const pointerPath = path.join(publicationRoot, "accepted-pointer.json");
  const pointerBefore = await readFile(pointerPath);
  const acceptedLeaf = path.join(
    publicationRoot,
    "accepted",
    first.manifestDigest,
    "semantic-companion.json",
  );

  await assert.rejects(
    publishArtifactFamily({
      ...sourcePaths,
      publicationRoot,
      faultInjector: async ({ checkpoint }) => {
        if (checkpoint !== "before_pointer_rename") return;
        const original = await readFile(acceptedLeaf);
        await writeFile(acceptedLeaf, Buffer.alloc(original.byteLength, 0x20));
      },
    }),
    error => error instanceof VisualArtifactError
      && error.code === "accepted_integrity_mismatch"
      && error.details.restartFrom === "accepted_coordinate_recovery"
      && error.details.action === "inspect_or_quarantine"
      && error.details.acceptedCoordinate === first.manifestDigest,
  );
  assert.deepEqual(await readFile(pointerPath), pointerBefore);
});

test("accepted leaf replacement routes to accepted-coordinate recovery", async () => {
  const root = await temporaryDirectory("accepted-leaf-identity");
  const publicationRoot = path.join(root, "publication");
  const first = await publishArtifactFamily({ ...sourcePaths, publicationRoot });
  const pointerPath = path.join(publicationRoot, "accepted-pointer.json");
  const pointerBefore = await readFile(pointerPath);
  const acceptedLeaf = path.join(
    publicationRoot,
    "accepted",
    first.manifestDigest,
    "semantic-companion.json",
  );
  const heldLeaf = `${acceptedLeaf}.held`;

  await assert.rejects(
    publishArtifactFamily({
      ...sourcePaths,
      publicationRoot,
      faultInjector: async ({ checkpoint }) => {
        if (checkpoint !== "before_pointer_rename") return;
        const bytes = await readFile(acceptedLeaf);
        await rename(acceptedLeaf, heldLeaf);
        await writeFile(acceptedLeaf, bytes);
      },
    }),
    error => error instanceof VisualArtifactError
      && error.code === "publication_boundary_invalid"
      && error.details.boundary === "accepted_file.semantic-companion.json"
      && error.details.reason === "file_identity_changed"
      && error.details.restartFrom === "accepted_coordinate_recovery"
      && error.details.action === "inspect_or_quarantine"
      && error.details.acceptedCoordinate === first.manifestDigest,
  );
  assert.deepEqual(await readFile(pointerPath), pointerBefore);
  assert.deepEqual(await readFile(acceptedLeaf), await readFile(heldLeaf));
});

test("pointer promotion preserves a replaced temporary coordinate for inspection", async () => {
  const root = await temporaryDirectory("pointer-temp-swap");
  const publicationRoot = path.join(root, "publication");
  await publishArtifactFamily({ ...sourcePaths, publicationRoot });
  const pointerPath = path.join(publicationRoot, "accepted-pointer.json");
  const pointerBefore = await readFile(pointerPath);
  let replacementPath;

  await assert.rejects(
    publishArtifactFamily({
      ...sourcePaths,
      publicationRoot,
      faultInjector: async ({ checkpoint, pointerTempPath }) => {
        if (checkpoint !== "before_pointer_rename") return;
        await rename(pointerTempPath, `${pointerTempPath}.held`);
        replacementPath = pointerTempPath;
        await writeFile(pointerTempPath, "replacement owned by another publisher\n");
      },
    }),
    error => error instanceof VisualArtifactError
      && error.code === "publication_boundary_invalid"
      && error.details.boundary === "temporary_pointer",
  );
  assert.deepEqual(await readFile(pointerPath), pointerBefore);
  assert.equal(await readFile(replacementPath, "utf8"), "replacement owned by another publisher\n");
});

test("pointer promotion rejects same-inode temporary byte drift", async () => {
  const root = await temporaryDirectory("pointer-temp-byte-drift");
  const publicationRoot = path.join(root, "publication");
  await publishArtifactFamily({ ...sourcePaths, publicationRoot });
  const pointerPath = path.join(publicationRoot, "accepted-pointer.json");
  const pointerBefore = await readFile(pointerPath);

  await assert.rejects(
    publishArtifactFamily({
      ...sourcePaths,
      publicationRoot,
      faultInjector: async ({ checkpoint, pointerTempPath }) => {
        if (checkpoint !== "before_pointer_rename") return;
        const pointerBytes = await readFile(pointerTempPath);
        await writeFile(pointerTempPath, Buffer.alloc(pointerBytes.byteLength, 0x20));
      },
    }),
    error => error instanceof VisualArtifactError
      && error.code === "publication_boundary_invalid"
      && error.details.boundary === "temporary_pointer"
      && error.details.reason === "file_bytes_changed",
  );
  assert.deepEqual(await readFile(pointerPath), pointerBefore);
});

test("an existing empty digest coordinate remains owned by its creator", async () => {
  const root = await temporaryDirectory("accepted-empty-collision");
  const publicationRoot = path.join(root, "publication");
  await publishArtifactFamily({ ...sourcePaths, publicationRoot });
  const pointerPath = path.join(publicationRoot, "accepted-pointer.json");
  const pointerBefore = await readFile(pointerPath);
  const changedContract = JSON.parse(await readFile(sourcePaths.contractPath, "utf8"));
  changedContract.caption = "A successor coordinate exercises no-replace promotion ownership.";
  const changedContractPath = path.join(root, "changed-contract.json");
  await writeFile(changedContractPath, `${JSON.stringify(changedContract, null, 2)}\n`);
  let collidingDirectory;
  let collisionIdentity;

  await assert.rejects(
    publishArtifactFamily({
      ...sourcePaths,
      contractPath: changedContractPath,
      publicationRoot,
      faultInjector: async ({ checkpoint, acceptedDir }) => {
        if (checkpoint !== "before_candidate_rename") return;
        collidingDirectory = acceptedDir;
        await mkdir(collidingDirectory);
        collisionIdentity = await lstat(collidingDirectory);
      },
    }),
    error => error instanceof VisualArtifactError
      && error.code === "accepted_integrity_mismatch",
  );
  const retainedIdentity = await lstat(collidingDirectory);
  assert.equal(retainedIdentity.dev, collisionIdentity.dev);
  assert.equal(retainedIdentity.ino, collisionIdentity.ino);
  assert.deepEqual(await readdir(collidingDirectory), []);
  assert.deepEqual(await readFile(pointerPath), pointerBefore);
});

test("reservation replacement stops pointer promotion at accepted-coordinate recovery", async () => {
  const root = await temporaryDirectory("reservation-replacement");
  const publicationRoot = path.join(root, "publication");
  await publishArtifactFamily({ ...sourcePaths, publicationRoot });
  const pointerPath = path.join(publicationRoot, "accepted-pointer.json");
  const pointerBefore = await readFile(pointerPath);
  const changedContract = JSON.parse(await readFile(sourcePaths.contractPath, "utf8"));
  changedContract.caption = "A successor coordinate exercises reservation replacement recovery.";
  const changedContractPath = path.join(root, "changed-contract.json");
  await writeFile(changedContractPath, `${JSON.stringify(changedContract, null, 2)}\n`);
  let replacementPath;
  let heldPath;

  await assert.rejects(
    publishArtifactFamily({
      ...sourcePaths,
      contractPath: changedContractPath,
      publicationRoot,
      faultInjector: async ({ checkpoint, reservationPath }) => {
        if (checkpoint !== "before_reservation_release") return;
        replacementPath = reservationPath;
        heldPath = `${reservationPath}.held`;
        await rename(reservationPath, heldPath);
        await mkdir(reservationPath);
      },
    }),
    error => error instanceof VisualArtifactError
      && error.code === "publication_reservation_release_failed"
      && error.details.restartFrom === "accepted_coordinate_recovery"
      && error.details.action === "inspect_or_quarantine"
      && /^[a-f0-9]{64}$/u.test(error.details.acceptedCoordinate)
      && error.details.failure.code === "publication_boundary_invalid"
      && error.details.failure.boundary === "accepted_reservation",
  );
  assert.ok((await lstat(replacementPath)).isDirectory());
  assert.ok((await lstat(heldPath)).isDirectory());
  assert.deepEqual(await readFile(pointerPath), pointerBefore);
});

test("a nonempty reservation stops pointer promotion and remains inspectable", async () => {
  const root = await temporaryDirectory("reservation-nonempty");
  const publicationRoot = path.join(root, "publication");
  await publishArtifactFamily({ ...sourcePaths, publicationRoot });
  const pointerPath = path.join(publicationRoot, "accepted-pointer.json");
  const pointerBefore = await readFile(pointerPath);
  const changedContract = JSON.parse(await readFile(sourcePaths.contractPath, "utf8"));
  changedContract.caption = "A successor coordinate exercises nonempty reservation recovery.";
  const changedContractPath = path.join(root, "changed-contract.json");
  await writeFile(changedContractPath, `${JSON.stringify(changedContract, null, 2)}\n`);
  let retainedFile;

  await assert.rejects(
    publishArtifactFamily({
      ...sourcePaths,
      contractPath: changedContractPath,
      publicationRoot,
      faultInjector: async ({ checkpoint, reservationPath }) => {
        if (checkpoint !== "before_reservation_release") return;
        retainedFile = path.join(reservationPath, "owner-note.txt");
        await writeFile(retainedFile, "retained for accepted-coordinate inspection\n");
      },
    }),
    error => error instanceof VisualArtifactError
      && error.code === "publication_reservation_release_failed"
      && error.details.restartFrom === "accepted_coordinate_recovery"
      && error.details.failure.code === "ENOTEMPTY"
      && error.details.failure.boundary === "accepted_reservation",
  );
  assert.equal(await readFile(retainedFile, "utf8"), "retained for accepted-coordinate inspection\n");
  assert.deepEqual(await readFile(pointerPath), pointerBefore);
});

test("a primary promotion failure retains bounded reservation-cleanup context", async () => {
  const root = await temporaryDirectory("reservation-primary-and-cleanup");
  const publicationRoot = path.join(root, "publication");
  await publishArtifactFamily({ ...sourcePaths, publicationRoot });
  const pointerPath = path.join(publicationRoot, "accepted-pointer.json");
  const pointerBefore = await readFile(pointerPath);
  const changedContract = JSON.parse(await readFile(sourcePaths.contractPath, "utf8"));
  changedContract.caption = "A successor coordinate exercises primary and cleanup failure retention.";
  const changedContractPath = path.join(root, "changed-contract.json");
  await writeFile(changedContractPath, `${JSON.stringify(changedContract, null, 2)}\n`);

  await assert.rejects(
    publishArtifactFamily({
      ...sourcePaths,
      contractPath: changedContractPath,
      publicationRoot,
      faultInjector: async ({ checkpoint, reservationPath }) => {
        if (checkpoint !== "before_reservation_release") return;
        await writeFile(path.join(reservationPath, "owner-note.txt"), "retained after primary failure\n");
        throw new VisualArtifactError(
          "injected_fault",
          "The injected primary failure stopped promotion before reservation release.",
          { checkpoint: "before_reservation_release" },
        );
      },
    }),
    error => error instanceof VisualArtifactError
      && error.code === "injected_fault"
      && error.details.checkpoint === "accepted_reservation_release"
      && error.details.restartFrom === "accepted_coordinate_recovery"
      && error.details.action === "inspect_or_quarantine"
      && /^[a-f0-9]{64}$/u.test(error.details.acceptedCoordinate)
      && Object.keys(error.details.cleanupFailure).sort().join(",") === "boundary,code,recovery"
      && error.details.cleanupFailure.code === "publication_reservation_release_failed"
      && error.details.cleanupFailure.boundary === "accepted_reservation"
      && error.details.cleanupFailure.recovery === "accepted_coordinate_recovery",
  );
  assert.deepEqual(await readFile(pointerPath), pointerBefore);
});

test("cleanup reporting admits a hostile primary error without invoking proxy traps", async () => {
  const root = await temporaryDirectory("reservation-hostile-primary");
  const publicationRoot = path.join(root, "publication");
  await publishArtifactFamily({ ...sourcePaths, publicationRoot });
  const pointerPath = path.join(publicationRoot, "accepted-pointer.json");
  const pointerBefore = await readFile(pointerPath);
  const changedContract = JSON.parse(await readFile(sourcePaths.contractPath, "utf8"));
  changedContract.caption = "A successor coordinate exercises hostile primary error admission.";
  const changedContractPath = path.join(root, "changed-contract.json");
  await writeFile(changedContractPath, `${JSON.stringify(changedContract, null, 2)}\n`);
  let trapCalls = 0;
  const hostilePrimary = new Proxy(
    new VisualArtifactError("hostile_primary", "A caller-controlled primary failure.", { boundary: "caller" }),
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
    publishArtifactFamily({
      ...sourcePaths,
      contractPath: changedContractPath,
      publicationRoot,
      faultInjector: async ({ checkpoint, reservationPath }) => {
        if (checkpoint !== "before_reservation_release") return;
        await writeFile(path.join(reservationPath, "owner-note.txt"), "retained after hostile primary\n");
        throw hostilePrimary;
      },
    }),
    error => {
      observed = error;
      return error instanceof VisualArtifactError
        && error.code === "publication_failed"
        && !Object.hasOwn(error, "cause")
        && error.details.primaryFailure.code === "publication_failed"
        && error.details.cleanupFailure.code === "publication_reservation_release_failed";
    },
  );
  assertReferenceUnreachable(observed, hostilePrimary);
  assert.equal(trapCalls, 0);
  assert.deepEqual(await readFile(pointerPath), pointerBefore);
});

test("successful cleanup reconstructs an admitted typed publication failure", async () => {
  const root = await temporaryDirectory("owned-typed-primary");
  const publicationRoot = path.join(root, "publication");
  await publishArtifactFamily({ ...sourcePaths, publicationRoot });
  const pointerPath = path.join(publicationRoot, "accepted-pointer.json");
  const pointerBefore = await readFile(pointerPath);
  const changedContract = JSON.parse(await readFile(sourcePaths.contractPath, "utf8"));
  changedContract.caption = "A successor coordinate exercises owned typed error admission.";
  const changedContractPath = path.join(root, "changed-contract.json");
  await writeFile(changedContractPath, `${JSON.stringify(changedContract, null, 2)}\n`);
  const callerFailure = new VisualArtifactError(
    "injected_typed_primary",
    "A caller-supplied typed failure stopped publication.",
    { checkpoint: "before_reservation_release", restartFrom: "pointer" },
  );
  let getterCalls = 0;
  Object.defineProperty(callerFailure, "privateDiagnostic", {
    configurable: true,
    get() {
      getterCalls += 1;
      throw new Error("caller diagnostic getter must remain idle");
    },
  });
  let observed;

  await assert.rejects(
    publishArtifactFamily({
      ...sourcePaths,
      contractPath: changedContractPath,
      publicationRoot,
      faultInjector: async ({ checkpoint }) => {
        if (checkpoint === "before_reservation_release") throw callerFailure;
      },
    }),
    error => {
      observed = error;
      return error instanceof VisualArtifactError
        && error.code === "injected_typed_primary"
        && error.message === "A caller-supplied typed failure stopped publication."
        && error.details.checkpoint === "before_reservation_release"
        && error.details.restartFrom === "pointer"
        && !Object.hasOwn(error, "cause");
    },
  );
  assert.notEqual(observed, callerFailure);
  assertReferenceUnreachable(observed, callerFailure);
  assert.equal(getterCalls, 0);
  assert.deepEqual(await readFile(pointerPath), pointerBefore);
});

test("cleanup reporting inspects primary accessors as descriptors and leaves their getters idle", async () => {
  const root = await temporaryDirectory("reservation-accessor-primary");
  const publicationRoot = path.join(root, "publication");
  await publishArtifactFamily({ ...sourcePaths, publicationRoot });
  const pointerPath = path.join(publicationRoot, "accepted-pointer.json");
  const pointerBefore = await readFile(pointerPath);
  const changedContract = JSON.parse(await readFile(sourcePaths.contractPath, "utf8"));
  changedContract.caption = "A successor coordinate exercises accessor primary error admission.";
  const changedContractPath = path.join(root, "changed-contract.json");
  await writeFile(changedContractPath, `${JSON.stringify(changedContract, null, 2)}\n`);
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
    publishArtifactFamily({
      ...sourcePaths,
      contractPath: changedContractPath,
      publicationRoot,
      faultInjector: async ({ checkpoint, reservationPath }) => {
        if (checkpoint !== "before_reservation_release") return;
        await writeFile(path.join(reservationPath, "owner-note.txt"), "retained after accessor primary\n");
        throw hostilePrimary;
      },
    }),
    error => error instanceof VisualArtifactError
      && error.code === "publication_failed"
      && !Object.hasOwn(error, "cause")
      && error.details.primaryFailure.code === "publication_failed"
      && error.details.cleanupFailure.code === "publication_reservation_release_failed",
  );
  assert.equal(getterCalls, 0);
  assert.deepEqual(await readFile(pointerPath), pointerBefore);
});

test("cleanup reporting bounds oversized primary strings before UTF-8 measurement", async () => {
  const root = await temporaryDirectory("reservation-oversized-primary");
  const publicationRoot = path.join(root, "publication");
  await publishArtifactFamily({ ...sourcePaths, publicationRoot });
  const pointerPath = path.join(publicationRoot, "accepted-pointer.json");
  const pointerBefore = await readFile(pointerPath);
  const changedContract = JSON.parse(await readFile(sourcePaths.contractPath, "utf8"));
  changedContract.caption = "A successor coordinate exercises bounded primary error admission.";
  const changedContractPath = path.join(root, "changed-contract.json");
  await writeFile(changedContractPath, `${JSON.stringify(changedContract, null, 2)}\n`);
  const oversizedPrimary = new VisualArtifactError("c".repeat(513), "m".repeat(4_097));

  await assert.rejects(
    publishArtifactFamily({
      ...sourcePaths,
      contractPath: changedContractPath,
      publicationRoot,
      faultInjector: async ({ checkpoint, reservationPath }) => {
        if (checkpoint !== "before_reservation_release") return;
        await writeFile(path.join(reservationPath, "owner-note.txt"), "retained after oversized primary\n");
        throw oversizedPrimary;
      },
    }),
    error => error instanceof VisualArtifactError
      && error.code === "publication_failed"
      && !Object.hasOwn(error, "cause")
      && error.details.restartFrom === "accepted_coordinate_recovery"
      && error.details.action === "inspect_or_quarantine"
      && /^[a-f0-9]{64}$/u.test(error.details.acceptedCoordinate)
      && error.details.primaryFailure.code === "publication_failed"
      && error.details.cleanupFailure.code === "publication_reservation_release_failed",
  );
  assert.deepEqual(await readFile(pointerPath), pointerBefore);
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

test("different-digest publishers compare the captured pointer under one process-safe reservation", async () => {
  const root = await temporaryDirectory("cross-digest-pointer-cas");
  const publicationRoot = path.join(root, "publication");
  const baseline = await publishArtifactFamily({ ...sourcePaths, publicationRoot });
  const firstContract = JSON.parse(await readFile(sourcePaths.contractPath, "utf8"));
  firstContract.caption = "The first concurrent pointer candidate.";
  const firstContractPath = path.join(root, "first-contract.json");
  await writeFile(firstContractPath, `${JSON.stringify(firstContract, null, 2)}\n`);
  const secondContract = JSON.parse(await readFile(sourcePaths.contractPath, "utf8"));
  secondContract.caption = "The second concurrent pointer candidate.";
  const secondContractPath = path.join(root, "second-contract.json");
  await writeFile(secondContractPath, `${JSON.stringify(secondContract, null, 2)}\n`);
  let releaseFirst;
  const firstMayCommit = new Promise(resolvePromise => { releaseFirst = resolvePromise; });
  let firstOwnsPointer;
  const firstOwnsPointerSignal = new Promise(resolvePromise => { firstOwnsPointer = resolvePromise; });
  let secondCapturedPrior;
  const secondCapturedPriorSignal = new Promise(resolvePromise => { secondCapturedPrior = resolvePromise; });

  const first = publishArtifactFamily({
    ...sourcePaths,
    contractPath: firstContractPath,
    publicationRoot,
    faultInjector: async ({ checkpoint }) => {
      if (checkpoint !== "after_pointer_reservation_acquired") return;
      firstOwnsPointer();
      await firstMayCommit;
    },
  });
  await firstOwnsPointerSignal;
  const second = publishArtifactFamily({
    ...sourcePaths,
    contractPath: secondContractPath,
    publicationRoot,
    faultInjector: async ({ checkpoint }) => {
      if (checkpoint === "before_pointer_reservation_acquire") secondCapturedPrior();
    },
  });
  await secondCapturedPriorSignal;
  releaseFirst();

  const firstResult = await first;
  await assert.rejects(
    second,
    error => error instanceof VisualArtifactError && error.code === "publication_pointer_conflict",
  );
  assert.notEqual(firstResult.manifestDigest, baseline.manifestDigest);
  assert.equal(
    JSON.parse(await readFile(path.join(publicationRoot, "accepted-pointer.json"), "utf8")).manifestDigest,
    firstResult.manifestDigest,
  );
  assert.equal((await readdir(publicationRoot)).includes(".accepted-pointer.reservation"), false);
});

test("pointer commit rejects a replaced pointer reservation and preserves primary authority", async () => {
  const root = await temporaryDirectory("pointer-reservation-replacement");
  const publicationRoot = path.join(root, "publication");
  await publishArtifactFamily({ ...sourcePaths, publicationRoot });
  const pointerPath = path.join(publicationRoot, "accepted-pointer.json");
  const pointerBefore = await readFile(pointerPath);
  const changedContract = JSON.parse(await readFile(sourcePaths.contractPath, "utf8"));
  changedContract.caption = "A successor coordinate exercises pointer reservation replacement.";
  const changedContractPath = path.join(root, "changed-contract.json");
  await writeFile(changedContractPath, `${JSON.stringify(changedContract, null, 2)}\n`);
  let replacementPath;

  await assert.rejects(
    publishArtifactFamily({
      ...sourcePaths,
      contractPath: changedContractPath,
      publicationRoot,
      faultInjector: async ({ checkpoint, pointerReservationPath }) => {
        if (checkpoint !== "after_pointer_reservation_acquired") return;
        await rename(pointerReservationPath, `${pointerReservationPath}.held`);
        replacementPath = pointerReservationPath;
        await writeFile(pointerReservationPath, "replacement pointer owner\n", "utf8");
      },
    }),
    error => error instanceof VisualArtifactError
      && error.code === "publication_boundary_invalid"
      && error.details.boundary === "pointer_reservation"
      && error.details.checkpoint === "pointer_reservation_release"
      && error.details.restartFrom === "accepted_coordinate_recovery"
      && error.details.action === "inspect_or_quarantine"
      && /^[a-f0-9]{64}$/u.test(error.details.acceptedCoordinate)
      && error.details.cleanupFailure.code === "publication_pointer_reservation_release_failed"
      && error.details.cleanupFailure.boundary === "pointer_reservation",
  );
  assert.equal(await readFile(replacementPath, "utf8"), "replacement pointer owner\n");
  assert.deepEqual(await readFile(pointerPath), pointerBefore);
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
      && error.details.restartFrom === "accepted_coordinate_recovery"
      && error.details.action === "inspect_or_quarantine"
      && /^[a-f0-9]{64}$/u.test(error.details.acceptedCoordinate)
      && error.details.checkpoint === "existing_accepted_verified"
      && error.details.relativePath === "semantic-companion.json",
  );
  assert.equal(await readFile(pointerPath, "utf8"), firstPointer);
  assert.equal(await readFile(corruptedPath, "utf8"), "{\"corrupted\":true}\n");
});

test("rejects an oversized accepted output before allocating its body", async () => {
  const root = await temporaryDirectory("oversized-accepted");
  const publicationRoot = path.join(root, "publication");
  const first = await publishArtifactFamily({ ...sourcePaths, publicationRoot });
  const pointerPath = path.join(publicationRoot, "accepted-pointer.json");
  const firstPointer = await readFile(pointerPath, "utf8");
  const acceptedOutput = path.join(
    publicationRoot,
    "accepted",
    first.manifestDigest,
    "semantic-companion.json",
  );
  await truncate(acceptedOutput, DEFAULT_RESOURCE_LIMITS.outputBytes + 1);

  await assert.rejects(
    publishArtifactFamily({ ...sourcePaths, publicationRoot }),
    error => error instanceof VisualArtifactError
      && error.code === "accepted_integrity_mismatch"
      && error.details.relativePath === "semantic-companion.json",
  );
  assert.equal(await readFile(pointerPath, "utf8"), firstPointer);
});

test("bounds accepted inventory depth and entry count to the declared artifact family", async () => {
  const root = await temporaryDirectory("accepted-inventory-envelope");
  const publicationRoot = path.join(root, "publication");
  const first = await publishArtifactFamily({ ...sourcePaths, publicationRoot });
  const pointerPath = path.join(publicationRoot, "accepted-pointer.json");
  const firstPointer = await readFile(pointerPath, "utf8");
  const unexpected = path.join(
    publicationRoot,
    "accepted",
    first.manifestDigest,
    "unexpected",
    "nested",
  );
  await mkdir(unexpected, { recursive: true });
  await writeFile(path.join(unexpected, "extra.txt"), "extra\n");

  await assert.rejects(
    publishArtifactFamily({ ...sourcePaths, publicationRoot }),
    error => error instanceof VisualArtifactError && error.code === "accepted_integrity_mismatch",
  );
  assert.equal(await readFile(pointerPath, "utf8"), firstPointer);
});
