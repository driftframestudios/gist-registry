import { lstat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BUILD_MATRIX, coordinateId } from "../config/build-matrix.mjs";
import {
  DEFAULT_LIMITS,
  PipelineError,
  readBoundedFile,
  sha256,
  stableStringify,
  validateTokenGraph,
} from "../src/contract.mjs";
import { promoteCandidate } from "../src/publication.mjs";
import { loadCoordinate } from "./load-coordinate.mjs";
import { packageRoot, parseOutputArgument } from "./paths.mjs";
import { verifyGenerated } from "./verify-generated.mjs";

export async function createManifest({ outputRoot, sourceLoader = loadCoordinate }) {
  const verification = await verifyGenerated({ outputRoot });
  const capturedRoot = resolve(outputRoot);
  for (const [path, label] of [
    [capturedRoot, "candidate root"],
    [resolve(capturedRoot, "inputs"), "candidate inputs directory"],
  ]) {
    const entry = await lstat(path);
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error(`${label} must be a regular directory`);
  }
  const sources = [];
  const sourceInputs = [];
  for (const coordinate of BUILD_MATRIX) {
    const id = coordinateId(coordinate);
    const candidatePath = `inputs/${id}.tokens.json`;
    const absoluteCandidatePath = resolve(capturedRoot, candidatePath);
    const candidateEntry = await lstat(absoluteCandidatePath);
    if (candidateEntry.isSymbolicLink() || !candidateEntry.isFile()) {
      throw new Error(`captured source ${id} must be a regular file`);
    }
    const bytes = await readBoundedFile(absoluteCandidatePath, {
      maxBytes: DEFAULT_LIMITS.sourceBytes,
      stage: "manifest",
      dimension: "source_bytes",
      label: `Captured source ${id}`,
      restartFrom: "candidate_build",
    });
    let capturedDocument;
    try {
      capturedDocument = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      throw new PipelineError("CAPTURED_SOURCE_INVALID", `Captured source ${id} requires valid JSON.`, {
        stage: "manifest",
        coordinate: id,
        reason: error.message,
        restartFrom: "candidate_build",
      });
    }
    validateTokenGraph(capturedDocument);
    const canonicalBytes = Buffer.from(stableStringify(capturedDocument), "utf8");
    if (!bytes.equals(canonicalBytes)) {
      throw new PipelineError("CAPTURED_SOURCE_NONCANONICAL", `Captured source ${id} differs from canonical bytes.`, {
        stage: "manifest",
        coordinate: id,
        restartFrom: "candidate_build",
      });
    }
    const { document: liveDocument } = await sourceLoader(coordinate);
    validateTokenGraph(liveDocument);
    if (stableStringify(liveDocument) !== stableStringify(capturedDocument)) {
      throw new PipelineError("SOURCE_DRIFT", `Authored source changed after candidate ${id} was built.`, {
        stage: "manifest",
        coordinate: id,
        restartFrom: "candidate_build",
      });
    }
    sources.push(capturedDocument);
    sourceInputs.push({ coordinate: id, candidatePath, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  const sourceDigest = sha256(stableStringify(sources));
  const manifest = {
    schemaVersion: "0.1.0",
    formatProfile: "DTCG Format Module 2025.10 subset",
    compiler: { package: "style-dictionary", version: "5.7.0" },
    sourceDigest,
    sourceInputs,
    matrix: BUILD_MATRIX,
    artifactCount: verification.artifactCount,
    generatedBytes: verification.generatedBytes,
    artifacts: verification.artifacts,
    recoveryCoordinate: "accepted/current.json",
  };
  manifest.manifestDigest = sha256(stableStringify(manifest));
  return manifest;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const args = process.argv.slice(2);
  const outputRoot = parseOutputArgument(args, ".artifacts/candidate");
  createManifest({ outputRoot })
    .then(async manifest => {
      await writeFile(resolve(outputRoot, "candidate-manifest.json"), stableStringify(manifest), "utf8");
      let acceptedPointer = null;
      if (args.includes("--promote")) {
        acceptedPointer = await promoteCandidate({
          candidateRoot: outputRoot,
          acceptedRoot: resolve(packageRoot, ".artifacts/accepted"),
          manifest,
        });
      }
      process.stdout.write(stableStringify({ manifest, acceptedPointer }));
    })
    .catch(error => {
      process.stderr.write(`${stableStringify({ code: "MANIFEST_FAILED", message: error.message })}`);
      process.exitCode = 1;
    });
}
