import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rename, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OBSERVER_RESOURCE_LIMITS, ObserverError } from "../src/contracts.mjs";
import { humanReceipt, publishReceipt } from "../src/publication.mjs";
import { artifactSources, makeReceipt, subjectSourcePath } from "./helpers.mjs";

test("candidate promotion moves one accepted pointer after verification", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-receipt-"));
  const pointer = await publishReceipt(root, makeReceipt(), { artifactSources: artifactSources() });
  assert.equal(pointer.receiptId, "semantic-chromium-baseline");
  assert.deepEqual(JSON.parse(await readFile(join(root, "accepted-pointer.json"), "utf8")), pointer);
});

test("publication requires a caller-owned root and returns typed recovery when it is absent", async () => {
  const container = await mkdtemp(join(tmpdir(), "visual-receipt-root-owner-"));
  const root = join(container, "nested", "receipt-root");

  await assert.rejects(
    publishReceipt(root, makeReceipt(), { artifactSources: artifactSources() }),
    error => error instanceof ObserverError
      && error.code === "PUBLICATION_BOUNDARY_INVALID"
      && error.details.boundary === "root"
      && error.details.reason === "ENOENT"
      && error.details.restartFrom === "publication_root",
  );
  assert.deepEqual(await readdir(container), []);
});

test("owned-root provisioning rejects a prepared intermediate symbolic link", async () => {
  const owner = await mkdtemp(join(tmpdir(), "visual-receipt-owned-root-link-"));
  const artifacts = join(owner, ".artifacts");
  const outside = join(owner, "outside");
  await mkdir(artifacts);
  await mkdir(outside);
  await symlink(outside, join(artifacts, "receipts"), "dir");

  await assert.rejects(
    publishReceipt(
      join(artifacts, "receipts", "browser", "case"),
      makeReceipt(),
      { artifactSources: artifactSources(), ownerRoot: owner },
    ),
    error => error instanceof ObserverError
      && error.code === "PUBLICATION_BOUNDARY_INVALID"
      && error.details.boundary === "root_ancestor..artifacts/receipts"
      && error.details.reason === "regular_directory_required"
      && error.details.restartFrom === "publication_root",
  );
  assert.deepEqual(await readdir(outside), []);
});

test("owned-root provisioning rejects publication-root replacement after capture", async () => {
  const owner = await mkdtemp(join(tmpdir(), "visual-receipt-owned-root-swap-"));
  const root = join(owner, ".artifacts", "receipts");
  const heldRoot = join(owner, "held-receipts");
  const outside = join(owner, "outside");
  await mkdir(outside);

  await assert.rejects(
    publishReceipt(root, makeReceipt(), {
      artifactSources: artifactSources(),
      ownerRoot: owner,
      injectFault: async ({ checkpoint, directoryPath, isPublicationRoot }) => {
        if (checkpoint !== "after_publication_directory_capture" || !isPublicationRoot) return;
        await rename(directoryPath, heldRoot);
        await symlink(outside, directoryPath, "dir");
      },
    }),
    error => error instanceof ObserverError
      && error.code === "PUBLICATION_BOUNDARY_INVALID"
      && error.details.boundary === "root"
      && error.details.reason === "directory_identity_changed"
      && error.details.restartFrom === "publication_root",
  );
  assert.deepEqual(await readdir(outside), []);
});

test("publication rejects receipt accessors before allocation and leaves the getter idle", async () => {
  const container = await mkdtemp(join(tmpdir(), "visual-receipt-admission-"));
  const root = join(container, "receipt-root");
  const receipt = makeReceipt();
  let getterCalls = 0;
  Object.defineProperty(receipt.result.normalized, "accessibleName", {
    configurable: true,
    enumerable: true,
    get() {
      getterCalls += 1;
      return "Specimen family";
    },
  });

  await assert.rejects(
    publishReceipt(root, receipt, { artifactSources: artifactSources() }),
    error => error instanceof ObserverError
      && error.code === "INVALID_CONTRACT"
      && error.details.boundary === "receipt.result.normalized"
      && error.details.reason === "accessor_fields_present",
  );
  assert.equal(getterCalls, 0);
  assert.deepEqual(await readdir(container), []);
});

test("publication rejects symlinked root and owned directory coordinates before writing", async () => {
  for (const boundary of ["root", ".candidates", "accepted"]) {
    const container = await mkdtemp(join(tmpdir(), "visual-receipt-boundary-"));
    const outside = join(container, "outside");
    const actualRoot = join(container, "actual-root");
    await mkdir(outside);
    await mkdir(actualRoot);
    let root = actualRoot;
    if (boundary === "root") {
      root = join(container, "receipt-root");
      await symlink(actualRoot, root);
    } else {
      await symlink(outside, join(root, boundary));
    }

    await assert.rejects(
      publishReceipt(root, makeReceipt(), { artifactSources: artifactSources() }),
      error => error instanceof ObserverError
        && error.code === "PUBLICATION_BOUNDARY_INVALID"
        && error.details.boundary === boundary,
    );
    assert.deepEqual(await readdir(outside), []);
  }
});

test("publication keeps its candidate parent and invocation directory private", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-receipt-private-candidate-"));
  let observedCandidateMode = null;
  let observedParentMode = null;
  await publishReceipt(root, makeReceipt(), {
    artifactSources: artifactSources(),
    injectFault: async ({ checkpoint, candidate, candidateParent }) => {
      if (checkpoint !== "before_candidate_rename") return;
      observedCandidateMode = (await lstat(candidate)).mode & 0o077;
      observedParentMode = (await lstat(candidateParent)).mode & 0o077;
    },
  });

  assert.equal(observedParentMode, 0);
  assert.equal(observedCandidateMode, 0);
});

test("publication tightens a candidate parent retained by an earlier release", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-receipt-candidate-upgrade-"));
  const candidateParent = join(root, ".candidates");
  await mkdir(candidateParent, { mode: 0o755 });
  // Make the migration precondition independent from the process umask.
  await chmod(candidateParent, 0o755);
  assert.equal((await lstat(candidateParent)).mode & 0o077, 0o055);

  const pointer = await publishReceipt(root, makeReceipt(), {
    artifactSources: artifactSources(),
  });

  assert.equal((await lstat(candidateParent)).mode & 0o077, 0);
  assert.deepEqual(JSON.parse(await readFile(join(root, "accepted-pointer.json"), "utf8")), pointer);
});

test("publication checks captured candidate-parent identity before every file write", async () => {
  const container = await mkdtemp(join(tmpdir(), "visual-receipt-write-parent-swap-"));
  const root = join(container, "receipt-root");
  const outside = join(container, "outside");
  const heldCandidates = join(container, "held-candidates");
  await mkdir(root);
  await mkdir(outside);
  let swapped = false;

  await assert.rejects(
    publishReceipt(root, makeReceipt(), {
      artifactSources: artifactSources(),
      injectFault: async ({ checkpoint, candidateParent }) => {
        if (checkpoint !== "before_candidate_file_write" || swapped) return;
        swapped = true;
        await rename(candidateParent, heldCandidates);
        await symlink(outside, candidateParent);
      },
    }),
    error => error instanceof ObserverError
      && error.code === "PUBLICATION_BOUNDARY_INVALID"
      && error.details.boundary === ".candidates"
      && error.details.restartFrom === "publication_root",
  );
  assert.deepEqual(await readdir(outside), []);
});

test("publication verifies every candidate leaf after each write", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-receipt-write-leaf-swap-"));
  let changed = false;

  await assert.rejects(
    publishReceipt(root, makeReceipt(), {
      artifactSources: artifactSources(),
      injectFault: async ({ checkpoint, path, receiptPath }) => {
        if (checkpoint !== "after_candidate_file_write" || changed || receiptPath !== "artifacts/receiver.html") return;
        changed = true;
        const bytes = await readFile(path);
        bytes[0] ^= 1;
        await writeFile(path, bytes);
      },
    }),
    error => error instanceof ObserverError
      && error.code === "PUBLICATION_BOUNDARY_INVALID"
      && error.details.boundary === "candidate_file.artifacts/receiver.html"
      && error.details.reason === "file_bytes_changed"
      && error.details.restartFrom === "candidate",
  );
  assert.deepEqual(await readdir(join(root, ".candidates")), []);
});

for (const swapBoundary of [".candidates", "accepted"]) {
  test(`publication rejects ${swapBoundary} replacement before candidate promotion`, async () => {
    const container = await mkdtemp(join(tmpdir(), "visual-receipt-swap-"));
    const root = join(container, "receipt-root");
    const outside = join(container, "outside");
    await mkdir(root);
    await mkdir(outside);
    const accepted = await publishReceipt(root, makeReceipt(), { artifactSources: artifactSources() });
    const pointerBefore = await readFile(join(root, "accepted-pointer.json"));
    const successor = makeReceipt();
    successor.receiptId = `swap-${swapBoundary.slice(1)}`;

    await assert.rejects(
      publishReceipt(root, successor, {
        artifactSources: artifactSources(),
        injectFault: async ({ checkpoint }) => {
          if (checkpoint !== "before_candidate_rename") return;
          const ownedPath = join(root, swapBoundary);
          await rename(ownedPath, `${ownedPath}-held`);
          await symlink(outside, ownedPath);
        },
      }),
      error => error instanceof ObserverError
        && error.code === "PUBLICATION_BOUNDARY_INVALID"
        && error.details.boundary === swapBoundary,
    );
    assert.deepEqual(await readdir(outside), []);
    assert.deepEqual(await readFile(join(root, "accepted-pointer.json")), pointerBefore);
    assert.deepEqual(JSON.parse(pointerBefore.toString("utf8")), accepted);
  });
}

test("publication rejects root replacement before pointer promotion", async () => {
  const container = await mkdtemp(join(tmpdir(), "visual-receipt-root-swap-"));
  const root = join(container, "receipt-root");
  const heldRoot = join(container, "receipt-root-held");
  const outside = join(container, "outside");
  await mkdir(root);
  await mkdir(outside);
  await publishReceipt(root, makeReceipt(), { artifactSources: artifactSources() });
  const pointerBefore = await readFile(join(root, "accepted-pointer.json"));
  const successor = makeReceipt();
  successor.receiptId = "swap-root-before-pointer";

  await assert.rejects(
    publishReceipt(root, successor, {
      artifactSources: artifactSources(),
      injectFault: async ({ checkpoint }) => {
        if (checkpoint !== "before_pointer_rename") return;
        await rename(root, heldRoot);
        await symlink(outside, root);
      },
    }),
    error => error instanceof ObserverError
      && error.code === "PUBLICATION_BOUNDARY_INVALID"
      && error.details.boundary === "root",
  );
  assert.deepEqual(await readdir(outside), []);
  assert.deepEqual(await readFile(join(heldRoot, "accepted-pointer.json")), pointerBefore);
});

test("publication rejects a symbolic-link artifact source before capture", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-receipt-"));
  const linkedSource = join(root, "receiver-link.html");
  await symlink(subjectSourcePath, linkedSource);
  const receipt = makeReceipt();
  const sources = artifactSources();
  sources[receipt.artifacts[0].path] = linkedSource;

  await assert.rejects(
    publishReceipt(root, receipt, { artifactSources: sources }),
    error => error instanceof ObserverError && error.code === "SOURCE_FILE_INVALID" && error.details.restartFrom === "candidate",
  );
  assert.deepEqual(await readdir(join(root, ".candidates")), []);
});

test("publication rejects an oversized sparse artifact before reading its body", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-receipt-"));
  const sparseSource = join(root, "oversized-sparse.bin");
  await writeFile(sparseSource, Buffer.from([0]));
  await truncate(sparseSource, OBSERVER_RESOURCE_LIMITS.artifactBytes + 1);
  const receipt = makeReceipt();
  const sources = artifactSources();
  sources[receipt.artifacts[0].path] = sparseSource;

  await assert.rejects(
    publishReceipt(root, receipt, { artifactSources: sources }),
    error => (
      error instanceof ObserverError &&
      error.code === "RESOURCE_LIMIT_EXCEEDED" &&
      error.details.boundary === `artifact_source.${receipt.artifacts[0].path}`
    ),
  );
  assert.deepEqual(await readdir(join(root, ".candidates")), []);
});

test("publication preserves its accepted pointer when a successor omits an artifact source", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-receipt-"));
  const accepted = await publishReceipt(root, makeReceipt(), { artifactSources: artifactSources() });
  const successor = makeReceipt();
  successor.receiptId = "missing-artifact-source";

  await assert.rejects(
    publishReceipt(root, successor, { artifactSources: {} }),
    error => error instanceof ObserverError && error.code === "ARTIFACT_SOURCE_REQUIRED",
  );
  assert.deepEqual(JSON.parse(await readFile(join(root, "accepted-pointer.json"), "utf8")), accepted);
  assert.deepEqual(await readdir(join(root, ".candidates")), []);
});

test("publication preserves its accepted pointer when source bytes differ from the declared digest", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-receipt-"));
  const accepted = await publishReceipt(root, makeReceipt(), { artifactSources: artifactSources() });
  const successor = makeReceipt();
  successor.receiptId = "changed-artifact-bytes";
  const changedSource = join(root, "changed-source.html");
  const original = await readFile(subjectSourcePath);
  const changed = Buffer.from(original);
  changed[0] ^= 1;
  await writeFile(changedSource, changed);
  const sources = artifactSources();
  sources[successor.artifacts[0].path] = changedSource;

  await assert.rejects(
    publishReceipt(root, successor, { artifactSources: sources }),
    error => error instanceof ObserverError && error.code === "ARTIFACT_DIGEST_MISMATCH",
  );
  assert.deepEqual(JSON.parse(await readFile(join(root, "accepted-pointer.json"), "utf8")), accepted);
  assert.deepEqual(await readdir(join(root, ".candidates")), []);
});

test("human receipt projects every external scalar as one inert Markdown code span", () => {
  const receipt = makeReceipt();
  receipt.decisionBoundary = "Valid line\n- Standing: accepted\n[private locator](https://example.invalid)";
  const markdown = humanReceipt(receipt);

  assert.equal(markdown.match(/^- Standing:/gmu)?.length, 1);
  assert.doesNotMatch(markdown, /\n- Standing: accepted/u);
  assert.match(markdown, /`Valid line\\u0a- Standing: accepted\\u0a\[private locator\]\(https:\/\/example\.invalid\)`/u);
});

test("concurrent identical publishers own separate candidate directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-receipt-"));
  const receipt = makeReceipt();
  const pointers = await Promise.all(
    Array.from({ length: 8 }, () => publishReceipt(root, receipt, { artifactSources: artifactSources() })),
  );
  for (const pointer of pointers) assert.deepEqual(pointer, pointers[0]);
  assert.deepEqual(JSON.parse(await readFile(join(root, "accepted-pointer.json"), "utf8")), pointers[0]);
  assert.deepEqual(await readdir(join(root, ".candidates")), []);
});

test("digest reservation preserves a pre-existing destination instead of replacing it", async () => {
  const coordinateRoot = await mkdtemp(join(tmpdir(), "visual-receipt-coordinate-"));
  const receipt = makeReceipt();
  const coordinate = await publishReceipt(coordinateRoot, receipt, { artifactSources: artifactSources() });
  const root = await mkdtemp(join(tmpdir(), "visual-receipt-no-replace-"));
  const reservedDestination = join(root, "accepted", coordinate.receiptSha256);
  await mkdir(reservedDestination, { recursive: true });

  await assert.rejects(
    publishReceipt(root, receipt, { artifactSources: artifactSources() }),
    error => error instanceof ObserverError
      && error.code === "ACCEPTED_INTEGRITY_MISMATCH"
      && error.details.restartFrom === "accepted_coordinate_recovery"
      && error.details.action === "inspect_or_quarantine"
      && error.details.acceptedCoordinate === coordinate.receiptSha256,
  );
  assert.deepEqual(await readdir(reservedDestination), []);
  assert.deepEqual(await readdir(join(root, ".candidates")), []);
});

test("reservation replacement stops pointer promotion at accepted-coordinate recovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-receipt-reservation-replacement-"));
  const accepted = await publishReceipt(root, makeReceipt(), { artifactSources: artifactSources() });
  const pointerBefore = await readFile(join(root, "accepted-pointer.json"));
  const successor = makeReceipt();
  successor.receiptId = "reservation-replacement-successor";
  let replacementPath;
  let heldPath;

  await assert.rejects(
    publishReceipt(root, successor, {
      artifactSources: artifactSources(),
      injectFault: async ({ checkpoint, reservationPath }) => {
        if (checkpoint !== "before_reservation_release") return;
        replacementPath = reservationPath;
        heldPath = `${reservationPath}.held`;
        await rename(reservationPath, heldPath);
        await mkdir(reservationPath);
      },
    }),
    error => error instanceof ObserverError
      && error.code === "PUBLICATION_RESERVATION_RELEASE_FAILED"
      && error.details.restartFrom === "accepted_coordinate_recovery"
      && error.details.action === "inspect_or_quarantine"
      && /^[a-f0-9]{64}$/u.test(error.details.acceptedCoordinate)
      && error.details.failure.boundary === "destination_reservation",
  );
  assert.deepEqual(await readdir(replacementPath), []);
  assert.ok((await readFile(heldPath)).byteLength > 0);
  assert.deepEqual(await readFile(join(root, "accepted-pointer.json")), pointerBefore);
  assert.deepEqual(JSON.parse(pointerBefore.toString("utf8")), accepted);
});

test("a nonempty replacement reservation remains inspectable and stops pointer promotion", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-receipt-reservation-nonempty-"));
  const accepted = await publishReceipt(root, makeReceipt(), { artifactSources: artifactSources() });
  const pointerBefore = await readFile(join(root, "accepted-pointer.json"));
  const successor = makeReceipt();
  successor.receiptId = "reservation-nonempty-successor";
  let retainedFile;

  await assert.rejects(
    publishReceipt(root, successor, {
      artifactSources: artifactSources(),
      injectFault: async ({ checkpoint, reservationPath }) => {
        if (checkpoint !== "before_reservation_release") return;
        await rename(reservationPath, `${reservationPath}.held`);
        await mkdir(reservationPath);
        retainedFile = join(reservationPath, "owner-note.txt");
        await writeFile(retainedFile, "retained for accepted-coordinate inspection\n");
      },
    }),
    error => error instanceof ObserverError
      && error.code === "PUBLICATION_RESERVATION_RELEASE_FAILED"
      && error.details.restartFrom === "accepted_coordinate_recovery"
      && error.details.failure.boundary === "destination_reservation",
  );
  assert.equal(await readFile(retainedFile, "utf8"), "retained for accepted-coordinate inspection\n");
  assert.deepEqual(await readFile(join(root, "accepted-pointer.json")), pointerBefore);
  assert.deepEqual(JSON.parse(pointerBefore.toString("utf8")), accepted);
});

test("a primary publication failure retains bounded reservation-cleanup context", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-receipt-reservation-primary-cleanup-"));
  const accepted = await publishReceipt(root, makeReceipt(), { artifactSources: artifactSources() });
  const pointerBefore = await readFile(join(root, "accepted-pointer.json"));
  const successor = makeReceipt();
  successor.receiptId = "reservation-primary-cleanup-successor";

  await assert.rejects(
    publishReceipt(root, successor, {
      artifactSources: artifactSources(),
      injectFault: async ({ checkpoint, reservationPath }) => {
        if (checkpoint !== "before_reservation_release") return;
        await rename(reservationPath, `${reservationPath}.held`);
        await mkdir(reservationPath);
        await writeFile(join(reservationPath, "owner-note.txt"), "retained after primary failure\n");
        throw new ObserverError(
          "INJECTED_PRIMARY",
          "The injected primary failure stopped publication before reservation release.",
          { checkpoint: "before_reservation_release", restartFrom: "pointer" },
        );
      },
    }),
    error => error instanceof ObserverError
      && error.code === "INJECTED_PRIMARY"
      && error.details.checkpoint === "before_reservation_release"
      && Object.keys(error.details.cleanupFailure).sort().join(",") === "boundary,code,recovery"
      && error.details.cleanupFailure.code === "PUBLICATION_RESERVATION_RELEASE_FAILED"
      && error.details.cleanupFailure.boundary === "destination_reservation"
      && error.details.cleanupFailure.recovery === "accepted_coordinate_recovery",
  );
  assert.deepEqual(await readFile(join(root, "accepted-pointer.json")), pointerBefore);
  assert.deepEqual(JSON.parse(pointerBefore.toString("utf8")), accepted);
});

test("accepted leaf identity stays stable through pointer commit", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-receipt-accepted-identity-"));
  const accepted = await publishReceipt(root, makeReceipt(), { artifactSources: artifactSources() });
  const pointerBefore = await readFile(join(root, "accepted-pointer.json"));
  const successor = makeReceipt();
  successor.receiptId = "accepted-identity-successor";

  await assert.rejects(
    publishReceipt(root, successor, {
      artifactSources: artifactSources(),
      injectFault: async ({ checkpoint, destination }) => {
        if (checkpoint !== "before_pointer_rename") return;
        const path = join(destination, "receipt.md");
        const bytes = await readFile(path);
        await rename(path, `${path}.held`);
        await writeFile(path, bytes);
      },
    }),
    error => error instanceof ObserverError
      && error.code === "PUBLICATION_BOUNDARY_INVALID"
      && error.details.boundary === "accepted_file.receipt.md"
      && error.details.reason === "file_identity_changed"
      && error.details.restartFrom === "accepted_coordinate_recovery"
      && error.details.action === "inspect_or_quarantine"
      && /^[a-f0-9]{64}$/u.test(error.details.acceptedCoordinate),
  );
  assert.deepEqual(await readFile(join(root, "accepted-pointer.json")), pointerBefore);
  assert.deepEqual(JSON.parse(pointerBefore.toString("utf8")), accepted);
});

test("accepted leaf bytes stay exact through pointer commit", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-receipt-accepted-bytes-"));
  const accepted = await publishReceipt(root, makeReceipt(), { artifactSources: artifactSources() });
  const pointerBefore = await readFile(join(root, "accepted-pointer.json"));
  const successor = makeReceipt();
  successor.receiptId = "accepted-bytes-successor";

  await assert.rejects(
    publishReceipt(root, successor, {
      artifactSources: artifactSources(),
      injectFault: async ({ checkpoint, destination }) => {
        if (checkpoint !== "before_pointer_rename") return;
        const path = join(destination, "receipt.md");
        const bytes = await readFile(path);
        bytes[0] ^= 1;
        await writeFile(path, bytes);
      },
    }),
    error => error instanceof ObserverError
      && error.code === "ACCEPTED_INTEGRITY_MISMATCH"
      && error.details.path === "receipt.md"
      && error.details.restartFrom === "accepted_coordinate_recovery"
      && error.details.action === "inspect_or_quarantine"
      && /^[a-f0-9]{64}$/u.test(error.details.acceptedCoordinate),
  );
  assert.deepEqual(await readFile(join(root, "accepted-pointer.json")), pointerBefore);
  assert.deepEqual(JSON.parse(pointerBefore.toString("utf8")), accepted);
});

test("temporary pointer cleanup preserves a replacement outside invocation ownership", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-receipt-pointer-identity-"));
  const accepted = await publishReceipt(root, makeReceipt(), { artifactSources: artifactSources() });
  const pointerBefore = await readFile(join(root, "accepted-pointer.json"));
  const successor = makeReceipt();
  successor.receiptId = "temporary-pointer-successor";
  let replacementPath = null;

  await assert.rejects(
    publishReceipt(root, successor, {
      artifactSources: artifactSources(),
      injectFault: async ({ checkpoint, temporaryPointer }) => {
        if (checkpoint !== "after_pointer_write") return;
        replacementPath = temporaryPointer;
        await rename(temporaryPointer, `${temporaryPointer}.held`);
        await writeFile(temporaryPointer, "replacement from another owner\n");
      },
    }),
    error => error instanceof ObserverError
      && error.code === "PUBLICATION_BOUNDARY_INVALID"
      && error.details.boundary === "temporary_pointer"
      && error.details.reason === "file_identity_changed"
      && error.details.restartFrom === "pointer",
  );
  assert.equal(await readFile(replacementPath, "utf8"), "replacement from another owner\n");
  assert.deepEqual(await readFile(join(root, "accepted-pointer.json")), pointerBefore);
  assert.deepEqual(JSON.parse(pointerBefore.toString("utf8")), accepted);
});

test("unexpected pointer-stage failures retain an exact typed recovery coordinate", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-receipt-pointer-recovery-"));
  const accepted = await publishReceipt(root, makeReceipt(), { artifactSources: artifactSources() });
  const pointerBefore = await readFile(join(root, "accepted-pointer.json"));
  const successor = makeReceipt();
  successor.receiptId = "pointer-recovery-successor";

  await assert.rejects(
    publishReceipt(root, successor, {
      artifactSources: artifactSources(),
      injectFault: async ({ checkpoint }) => {
        if (checkpoint === "after_pointer_write") throw new Error("injected raw pointer failure");
      },
    }),
    error => error instanceof ObserverError
      && error.code === "PUBLICATION_FAILED"
      && error.details.reason === "injected raw pointer failure"
      && error.details.restartFrom === "pointer",
  );
  assert.deepEqual(await readFile(join(root, "accepted-pointer.json")), pointerBefore);
  assert.deepEqual(JSON.parse(pointerBefore.toString("utf8")), accepted);
  assert.equal((await readdir(root)).some(name => name.startsWith(".accepted-pointer.")), false);
});

for (const injectFault of ["after_candidate", "before_pointer"]) {
  test(`${injectFault} interruption preserves the previous accepted pointer`, async () => {
    const root = await mkdtemp(join(tmpdir(), "visual-receipt-"));
    const accepted = await publishReceipt(root, makeReceipt(), { artifactSources: artifactSources() });
    const successor = makeReceipt();
    successor.receiptId = `successor-${injectFault}`;
    await assert.rejects(
      publishReceipt(root, successor, { injectFault, artifactSources: artifactSources() }),
      error => Boolean(error instanceof ObserverError && error.code === "INJECTED_INTERRUPTION" && error.details.restartFrom),
    );
    assert.deepEqual(JSON.parse(await readFile(join(root, "accepted-pointer.json"), "utf8")), accepted);
  });
}

test("replay rejects a corrupted digest-addressed destination before moving the pointer", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-receipt-"));
  const receipt = makeReceipt();
  const pointer = await publishReceipt(root, receipt, { artifactSources: artifactSources() });
  const acceptedDirectory = join(root, "accepted", pointer.receiptSha256);
  await writeFile(join(acceptedDirectory, "receipt.md"), "corrupted\n");

  await assert.rejects(
    publishReceipt(root, receipt, { artifactSources: artifactSources() }),
    error => error instanceof ObserverError
      && error.code === "ACCEPTED_INTEGRITY_MISMATCH"
      && error.details.restartFrom === "accepted_coordinate_recovery"
      && error.details.action === "inspect_or_quarantine"
      && error.details.acceptedCoordinate === pointer.receiptSha256,
  );
  assert.deepEqual(JSON.parse(await readFile(join(root, "accepted-pointer.json"), "utf8")), pointer);
});

test("replay bounds accepted inventory depth and entry count to the declared receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-receipt-"));
  const receipt = makeReceipt();
  const pointer = await publishReceipt(root, receipt, { artifactSources: artifactSources() });
  const acceptedDirectory = join(root, "accepted", pointer.receiptSha256);
  await mkdir(join(acceptedDirectory, "artifacts", "unexpected", "nested"), { recursive: true });
  await writeFile(join(acceptedDirectory, "artifacts", "unexpected", "nested", "extra.txt"), "extra\n");

  await assert.rejects(
    publishReceipt(root, receipt, { artifactSources: artifactSources() }),
    error => error instanceof ObserverError
      && error.code === "ACCEPTED_INTEGRITY_MISMATCH",
  );
  assert.deepEqual(JSON.parse(await readFile(join(root, "accepted-pointer.json"), "utf8")), pointer);
});

test("replay rejects an oversized accepted file before allocating its body", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-receipt-"));
  const receipt = makeReceipt();
  const pointer = await publishReceipt(root, receipt, { artifactSources: artifactSources() });
  const acceptedMarkdown = join(root, "accepted", pointer.receiptSha256, "receipt.md");
  await truncate(acceptedMarkdown, OBSERVER_RESOURCE_LIMITS.artifactBytes + 1);

  await assert.rejects(
    publishReceipt(root, receipt, { artifactSources: artifactSources() }),
    error => error instanceof ObserverError
      && error.code === "ACCEPTED_INTEGRITY_MISMATCH"
      && error.details.path === "receipt.md",
  );
  assert.deepEqual(JSON.parse(await readFile(join(root, "accepted-pointer.json"), "utf8")), pointer);
});
