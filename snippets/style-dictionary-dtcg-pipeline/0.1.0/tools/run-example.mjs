import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { semanticDiff, stableStringify } from "../src/contract.mjs";
import { buildCandidates } from "./build-candidates.mjs";
import { createManifest } from "./make-manifest.mjs";
import { loadCoordinate } from "./load-coordinate.mjs";
import { validateAllSources } from "./validate-source.mjs";

const root = await mkdtemp(join(tmpdir(), "dtcg-pipeline-example-"));
try {
  const validation = await validateAllSources();
  const build = await buildCandidates({ outputRoot: root });
  const manifest = await createManifest({ outputRoot: root });
  const accepted = (await loadCoordinate({ brand: "acme", mode: "light" })).document;
  const candidate = (await loadCoordinate({ brand: "research", mode: "light" })).document;
  process.stdout.write(
    stableStringify({
      validation,
      buildObservation: build.observation,
      semanticDiff: semanticDiff(accepted, candidate),
      manifest: {
        sourceDigest: manifest.sourceDigest,
        manifestDigest: manifest.manifestDigest,
        artifactCount: manifest.artifactCount,
        generatedBytes: manifest.generatedBytes,
      },
    }),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
