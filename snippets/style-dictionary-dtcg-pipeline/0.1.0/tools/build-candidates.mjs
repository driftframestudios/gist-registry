import { lstat, mkdir, opendir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import StyleDictionary from "style-dictionary";
import { BUILD_MATRIX, coordinateId } from "../config/build-matrix.mjs";
import { createStyleDictionaryConfig, registerKindlightFormats } from "../config/style-dictionary.config.mjs";
import { DEFAULT_LIMITS, PipelineError, stableStringify } from "../src/contract.mjs";
import { loadCoordinate } from "./load-coordinate.mjs";
import { packageRoot, parseOutputArgument } from "./paths.mjs";

registerKindlightFormats(StyleDictionary);

export async function buildCandidates({ outputRoot, beforeCoordinate = async () => {} }) {
  const candidateRoot = resolve(outputRoot);
  const startedAt = process.hrtime.bigint();
  let peakRssBytes = process.memoryUsage().rss;
  let sourceBytes = 0;
  await mkdir(candidateRoot, { recursive: true });
  const rootEntry = await lstat(candidateRoot);
  if (rootEntry.isSymbolicLink() || !rootEntry.isDirectory()) {
    throw new Error("candidate output must be one regular directory");
  }
  const directory = await opendir(candidateRoot);
  const firstEntry = await directory.read();
  await directory.close();
  if (firstEntry) {
    throw new Error("candidate output must be an empty caller-selected directory");
  }
  const ownershipMarker = resolve(candidateRoot, ".candidate-build-owner");
  await writeFile(ownershipMarker, `${process.pid}\n`, { encoding: "utf8", flag: "wx" });
  try {
    const built = [];
    for (const coordinate of BUILD_MATRIX) {
      const id = coordinateId(coordinate);
      await beforeCoordinate({ coordinate: id });
      const { document, validation } = await loadCoordinate(coordinate);
      const inputPath = resolve(candidateRoot, "inputs", `${id}.tokens.json`);
      const buildPath = resolve(candidateRoot, id);
      await mkdir(resolve(candidateRoot, "inputs"), { recursive: true });
      await mkdir(buildPath, { recursive: true });
      const source = stableStringify(document);
      const coordinateSourceBytes = Buffer.byteLength(source);
      if (coordinateSourceBytes > DEFAULT_LIMITS.sourceBytes) {
        throw new PipelineError("RESOURCE_ENVELOPE_EXCEEDED", `Candidate source ${id} exceeds the byte envelope.`, {
          stage: "candidate_build",
          dimension: "source_bytes",
          observed: coordinateSourceBytes,
          limit: DEFAULT_LIMITS.sourceBytes,
          coordinate: id,
          restartFrom: "source",
        });
      }
      sourceBytes += coordinateSourceBytes;
      await writeFile(inputPath, source, "utf8");
      const dictionary = new StyleDictionary(
        createStyleDictionaryConfig({ sourcePaths: [inputPath], buildPath }),
      );
      await dictionary.buildAllPlatforms();
      peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
      built.push({ coordinate: id, ...validation.metrics });
    }
    return {
      outputRoot: candidateRoot,
      built,
      observation: {
        runtime: {
          node: process.version,
          platform: process.platform,
          architecture: process.arch,
        },
        coordinates: built.length,
        platforms: 2,
        generatedFilesExpected: built.length * 3,
        sourceBytes,
        elapsedMilliseconds: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        peakRssBytes,
      },
    };
  } finally {
    await rm(ownershipMarker, { force: true });
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const outputRoot = parseOutputArgument(process.argv.slice(2), ".artifacts/candidate");
  buildCandidates({ outputRoot })
    .then(result => process.stdout.write(stableStringify({ built: result.built, observation: result.observation })))
    .catch(error => {
      process.stderr.write(`${stableStringify({ code: "BUILD_FAILED", message: error.message })}`);
      process.exitCode = 1;
    });
}
