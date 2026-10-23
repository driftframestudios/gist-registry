import "../node-runtime-admission.mjs";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { evaluateControlledObservation, readJson, selectTier, sha256, validateInventory, validateMatrix } from "../src/contracts.mjs";
import { publishReceipt } from "../src/publication.mjs";
import { artifactRoot, packageRoot } from "./paths.mjs";

const inventory = await readJson(resolve(packageRoot, "inventory/decisions.json"));
const matrix = await readJson(resolve(packageRoot, "inventory/matrix.json"));
const coordinates = await readJson(resolve(packageRoot, "source/coordinates.json"));
const observations = await readJson(resolve(packageRoot, "fixtures/accepted/observations.json"));
validateInventory(inventory);
validateMatrix(matrix);
const selection = selectTier({ tier: "smoke" }, inventory, matrix);
const started = performance.now();
const targetsById = new Map(inventory.targets.map(target => [target.id, target]));
const scenariosById = new Map(matrix.scenarios.map(scenario => [scenario.id, scenario]));
const modelCases = selection.cases
  .filter(entry => entry.kind === "observation")
  .map(entry => ({
    caseId: entry.id,
    target: targetsById.get(entry.targetId),
    scenario: scenariosById.get(entry.scenarioId),
    result: evaluateControlledObservation(targetsById.get(entry.targetId), observations[entry.targetId]),
  }));
const receiptRoot = resolve(artifactRoot, "receipts");
const sourceBytes = await readFile(resolve(packageRoot, "source/receiver.html"));
const sourceCoordinate = value => ({ semanticId: value.semanticId, version: value.version, coordinate: value.coordinate, manifestKind: value.manifestKind, manifestSha256: value.manifestSha256 });
const receiverCoordinate = value => ({ semanticId: value.semanticId, version: value.version, manifestKind: value.manifestKind, manifestSha256: value.manifestSha256 });
const subject = { kind: "synthetic_receiver_fixture", path: "artifacts/receiver.html", sha256: sha256(sourceBytes), bytes: sourceBytes.byteLength };
const pointers = [];
for (const { caseId, target, scenario, result } of modelCases) {
  const receipt = {
    schemaVersion: "0.1.0",
    receiptId: `example-${target.id}-${scenario.id}-chromium-model`,
    caseId,
    targetId: target.id,
    decisionBoundary: target.decision,
    source: sourceCoordinate(coordinates.tokenSource),
    receiver: receiverCoordinate(coordinates.receiver),
    subject,
    environment: { coordinateKind: "model_fixture", playwrightVersion: "1.64.1", browserName: "chromium", browserVersion: "model-fixture", browserRevision: "resolved-by-lock", node: process.version, platform: process.platform, arch: process.arch, fontSet: "system-ui synthetic fixture", headless: true },
    viewportMedia: { scenarioId: scenario.id, width: scenario.viewport.width, height: scenario.viewport.height, textScale: scenario.textScale, direction: scenario.direction, media: scenario.media, colorMode: scenario.colorMode, motion: scenario.motion, image: scenario.image, font: scenario.font, input: scenario.input, state: scenario.state, javaScript: scenario.javaScript !== false },
    observation: target.oracle,
    result,
    artifacts: [{ path: subject.path, sha256: subject.sha256, bytes: subject.bytes }],
    measurements: { elapsedMs: Number((performance.now() - started).toFixed(3)), emittedBytes: sourceBytes.byteLength, peakRssBytes: process.memoryUsage().rss, assertionCount: 1 },
    standing: "candidate",
    classification: "deterministic_implementation_change",
    restartFrom: target.restartFrom,
  };
  const publicationRoot = resolve(receiptRoot, target.id, scenario.id);
  pointers.push(await publishReceipt(publicationRoot, receipt, {
    artifactSources: { [subject.path]: resolve(packageRoot, "source/receiver.html") },
    ownerRoot: packageRoot,
  }));
}
process.stdout.write(`${JSON.stringify({ selection, executedModelCases: modelCases.map(entry => entry.caseId), pointers }, null, 2)}\n`);
