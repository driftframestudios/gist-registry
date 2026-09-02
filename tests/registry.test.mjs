import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { checkRegistry } from "../tools/check-registry.mjs";
import { checkSchemaNursery, validateArtifactEnvelope } from "../tools/check-schema.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const registryPath = resolve(repositoryRoot, "registry.json");
const manifestPath = resolve(
  repositoryRoot,
  "snippets/document-evidence-extraction/0.1.0/snippet.json",
);
const custodyManifestPath = resolve(
  repositoryRoot,
  "snippets/specimen-custody-outbox/0.1.0/snippet.json",
);
const ingressManifestPath = resolve(
  repositoryRoot,
  "snippets/instrument-ingress-integrity/0.1.0/snippet.json",
);
const migrationManifestPath = resolve(
  repositoryRoot,
  "snippets/migration-reconciliation-cutover/0.1.0/snippet.json",
);
const typedAbsenceManifestPath = resolve(
  repositoryRoot,
  "snippets/typed-absence-and-wire-shape/0.1.0/snippet.json",
);
const repositoryExemplarRoot = resolve(
  repositoryRoot,
  "snippets/lims-eln-enterprise-implementation/0.3.2",
);
const repositoryExemplarManifestPath = resolve(repositoryExemplarRoot, "snippet.json");
const repositoryExemplarCoordinatePath = resolve(
  repositoryExemplarRoot,
  "release-coordinate.json",
);
const repositoryExemplarSourcePath = resolve(
  repositoryExemplarRoot,
  "source/idempotency.py",
);
const companionManifestPaths = new Map([
  [
    "0.1.0",
    resolve(
      repositoryRoot,
      "snippets/document-evidence-core-patterns/0.1.0/snippet.json",
    ),
  ],
  [
    "0.1.1",
    resolve(
      repositoryRoot,
      "snippets/document-evidence-core-patterns/0.1.1/snippet.json",
    ),
  ],
]);
const companionExpectations = new Map([
  [
    "0.1.0",
    {
      derivedFrom: "document-evidence-extraction@0.1.0",
      orderedFiles: [
        "gist/00-README.md",
        "gist/10-same-byte-capture.md",
        "gist/20-recovery-aware-promotion.md",
      ],
      successorOf: null,
    },
  ],
  [
    "0.1.1",
    {
      derivedFrom: "document-evidence-extraction@0.1.1",
      orderedFiles: [
        "gist/00-README.md",
        "gist/10-observed-effect-reconciliation.md",
        "gist/20-caller-retained-recovery.md",
      ],
      successorOf: "document-evidence-core-patterns@0.1.0",
    },
  ],
]);
const schemaPath = resolve(repositoryRoot, "schemas/0.1.0/registry-artifact.schema.json");

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function gitBlobOid(bytes) {
  return createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`, "utf8"))
    .update(bytes)
    .digest("hex");
}

function pythonBlocks(markdown) {
  return [...markdown.matchAll(/```python\n([\s\S]*?)\n```/gu)].map(match => match[1]);
}

function indentBlock(source, spaces) {
  const prefix = " ".repeat(spaces);
  return source
    .split("\n")
    .map(line => (line ? prefix + line : line))
    .join("\n");
}

function countOccurrences(source, selection) {
  if (!selection) return 0;
  return source.split(selection).length - 1;
}

function definitionBlock(source, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const declaration = new RegExp(
    "^(\\s*)(?:class|def) " + escapedName + "(?:\\b|\\()",
    "u",
  );
  const lines = source.split("\n");
  const start = lines.findIndex(line => declaration.test(line));
  if (start < 0) return null;
  const indentation = lines[start].match(/^\s*/u)[0].length;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    const nextIndentation = line.match(/^\s*/u)[0].length;
    if (
      nextIndentation <= indentation &&
      /^(?:class|def)\s+/u.test(line.trimStart())
    ) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trimEnd();
}

test("the real registry resolves all exact versions and their representations", async () => {
  const registry = await json(registryPath);
  const result = await checkRegistry({ root: repositoryRoot });
  assert.deepEqual(result, { artifactCount: registry.entries.length });
});

test("the first schema attempt validates every registered exact version", async () => {
  const registry = await json(registryPath);
  const result = await checkSchemaNursery();
  assert.deepEqual(result, {
    schemaVersion: "0.1.0",
    artifactCount: registry.entries.length,
    instances: registry.entries.map(entry => entry.semanticId + "@" + entry.version),
  });
});

test("the repository exemplar binds one exact source file to the observed release", async () => {
  const [manifest, coordinate, coordinateBytes, sourceBytes] = await Promise.all([
    json(repositoryExemplarManifestPath),
    json(repositoryExemplarCoordinatePath),
    readFile(repositoryExemplarCoordinatePath),
    readFile(repositoryExemplarSourcePath),
  ]);
  const release = coordinate.releaseSubject;
  const observation = coordinate.releaseObservation;
  const source = coordinate.selectedRepresentation;

  assert.equal(manifest.artifactKind, "repository_exemplar");
  assert.equal(manifest.standing, "candidate");
  assert.equal(manifest.technicalVeracity.status, "source_supported");
  assert.equal(manifest.execution, undefined);
  assert.deepEqual(
    manifest.representations.map(representation => [
      representation.role,
      representation.path,
    ]),
    [
      ["orientation", "README.md"],
      ["manifest", "snippet.json"],
      ["release_coordinate", "release-coordinate.json"],
      ["source_excerpt", "source/idempotency.py"],
    ],
  );

  assert.equal(coordinate.coordinateFormatVersion, "0.1.0");
  assert.equal(coordinate.recordKind, "repository_release");
  assert.equal(
    coordinate.sourceAuthority.repository,
    "driftframestudios/lims-eln-enterprise-implementation",
  );
  assert.equal(coordinate.sourceAuthority.releaseAuthority, "source_repository");
  assert.deepEqual(release, {
    release: "0.3.2",
    tag: "v0.3.2",
    tagObjectOid: "c3db01079b88622f06e8714c8bcbdf0dc1803a10",
    commitOid: "fe0bd2a08ac1697ce18ca583d9631faae7db7132",
    treeOid: "eb8eadb27a9e07c6069a1946f115a0083d94af5c",
    archiveFormat: "git-tar",
    archiveSha256: "0ea3db3099e3485f65d238fb2e194c6bfd9b9a90f6642431c4a96974ebcc3c16",
  });
  assert.equal(observation.carrierCommitOid, "b3fcf07445bc0c049daa00b03d6fe583962085cf");
  assert.equal(observation.gitBlobOid, "75730b9e0f272169dd136cd2364c162d1c7bda0d");
  assert.equal(
    observation.sha256,
    "f1e65be6a701bee526c6481fe65e18bc0a2d6df0150c418f7a76457039cb3061",
  );
  assert.equal(observation.promotionState, "release_observed");
  assert.equal(observation.evidenceMode, "observed");
  assert.equal(observation.assuranceStage, "verified");
  assert.notEqual(
    observation.carrierCommitOid,
    release.commitOid,
    "the later release observation retains its own carrier coordinate",
  );

  assert.equal(source.sourcePath, "src/lims_eln_implementation/idempotency.py");
  assert.equal(source.projectedPath, "source/idempotency.py");
  assert.equal(source.bytes, sourceBytes.length);
  assert.equal(source.lines, sourceBytes.toString("utf8").split("\n").length - 1);
  assert.equal(source.lines, 94);
  assert.equal(source.sha256, sha256(sourceBytes));
  assert.equal(source.gitBlobOid, gitBlobOid(sourceBytes));
  assert.equal(
    source.sha256,
    "217936e75fb1704825108ea4bc0aa6f4027e1e94e5196e340b829d9eb0117543",
  );
  assert.equal(source.gitBlobOid, "b6d27293153aec3af868cbfa7c9a3d9e5d28ae12");

  assert.equal(coordinate.licenseCarrier.spdxIdentifier, "Apache-2.0");
  assert.equal(coordinate.licenseCarrier.path, "LICENSE");
  assert.equal(
    coordinate.licenseCarrier.sha256,
    "c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4",
  );
  assert.equal(coordinate.attributionCarrier.path, "AUTHORS");
  assert.equal(
    coordinate.attributionCarrier.sha256,
    "63c6673baa090ed6abbc83fa026794c27ac2de85c663bfd53cac7ba977ff9829",
  );
  assert.deepEqual(
    coordinate.sourceEvidence.map(evidence => ({
      path: evidence.path,
      gitBlobOid: evidence.gitBlobOid,
      bytes: evidence.bytes,
      sha256: evidence.sha256,
    })),
    [
      {
        path: "tests/test_lifecycle.py",
        gitBlobOid: "6ac180b3f1d5ea89a1a6620d22ee590468a82bb5",
        bytes: 5756,
        sha256: "f15359d2438bb518d09d6842d013def12a2fc0cfb4ee6c727a8f29ff79bfaf33",
      },
      {
        path: "tests/test_vendors.py",
        gitBlobOid: "f589ebea317dc6425771bf72f3f8fb7ad3911096",
        bytes: 3746,
        sha256: "bf8f16e8a66ef85c3ad39b21a7fe4d000284cd342affb7158745b604e489fb49",
      },
    ],
  );
  assert.equal(
    coordinate.sourceEvidence.reduce(
      (count, evidence) => count + evidence.focusedTests.length,
      0,
    ),
    coordinate.focusedEvidenceResult.testCount,
  );
  assert.deepEqual(coordinate.focusedEvidenceResult, {
    testCount: 9,
    result: "ok",
    sourceState: "exact_tag_archive",
  });
  assert.equal(coordinate.publicationBoundary.registryProjection, "public_github_pages");
  assert.equal(coordinate.publicationBoundary.authorizationRecord, "gist-registry:issue-35");

  const coordinateRepresentation = manifest.representations.find(
    representation => representation.role === "release_coordinate",
  );
  const sourceRepresentation = manifest.representations.find(
    representation => representation.role === "source_excerpt",
  );
  assert.equal(coordinateRepresentation.sha256, sha256(coordinateBytes));
  assert.equal(sourceRepresentation.sha256, source.sha256);
  assert.equal(
    manifest.extensions.repositoryRelease.coordinatePath,
    "release-coordinate.json",
  );
  assert.equal(manifest.extensions.repositoryRelease.sourceCommit, release.commitOid);
  assert.equal(
    manifest.extensions.repositoryRelease.sourceExcerpt.sha256,
    source.sha256,
  );
  assert.equal(
    manifest.relationships.find(relationship => relationship.type === "source_release")
      ?.target,
    "driftframestudios/lims-eln-enterprise-implementation@v0.3.2",
  );
});

test("the domain exemplar records one runnable boundary and proposed Gist source order", async () => {
  const manifest = await json(custodyManifestPath);
  const declaredPaths = new Set(
    manifest.representations.map(representation => representation.path),
  );
  const gistFiles = manifest.extensions.gistCandidate.orderedFiles;

  assert.equal(manifest.artifactKind, "domain_exemplar");
  assert.equal(manifest.standing, "candidate");
  assert.equal(manifest.technicalVeracity.status, "verified");
  assert.deepEqual(manifest.execution.fixtures, ["fixtures/transfer-command.json"]);
  assert.deepEqual(manifest.execution.expectedResults, [
    "expected/transfer-commit.json",
  ]);
  assert.deepEqual(gistFiles, [
    { publicationName: "00-README.md", sourcePath: "README.md" },
    {
      publicationName: "specimen_custody.py",
      sourcePath: "src/specimen_custody.py",
    },
    {
      publicationName: "test_specimen_custody.py",
      sourcePath: "tests/test_specimen_custody.py",
    },
    {
      publicationName: "transfer-command.json",
      sourcePath: "fixtures/transfer-command.json",
    },
    {
      publicationName: "transfer-commit.json",
      sourcePath: "expected/transfer-commit.json",
    },
  ]);
  for (const file of gistFiles) {
    assert.ok(
      declaredPaths.has(file.sourcePath),
      file.sourcePath + " must be one declared canonical representation",
    );
  }
  assert.deepEqual(
    manifest.relationships.map(relationship => relationship.type),
    ["receiver", "schema_nursery"],
  );
});

test("instrument ingress keeps schema pressure local and proposes canonical source files", async () => {
  const manifest = await json(ingressManifestPath);
  const declaredPaths = new Set(
    manifest.representations.map(representation => representation.path),
  );
  const gistFiles = manifest.extensions.gistCandidate.orderedFiles;

  assert.equal(manifest.artifactKind, "domain_exemplar");
  assert.equal(manifest.standing, "candidate");
  assert.equal(manifest.technicalVeracity.status, "verified");
  assert.deepEqual(manifest.execution.fixtures, [
    "fixtures/accepted-measurement.json",
    "fixtures/quarantined-measurement.json",
  ]);
  assert.deepEqual(manifest.execution.expectedResults, ["expected/ingress-run.json"]);
  assert.deepEqual(
    gistFiles.map(file => file.publicationName),
    [
      "00-README.md",
      "instrument_ingress.py",
      "test_instrument_ingress.py",
      "accepted-measurement.json",
      "quarantined-measurement.json",
      "ingress-run.json",
    ],
  );
  for (const file of gistFiles) {
    assert.ok(
      declaredPaths.has(file.sourcePath),
      file.sourcePath + " must be one declared canonical representation",
    );
  }
  assert.equal(manifest.extensions.sourceCoordinates.length, 2);
  assert.deepEqual(
    manifest.relationships.map(relationship => relationship.type),
    ["receiver", "schema_nursery"],
  );
});

test("migration cutover keeps activation evidence and authority owners distinct", async () => {
  const manifest = await json(migrationManifestPath);
  const declaredPaths = new Set(
    manifest.representations.map(representation => representation.path),
  );
  const gistFiles = manifest.extensions.gistCandidate.orderedFiles;

  assert.equal(manifest.artifactKind, "domain_exemplar");
  assert.equal(manifest.standing, "candidate");
  assert.equal(manifest.technicalVeracity.status, "verified");
  assert.deepEqual(manifest.execution.fixtures, [
    "fixtures/reconciled-cutover.json",
    "fixtures/returned-for-evidence.json",
  ]);
  assert.deepEqual(manifest.execution.expectedResults, [
    "expected/cutover-evaluation.json",
  ]);
  assert.deepEqual(gistFiles, [
    { publicationName: "00-README.md", sourcePath: "README.md" },
    {
      publicationName: "migration_cutover.py",
      sourcePath: "src/migration_cutover.py",
    },
    {
      publicationName: "test_migration_cutover.py",
      sourcePath: "tests/test_migration_cutover.py",
    },
    {
      publicationName: "reconciled-cutover.json",
      sourcePath: "fixtures/reconciled-cutover.json",
    },
    {
      publicationName: "returned-for-evidence.json",
      sourcePath: "fixtures/returned-for-evidence.json",
    },
    {
      publicationName: "cutover-evaluation.json",
      sourcePath: "expected/cutover-evaluation.json",
    },
  ]);
  for (const file of gistFiles) {
    assert.ok(
      declaredPaths.has(file.sourcePath),
      file.sourcePath + " must be one declared canonical representation",
    );
  }
  assert.deepEqual(manifest.extensions.sourceCoordinates, [
    {
      sourceKey: "urn:source-key:lims-eln-program-specification",
      capturedRevision: "23e6ea973f6bd5cc5caa46de10aed589816af9b5",
      role: "semantic_contract",
    },
    {
      sourceKey: "urn:source-key:lims-eln-enterprise-implementation",
      capturedRevision: "ac33876eba2dff1ad803d9a7175c1e956036c226",
      role: "runnable_ancestry",
    },
  ]);
  assert.deepEqual(
    manifest.relationships.map(relationship => relationship.type),
    ["receiver", "schema_nursery"],
  );
});

test("typed absence keeps wire meanings and Gist source order explicit", async () => {
  const manifest = await json(typedAbsenceManifestPath);
  const declaredPaths = new Set(
    manifest.representations.map(representation => representation.path),
  );
  const gistFiles = manifest.extensions.gistCandidate.orderedFiles;

  assert.equal(manifest.artifactKind, "code_sample");
  assert.equal(manifest.standing, "candidate");
  assert.equal(manifest.technicalVeracity.status, "verified");
  assert.deepEqual(manifest.execution.fixtures, [
    "fixtures/presence-cases.json",
  ]);
  assert.deepEqual(manifest.execution.expectedResults, [
    "expected/wire-shape.json",
  ]);
  assert.deepEqual(gistFiles, [
    { publicationName: "00-README.md", sourcePath: "README.md" },
    {
      publicationName: "typed-absence.ts",
      sourcePath: "src/typed-absence.ts",
    },
    {
      publicationName: "typed-absence.test.mjs",
      sourcePath: "tests/typed-absence.test.mjs",
    },
    {
      publicationName: "typed-absence.type-test.ts",
      sourcePath: "tests/typed-absence.type-test.ts",
    },
    {
      publicationName: "presence-cases.json",
      sourcePath: "fixtures/presence-cases.json",
    },
    {
      publicationName: "wire-shape.json",
      sourcePath: "expected/wire-shape.json",
    },
  ]);
  for (const file of gistFiles) {
    assert.ok(
      declaredPaths.has(file.sourcePath),
      file.sourcePath + " must be one declared canonical representation",
    );
  }
  assert.deepEqual(
    manifest.relationships.map(relationship => relationship.type),
    ["receiver", "schema_nursery"],
  );
});

test("each compact companion keeps one ordered Gist candidate and one runnable source owner", async () => {
  for (const [version, manifestPath] of companionManifestPaths) {
    const manifest = await json(manifestPath);
    const expected = companionExpectations.get(version);
    assert.equal(manifest.artifactKind, "code_excerpt");
    assert.equal(manifest.standing, "candidate");
    assert.deepEqual(manifest.extensions.gistCandidate.orderedFiles, expected.orderedFiles);
    assert.deepEqual(
      manifest.representations
        .filter(representation => representation.role.startsWith("gist_"))
        .map(representation => representation.path),
      manifest.extensions.gistCandidate.orderedFiles,
    );
    assert.equal(
      manifest.relationships.find(relationship => relationship.type === "derived_from")
        ?.target,
      expected.derivedFrom,
    );
    assert.equal(
      manifest.relationships.find(relationship => relationship.type === "successor_of")
        ?.target ?? null,
      expected.successorOf,
    );
  }
});

test("every companion Python block remains an exact selection from its declared owner", async () => {
  const registry = await json(resolve(repositoryRoot, "registry.json"));

  for (const [version, manifestPath] of companionManifestPaths) {
    const manifest = await json(manifestPath);
    const artifactRoot = dirname(manifestPath);
    const sourceTarget = manifest.relationships.find(
      relationship => relationship.type === "derived_from",
    ).target;
    const separator = sourceTarget.lastIndexOf("@");
    const sourceEntry = registry.entries.find(
      entry =>
        entry.semanticId === sourceTarget.slice(0, separator) &&
        entry.version === sourceTarget.slice(separator + 1),
    );
    assert.ok(sourceEntry, sourceTarget + " must resolve through registry.json");
    const sourceManifest = await json(resolve(repositoryRoot, sourceEntry.manifestPath));
    const declaredOwnerPaths = new Set(
      sourceManifest.representations
        .filter(representation => ["source", "test"].includes(representation.role))
        .map(representation => sourceEntry.canonicalPath + "/" + representation.path),
    );
    let blockCount = 0;

    for (const selection of manifest.extensions.gistCandidate.sourceSelections) {
      assert.ok(
        manifest.extensions.gistCandidate.orderedFiles.includes(selection.companionPath),
        selection.companionPath + " must belong to the ordered Gist candidate",
      );
      assert.ok(
        declaredOwnerPaths.has(selection.sourcePath),
        selection.sourcePath + " must be a declared source representation",
      );
      assert.ok(
        declaredOwnerPaths.has(selection.testPath),
        selection.testPath + " must be a declared test representation",
      );
      const [reading, source, tests] = await Promise.all([
        readFile(resolve(artifactRoot, selection.companionPath), "utf8"),
        readFile(resolve(repositoryRoot, selection.sourcePath), "utf8"),
        readFile(resolve(repositoryRoot, selection.testPath), "utf8"),
      ]);
      const blocks = pythonBlocks(reading);
      assert.ok(blocks.length > 0, selection.companionPath + " must carry Python selections");
      blockCount += blocks.length;

      for (const symbol of selection.symbols) {
        const definition = definitionBlock(source, symbol);
        assert.ok(definition, symbol + " must resolve in the declared source owner");
        assert.ok(
          blocks.some(block => {
            const declaration = new RegExp(
              "^(?:class|def) " + symbol.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&") +
                "(?:\\b|\\()",
              "mu",
            );
            return (
              declaration.test(block) ||
              [block, ...[4, 8, 12].map(spaces => indentBlock(block, spaces))].some(
                candidate => definition.includes(candidate),
              )
            );
          }),
          symbol + " must be represented by an exact companion selection",
        );
      }
      for (const testName of selection.tests) {
        const definition = definitionBlock(tests, testName);
        assert.ok(definition, testName + " must resolve in the declared test owner");
        assert.ok(
          blocks.some(block =>
            [block, ...[4, 8, 12].map(spaces => indentBlock(block, spaces))].some(
              candidate => definition.includes(candidate),
            ),
          ),
          testName + " must be represented by an exact companion selection",
        );
      }

      for (const block of blocks) {
        const candidates = [block, ...[4, 8, 12].map(spaces => indentBlock(block, spaces))];
        const occurrences = [source, tests].reduce(
          (count, authority) =>
            count +
            candidates.reduce(
              (candidateCount, candidate) =>
                candidateCount + countOccurrences(authority, candidate),
              0,
            ),
          0,
        );
        assert.equal(
          occurrences,
          1,
          selection.companionPath + " must contain one exact owner selection",
        );
      }
    }
    assert.ok(blockCount > 0, `companion ${version} must carry exact Python selections`);
  }
});

test("JSON Schema semantics reject an invalid nested artifact value", async () => {
  const [schema, manifest] = await Promise.all([json(schemaPath), json(manifestPath)]);
  manifest.use.capabilities = ["Not path safe"];
  assert.throws(
    () => validateArtifactEnvelope(schema, manifest),
    /artifact manifest does not satisfy.*capabilities/u,
  );
});

test("the exact-version schema rejects a manifest that claims another schema version", async () => {
  const [schema, manifest] = await Promise.all([json(schemaPath), json(manifestPath)]);
  manifest.schemaVersion = "0.1.1";
  assert.throws(
    () => validateArtifactEnvelope(schema, manifest),
    /artifact manifest does not satisfy.*schemaVersion.*must be equal to constant/u,
  );
});

test("the schema checker rejects a copied 0.1.0 contract outside its canonical path", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "gist-registry-schema-path-check-"));
  try {
    const [registry, schema, manifest] = await Promise.all([
      json(resolve(repositoryRoot, "registry.json")),
      json(schemaPath),
      json(manifestPath),
    ]);
    registry.entries = [registry.entries[0]];
    const fixtureArtifactRoot = resolve(fixture, registry.entries[0].canonicalPath);
    const fixtureSchemaRoot = resolve(fixture, "schemas/0.1.0");
    const copiedSchema = {
      ...schema,
      description: `${schema.description} Altered copy for path-authority testing.`,
    };
    manifest.$schema = "../../../schemas/0.1.0/copied-registry-artifact.schema.json";

    await mkdir(fixtureSchemaRoot, { recursive: true });
    await cp(dirname(manifestPath), fixtureArtifactRoot, {
      recursive: true,
      filter: source => !/[\\/](?:\.artifacts|\.ruff_cache|\.venv|__pycache__)(?:[\\/]|$)/u.test(source),
    });
    await Promise.all([
      writeFile(
        resolve(fixture, "registry.json"),
        `${JSON.stringify(registry, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        resolve(fixtureSchemaRoot, "registry-artifact.schema.json"),
        `${JSON.stringify(schema, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        resolve(fixtureSchemaRoot, "copied-registry-artifact.schema.json"),
        `${JSON.stringify(copiedSchema, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        resolve(fixtureArtifactRoot, "snippet.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
      ),
    ]);

    assert.equal(copiedSchema.$id, schema.$id);
    assert.equal(copiedSchema.properties.schemaVersion.const, "0.1.0");
    validateArtifactEnvelope(copiedSchema, manifest);
    await assert.rejects(
      checkSchemaNursery({ root: fixture }),
      /schemaVersion 0\.1\.0 must resolve to schemas\/0\.1\.0\/registry-artifact\.schema\.json/u,
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("path disagreement returns to the registry owner without copying the worktree", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "gist-registry-path-check-"));
  try {
    const registry = await json(resolve(repositoryRoot, "registry.json"));
    registry.entries[0].canonicalPath = "snippets/document-evidence-extraction/0.1.1";
    await writeFile(
      join(fixture, "registry.json"),
      `${JSON.stringify(registry, null, 2)}\n`,
      "utf8",
    );
    await assert.rejects(
      checkRegistry({ root: fixture }),
      /canonicalPath must follow the version grammar/u,
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("a manifest symlink cannot escape the checked repository", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "gist-registry-symlink-check-"));
  try {
    const registry = await json(resolve(repositoryRoot, "registry.json"));
    const linkedManifest = resolve(fixture, registry.entries[0].manifestPath);
    await mkdir(dirname(linkedManifest), { recursive: true });
    await writeFile(
      resolve(fixture, "registry.json"),
      `${JSON.stringify(registry, null, 2)}\n`,
      "utf8",
    );
    await symlink(manifestPath, linkedManifest);
    await assert.rejects(
      checkRegistry({ root: fixture }),
      /manifest must not be a symbolic link/u,
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
