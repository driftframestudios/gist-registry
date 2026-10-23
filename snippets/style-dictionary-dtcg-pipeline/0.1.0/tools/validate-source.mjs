import "../node-runtime-admission.mjs";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { adaptFigmaSnapshot } from "../adapters/figma-snapshot-to-dtcg.mjs";
import { BUILD_MATRIX, coordinateId } from "../config/build-matrix.mjs";
import { stableStringify, validateTokenGraph } from "../src/contract.mjs";
import { loadCoordinate } from "./load-coordinate.mjs";
import { packageRoot } from "./paths.mjs";
import { isDirectNodeInvocation } from "../node-cli-entrypoint.mjs";

export async function validateAllSources() {
  const coordinates = [];
  for (const coordinate of BUILD_MATRIX) {
    const { validation } = await loadCoordinate(coordinate);
    coordinates.push({ coordinate: coordinateId(coordinate), ...validation.metrics });
  }
  const snapshot = JSON.parse(await readFile(resolve(packageRoot, "fixtures/accepted/figma-snapshot.json"), "utf8"));
  const adapted = adaptFigmaSnapshot(snapshot);
  const adaptedValidation = validateTokenGraph(adapted.document);
  return {
    formatProfile: "DTCG Format Module 2025.10 subset",
    coordinates,
    adaptedSnapshot: {
      tokenCount: adaptedValidation.metrics.tokenCount,
      sourceMapCount: adapted.sourceMap.length,
    },
  };
}

if (isDirectNodeInvocation(import.meta.url)) {
  validateAllSources()
    .then(result => process.stdout.write(stableStringify(result)))
    .catch(error => {
      process.stderr.write(`${stableStringify(error.toJSON?.() ?? { code: "VALIDATION_FAILED", message: error.message })}`);
      process.exitCode = 1;
    });
}
