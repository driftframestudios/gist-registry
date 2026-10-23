import "../node-runtime-admission.mjs";

import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileArtifactFamily } from "../src/compiler.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(packageRoot, ".artifacts", "example");
await rm(outputDir, { recursive: true, force: true });
const result = await compileArtifactFamily({
  contractPath: path.join(packageRoot, "source", "pattern-contract.json"),
  svgPath: path.join(packageRoot, "source", "pattern.svg"),
  galleryShellPath: path.join(packageRoot, "source", "gallery-shell.html"),
  outputDir,
});

const summary = {
  artifactId: result.contract.artifactId,
  manifestDigest: result.manifestDigest,
  outputs: result.manifest.outputs.map(({ path: outputPath, declaredMediaType, bytes, sha256, width, height }) => ({
    path: outputPath,
    declaredMediaType,
    bytes,
    sha256,
    ...(width ? { width, height } : {}),
  })),
  runtime: result.manifest.runtime,
  measurement: result.measurement,
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
