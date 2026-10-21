import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const subjectSourcePath = fileURLToPath(new URL("../source/receiver.html", import.meta.url));
const subjectBytes = readFileSync(subjectSourcePath);
const subjectArtifact = Object.freeze({
  path: "artifacts/receiver.html",
  sha256: createHash("sha256").update(subjectBytes).digest("hex"),
  bytes: subjectBytes.byteLength,
});

export function artifactSources() {
  return { [subjectArtifact.path]: subjectSourcePath };
}

export function makeReceipt() {
  return {
    schemaVersion: "0.1.0",
    receiptId: "semantic-chromium-baseline",
    caseId: "observe--family-label--narrow-200",
    targetId: "family-label",
    decisionBoundary: "A visitor can identify the specimen-family input.",
    source: { semanticId: "style-dictionary-dtcg-pipeline", version: "0.1.0", coordinate: { brand: "acme", mode: "light" }, manifestKind: "generated_output_manifest", manifestSha256: "a".repeat(64) },
    receiver: { semanticId: "react-aria-visual-contract-receiver", version: "0.1.0", manifestKind: "production_build_manifest", manifestSha256: "b".repeat(64) },
    subject: { kind: "synthetic_receiver_fixture", ...subjectArtifact },
    environment: { coordinateKind: "model_fixture", playwrightVersion: "1.64.1", browserName: "chromium", browserVersion: "fixture", browserRevision: "fixture", node: process.version, platform: process.platform, arch: process.arch, fontSet: "system-ui", headless: true },
    viewportMedia: { scenarioId: "narrow-200", width: 320, height: 800, textScale: 2, direction: "ltr", media: "screen", colorMode: "normal", motion: "reduced", image: "available", font: "system", input: "touch", state: "pending", javaScript: true },
    observation: "semantic",
    result: { status: "pass", normalized: { accessibleName: "Specimen family" } },
    artifacts: [{ ...subjectArtifact }],
    measurements: { elapsedMs: 2.5, emittedBytes: subjectArtifact.bytes, peakRssBytes: 1_000_000, assertionCount: 1 },
    standing: "candidate",
    classification: "deterministic_implementation_change",
    restartFrom: "receiver_markup",
  };
}
