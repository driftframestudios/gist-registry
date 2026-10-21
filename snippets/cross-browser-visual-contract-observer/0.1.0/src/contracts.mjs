import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open } from "node:fs/promises";

const ORACLES = new Set(["semantic", "interaction", "geometry", "computed_style", "bitmap_crop"]);
const TIERS = new Set(["smoke", "changed_boundary", "full"]);
const DIRECTIONS = new Set(["ltr", "rtl"]);
const MEDIA = new Set(["screen", "print"]);
const COLOR_MODES = new Set(["normal", "forced"]);
const MOTION = new Set(["full", "reduced"]);
const IMAGE_STATES = new Set(["available", "missing"]);
const FONT_STATES = new Set(["system", "missing"]);
const INPUT_MODES = new Set(["keyboard", "pointer", "touch", "none"]);
const RECEIVER_STATES = new Set(["accepted", "invalid", "pending", "stale", "success", "warning"]);
const RESULT_STATES = new Set(["pass", "fail", "friction"]);
const STANDINGS = new Set(["candidate", "accepted"]);
const CLASSIFICATIONS = new Set(["contract_change", "deterministic_implementation_change", "declared_engine_platform_variance", "environmental_drift", "test_harness_fault", "bounded_follow_up"]);
const SOURCE_MANIFEST_KIND = "generated_output_manifest";
const RECEIVER_MANIFEST_KIND = "production_build_manifest";
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;
const SOURCE_FILE_SYSTEM = Object.freeze({ lstat, open });

export const OBSERVER_RESOURCE_LIMITS = Object.freeze({
  targets: 64,
  scenarios: 64,
  artifacts: 32,
  identifierBytes: 256,
  caseIdBytes: 1024,
  proseBytes: 16 * 1024,
  jsonBytes: 2 * 1024 * 1024,
  artifactPathBytes: 1024,
  viewportWidth: 8192,
  viewportHeight: 8192,
  artifactBytes: 16 * 1024 * 1024,
  aggregateArtifactBytes: 64 * 1024 * 1024,
  normalizedDepth: 24,
  normalizedNodes: 4096,
  normalizedStringBytes: 64 * 1024,
  normalizedAggregateStringBytes: 512 * 1024,
});

export class ObserverError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ObserverError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function stableStringify(value) {
  const order = input => {
    if (Array.isArray(input)) return input.map(order);
    if (input && typeof input === "object") {
      return Object.fromEntries(Object.keys(input).sort().map(key => [key, order(input[key])]));
    }
    return input;
  };
  return `${JSON.stringify(order(value), null, 2)}\n`;
}

// One bounded file descriptor owns inspection and reading. This keeps source
// identity, allocation, and cleanup inside the same observation boundary.
export async function readBoundedRegularFile(filePath, {
  boundary,
  maxBytes,
  expectedBytes = null,
  restartFrom,
  fileSystem = SOURCE_FILE_SYSTEM,
}) {
  let pathEntry;
  try {
    pathEntry = await fileSystem.lstat(filePath);
  } catch (error) {
    throw new ObserverError("SOURCE_FILE_UNREADABLE", "The source coordinate requires a readable file.", {
      boundary,
      reason: error.message,
      restartFrom,
    });
  }
  if (!pathEntry.isFile() || pathEntry.isSymbolicLink()) {
    throw new ObserverError("SOURCE_FILE_INVALID", "The source coordinate requires a directly addressed regular file.", {
      boundary,
      restartFrom,
    });
  }
  if (pathEntry.size > maxBytes) resourceLimitExceeded(boundary, maxBytes, pathEntry.size, restartFrom);
  if (expectedBytes !== null && pathEntry.size !== expectedBytes) {
    throw new ObserverError("SOURCE_SIZE_MISMATCH", "The source byte count must match its declared coordinate.", {
      boundary,
      expected: expectedBytes,
      observed: pathEntry.size,
      restartFrom,
    });
  }

  let handle;
  try {
    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
    handle = await fileSystem.open(filePath, flags);
  } catch (error) {
    throw new ObserverError("SOURCE_FILE_UNREADABLE", "The source coordinate changed or became unreadable before capture.", {
      boundary,
      reason: error.message,
      restartFrom,
    });
  }

  let primaryError = null;
  try {
    const openedEntry = await handle.stat();
    if (!openedEntry.isFile()) {
      throw new ObserverError("SOURCE_FILE_INVALID", "The opened source coordinate requires a regular file.", {
        boundary,
        restartFrom,
      });
    }
    if (openedEntry.dev !== pathEntry.dev || openedEntry.ino !== pathEntry.ino) {
      throw new ObserverError("SOURCE_FILE_CHANGED", "The source coordinate changed before capture completed.", {
        boundary,
        restartFrom,
      });
    }
    if (openedEntry.size > maxBytes) resourceLimitExceeded(boundary, maxBytes, openedEntry.size, restartFrom);
    if (expectedBytes !== null && openedEntry.size !== expectedBytes) {
      throw new ObserverError("SOURCE_SIZE_MISMATCH", "The opened source byte count must match its declared coordinate.", {
        boundary,
        expected: expectedBytes,
        observed: openedEntry.size,
        restartFrom,
      });
    }

    const bytes = Buffer.allocUnsafe(openedEntry.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    const overflowProbe = Buffer.allocUnsafe(1);
    const overflow = await handle.read(overflowProbe, 0, 1, openedEntry.size);
    const settledEntry = await handle.stat();
    if (
      offset !== openedEntry.size ||
      overflow.bytesRead > 0 ||
      settledEntry.size !== openedEntry.size ||
      settledEntry.mtimeMs !== openedEntry.mtimeMs
    ) {
      throw new ObserverError("SOURCE_FILE_CHANGED", "The source bytes changed during bounded capture.", {
        boundary,
        restartFrom,
      });
    }
    return bytes;
  } catch (error) {
    primaryError = error instanceof ObserverError
      ? error
      : new ObserverError("SOURCE_CAPTURE_FAILED", "The source coordinate could not complete its bounded capture.", {
        boundary,
        reason: error.message,
        restartFrom,
      });
    throw primaryError;
  } finally {
    try {
      await handle.close();
    } catch (error) {
      if (primaryError === null) {
        throw new ObserverError("SOURCE_FILE_CLOSE_FAILED", "The source descriptor requires operator recovery after capture.", {
          boundary,
          reason: error.message,
          restartFrom,
        });
      }
    }
  }
}

export async function readJson(path) {
  let bytes;
  try {
    bytes = await readBoundedRegularFile(path, {
      boundary: "json_input.bytes",
      maxBytes: OBSERVER_RESOURCE_LIMITS.jsonBytes,
      restartFrom: "input",
    });
  } catch (error) {
    if (error instanceof ObserverError) throw error;
    throw new ObserverError("INVALID_JSON", "The observer requires readable JSON input.", {
      reason: error.message,
      restartFrom: "input",
    });
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new ObserverError("INVALID_JSON", "The observer requires readable JSON input.", {
      reason: error.message,
      restartFrom: "input",
    });
  }
}

function resourceLimitExceeded(boundary, limit, observed, restartFrom) {
  throw new ObserverError("RESOURCE_LIMIT_EXCEEDED", `${boundary} exceeds its finite observation envelope.`, {
    boundary,
    limit,
    observed,
    restartFrom,
  });
}

function requireKeys(record, keys, boundary, optionalKeys = []) {
  const restartFrom = boundary.startsWith("receipt")
    ? "receipt"
    : boundary.startsWith("matrix") || boundary.startsWith("observation_matrix")
      ? "matrix"
      : boundary.startsWith("decision")
        ? "inventory"
        : "source";
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new ObserverError("INVALID_CONTRACT", `${boundary} must be an object.`, { boundary, restartFrom });
  }
  const missing = keys.filter(key => !Object.hasOwn(record, key));
  if (missing.length > 0) {
    throw new ObserverError("INVALID_CONTRACT", `${boundary} is missing required fields.`, {
      boundary,
      missing,
      restartFrom,
    });
  }
  const admitted = new Set([...keys, ...optionalKeys]);
  const unknown = Object.keys(record).filter(key => !admitted.has(key));
  if (unknown.length > 0) {
    throw new ObserverError("INVALID_CONTRACT", `${boundary} contains fields outside its declared contract.`, {
      boundary,
      unknown,
      restartFrom,
    });
  }
}

function requireBoundedString(value, { boundary, field, maxBytes, pattern = null, restartFrom }) {
  if (typeof value !== "string" || value.length === 0) {
    throw new ObserverError("INVALID_CONTRACT", `${boundary}.${field} must be a non-empty string.`, { boundary, field, restartFrom });
  }
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes > maxBytes) resourceLimitExceeded(`${boundary}.${field}`, maxBytes, bytes, restartFrom);
  if (pattern && !pattern.test(value)) {
    throw new ObserverError("INVALID_CONTRACT", `${boundary}.${field} has an unsupported format.`, { boundary, field, restartFrom });
  }
  return value;
}

function requireBoundedArray(value, { boundary, minimum = 1, maximum, restartFrom }) {
  if (!Array.isArray(value) || value.length < minimum) {
    throw new ObserverError("INVALID_CONTRACT", `${boundary} requires at least ${minimum} item${minimum === 1 ? "" : "s"}.`, { boundary, restartFrom });
  }
  if (value.length > maximum) resourceLimitExceeded(boundary, maximum, value.length, restartFrom);
  return value;
}

function requireEnum(value, values, boundary, restartFrom) {
  if (!values.has(value)) {
    throw new ObserverError("INVALID_CONTRACT", `${boundary} names an unsupported value.`, { boundary, value, restartFrom });
  }
}

function validateNormalizedEnvelope(value) {
  const seen = new WeakSet();
  const stack = [{ value, depth: 0 }];
  let nodes = 0;
  let aggregateStringBytes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > OBSERVER_RESOURCE_LIMITS.normalizedNodes) {
      resourceLimitExceeded("receipt.result.normalized.nodes", OBSERVER_RESOURCE_LIMITS.normalizedNodes, nodes, "receipt");
    }
    if (current.depth > OBSERVER_RESOURCE_LIMITS.normalizedDepth) {
      resourceLimitExceeded("receipt.result.normalized.depth", OBSERVER_RESOURCE_LIMITS.normalizedDepth, current.depth, "receipt");
    }
    if (typeof current.value === "string") {
      const bytes = Buffer.byteLength(current.value, "utf8");
      if (bytes > OBSERVER_RESOURCE_LIMITS.normalizedStringBytes) {
        resourceLimitExceeded("receipt.result.normalized.string", OBSERVER_RESOURCE_LIMITS.normalizedStringBytes, bytes, "receipt");
      }
      aggregateStringBytes += bytes;
      if (aggregateStringBytes > OBSERVER_RESOURCE_LIMITS.normalizedAggregateStringBytes) {
        resourceLimitExceeded("receipt.result.normalized.stringBytes", OBSERVER_RESOURCE_LIMITS.normalizedAggregateStringBytes, aggregateStringBytes, "receipt");
      }
      continue;
    }
    if (current.value === null || typeof current.value === "boolean") continue;
    if (typeof current.value === "number" && Number.isFinite(current.value)) continue;
    if (!current.value || typeof current.value !== "object") {
      throw new ObserverError("INVALID_CONTRACT", "receipt.result.normalized must contain JSON-compatible values.", { restartFrom: "receipt" });
    }
    if (seen.has(current.value)) {
      throw new ObserverError("INVALID_CONTRACT", "receipt.result.normalized must be acyclic.", { restartFrom: "receipt" });
    }
    seen.add(current.value);
    if (!Array.isArray(current.value) && Object.getPrototypeOf(current.value) !== Object.prototype && Object.getPrototypeOf(current.value) !== null) {
      throw new ObserverError("INVALID_CONTRACT", "receipt.result.normalized must contain JSON objects and arrays.", { restartFrom: "receipt" });
    }
    for (const [key, child] of Object.entries(current.value)) {
      const keyBytes = Buffer.byteLength(key, "utf8");
      if (keyBytes > OBSERVER_RESOURCE_LIMITS.identifierBytes) {
        resourceLimitExceeded("receipt.result.normalized.key", OBSERVER_RESOURCE_LIMITS.identifierBytes, keyBytes, "receipt");
      }
      aggregateStringBytes += keyBytes;
      if (aggregateStringBytes > OBSERVER_RESOURCE_LIMITS.normalizedAggregateStringBytes) {
        resourceLimitExceeded("receipt.result.normalized.stringBytes", OBSERVER_RESOURCE_LIMITS.normalizedAggregateStringBytes, aggregateStringBytes, "receipt");
      }
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
}

export function validateInventory(inventory) {
  requireKeys(inventory, ["schemaVersion", "targets"], "decision_inventory");
  if (inventory.schemaVersion !== "0.1.0") {
    throw new ObserverError("INVALID_INVENTORY", "The decision inventory requires version 0.1.0 and at least one target.", { restartFrom: "inventory" });
  }
  requireBoundedArray(inventory.targets, { boundary: "decision_inventory.targets", maximum: OBSERVER_RESOURCE_LIMITS.targets, restartFrom: "inventory" });
  const ids = new Set();
  const faults = new Set();
  for (const target of inventory.targets) {
    requireKeys(target, ["id", "decision", "behavior", "fault", "oracle", "scenarioIds", "faultScenarioId", "consequence", "restartFrom"], "decision_target");
    requireBoundedString(target.id, { boundary: "decision_target", field: "id", maxBytes: OBSERVER_RESOURCE_LIMITS.identifierBytes, pattern: IDENTIFIER_PATTERN, restartFrom: "inventory" });
    requireBoundedString(target.fault, { boundary: "decision_target", field: "fault", maxBytes: OBSERVER_RESOURCE_LIMITS.identifierBytes, pattern: IDENTIFIER_PATTERN, restartFrom: "inventory" });
    requireBoundedString(target.restartFrom, { boundary: "decision_target", field: "restartFrom", maxBytes: OBSERVER_RESOURCE_LIMITS.identifierBytes, pattern: IDENTIFIER_PATTERN, restartFrom: "inventory" });
    for (const field of ["decision", "behavior", "consequence"]) {
      requireBoundedString(target[field], { boundary: "decision_target", field, maxBytes: OBSERVER_RESOURCE_LIMITS.proseBytes, restartFrom: "inventory" });
    }
    if (ids.has(target.id)) throw new ObserverError("DUPLICATE_TARGET", `Target ${target.id} appears more than once.`, { targetId: target.id, restartFrom: "inventory" });
    if (faults.has(target.fault)) throw new ObserverError("DUPLICATE_FAULT", `Fault ${target.fault} maps to several targets.`, { fault: target.fault, restartFrom: "inventory" });
    if (!ORACLES.has(target.oracle)) throw new ObserverError("ORACLE_UNSUPPORTED", `Target ${target.id} names an unsupported oracle.`, { targetId: target.id, oracle: target.oracle, restartFrom: "inventory" });
    requireBoundedArray(target.scenarioIds, { boundary: `decision_target.${target.id}.scenarioIds`, maximum: OBSERVER_RESOURCE_LIMITS.scenarios, restartFrom: "inventory" });
    const scenarioIds = new Set();
    for (const scenarioId of target.scenarioIds) {
      requireBoundedString(scenarioId, { boundary: `decision_target.${target.id}`, field: "scenarioId", maxBytes: OBSERVER_RESOURCE_LIMITS.identifierBytes, pattern: IDENTIFIER_PATTERN, restartFrom: "inventory" });
      if (scenarioIds.has(scenarioId)) throw new ObserverError("DUPLICATE_SCENARIO", `Target ${target.id} repeats an applicable scenario.`, { targetId: target.id, scenarioId, restartFrom: "inventory" });
      scenarioIds.add(scenarioId);
    }
    requireBoundedString(target.faultScenarioId, { boundary: `decision_target.${target.id}`, field: "faultScenarioId", maxBytes: OBSERVER_RESOURCE_LIMITS.identifierBytes, pattern: IDENTIFIER_PATTERN, restartFrom: "inventory" });
    if (!scenarioIds.has(target.faultScenarioId)) {
      throw new ObserverError("FAULT_SCENARIO_INAPPLICABLE", `Target ${target.id} requires its controlled fault inside the target's applicable scenarios.`, { targetId: target.id, scenarioId: target.faultScenarioId, restartFrom: "inventory" });
    }
    ids.add(target.id);
    faults.add(target.fault);
  }
  return { targetCount: ids.size, evidenceClasses: [...new Set(inventory.targets.map(target => target.oracle))].sort() };
}

export function validateMatrix(matrix) {
  requireKeys(matrix, ["schemaVersion", "scenarios"], "observation_matrix");
  if (matrix.schemaVersion !== "0.1.0") {
    throw new ObserverError("INVALID_MATRIX", "The observation matrix requires version 0.1.0 and at least one scenario.", { restartFrom: "matrix" });
  }
  requireBoundedArray(matrix.scenarios, { boundary: "observation_matrix.scenarios", maximum: OBSERVER_RESOURCE_LIMITS.scenarios, restartFrom: "matrix" });
  const ids = new Set();
  for (const scenario of matrix.scenarios) {
    requireKeys(scenario, ["id", "tiers", "viewport", "textScale", "direction", "media", "colorMode", "motion", "image", "font", "input", "state"], "matrix_scenario", ["javaScript"]);
    requireBoundedString(scenario.id, { boundary: "matrix_scenario", field: "id", maxBytes: OBSERVER_RESOURCE_LIMITS.identifierBytes, pattern: IDENTIFIER_PATTERN, restartFrom: "matrix" });
    if (ids.has(scenario.id)) throw new ObserverError("DUPLICATE_SCENARIO", `Scenario ${scenario.id} appears more than once.`, { scenarioId: scenario.id, restartFrom: "matrix" });
    requireBoundedArray(scenario.tiers, { boundary: `matrix_scenario.${scenario.id}.tiers`, maximum: TIERS.size, restartFrom: "matrix" });
    if (!scenario.tiers.every(tier => TIERS.has(tier)) || new Set(scenario.tiers).size !== scenario.tiers.length) throw new ObserverError("TIER_UNSUPPORTED", `Scenario ${scenario.id} names an unsupported or repeated tier.`, { scenarioId: scenario.id, restartFrom: "matrix" });
    requireKeys(scenario.viewport, ["width", "height"], "matrix_viewport");
    if (
      !Number.isInteger(scenario.viewport.width) ||
      scenario.viewport.width < 1 ||
      scenario.viewport.width > OBSERVER_RESOURCE_LIMITS.viewportWidth ||
      !Number.isInteger(scenario.viewport.height) ||
      scenario.viewport.height < 1 ||
      scenario.viewport.height > OBSERVER_RESOURCE_LIMITS.viewportHeight
    ) throw new ObserverError("VIEWPORT_INVALID", `Scenario ${scenario.id} requires a viewport inside the declared finite envelope.`, { scenarioId: scenario.id, maximum: { width: OBSERVER_RESOURCE_LIMITS.viewportWidth, height: OBSERVER_RESOURCE_LIMITS.viewportHeight }, restartFrom: "matrix" });
    if (![1, 2, 4].includes(scenario.textScale)) throw new ObserverError("INVALID_CONTRACT", `Scenario ${scenario.id} names an unsupported text scale.`, { scenarioId: scenario.id, restartFrom: "matrix" });
    requireEnum(scenario.direction, DIRECTIONS, `matrix_scenario.${scenario.id}.direction`, "matrix");
    requireEnum(scenario.media, MEDIA, `matrix_scenario.${scenario.id}.media`, "matrix");
    requireEnum(scenario.colorMode, COLOR_MODES, `matrix_scenario.${scenario.id}.colorMode`, "matrix");
    requireEnum(scenario.motion, MOTION, `matrix_scenario.${scenario.id}.motion`, "matrix");
    requireEnum(scenario.image, IMAGE_STATES, `matrix_scenario.${scenario.id}.image`, "matrix");
    requireEnum(scenario.font, FONT_STATES, `matrix_scenario.${scenario.id}.font`, "matrix");
    requireEnum(scenario.input, INPUT_MODES, `matrix_scenario.${scenario.id}.input`, "matrix");
    requireEnum(scenario.state, RECEIVER_STATES, `matrix_scenario.${scenario.id}.state`, "matrix");
    if (Object.hasOwn(scenario, "javaScript") && typeof scenario.javaScript !== "boolean") throw new ObserverError("INVALID_CONTRACT", `Scenario ${scenario.id} requires a boolean javaScript value.`, { scenarioId: scenario.id, restartFrom: "matrix" });
    ids.add(scenario.id);
  }
  const dimensions = key => [...new Set(matrix.scenarios.map(scenario => scenario[key]))].sort();
  const textScales = dimensions("textScale");
  const directions = dimensions("direction");
  const media = dimensions("media");
  const states = dimensions("state");
  const requiredStates = ["accepted", "invalid", "pending", "stale", "success", "warning"];
  if (![1, 2, 4].every(value => textScales.includes(value)) || !["ltr", "rtl"].every(value => directions.includes(value)) || !["print", "screen"].every(value => media.includes(value)) || !requiredStates.every(value => states.includes(value))) {
    throw new ObserverError("MATRIX_COVERAGE_GAP", "The matrix must carry 100%, 200%, and 400% text, both directions, screen plus print, and every declared receiver state.", { textScales, directions, media, states, restartFrom: "matrix" });
  }
  return { scenarioCount: ids.size, textScales, directions, media, states };
}

export function selectTier({ tier, changedTargetIds = [] }, inventory, matrix) {
  if (!TIERS.has(tier)) throw new ObserverError("TIER_UNSUPPORTED", `Tier ${tier} is outside the finite observation policy.`, { tier, restartFrom: "selection" });
  validateInventory(inventory);
  validateMatrix(matrix);
  if (!Array.isArray(changedTargetIds) || changedTargetIds.length > OBSERVER_RESOURCE_LIMITS.targets) {
    throw new ObserverError("INVALID_CONTRACT", "Changed-boundary selection requires a bounded target-id array.", { maximum: OBSERVER_RESOURCE_LIMITS.targets, restartFrom: "selection" });
  }
  for (const id of changedTargetIds) requireBoundedString(id, { boundary: "changed_target", field: "id", maxBytes: OBSERVER_RESOURCE_LIMITS.identifierBytes, pattern: IDENTIFIER_PATTERN, restartFrom: "selection" });
  const targetIds = new Set(inventory.targets.map(target => target.id));
  const unknown = changedTargetIds.filter(id => !targetIds.has(id));
  if (unknown.length > 0) throw new ObserverError("TARGET_UNKNOWN", "Changed-boundary selection includes an unknown target.", { unknown, restartFrom: "selection" });
  const changedTargets = new Set(changedTargetIds);
  const targets = tier === "changed_boundary"
    ? inventory.targets.filter(target => changedTargets.has(target.id))
    : tier === "smoke"
      ? inventory.targets.filter(target => ["semantic", "interaction"].includes(target.oracle))
      : inventory.targets;
  if (tier === "changed_boundary" && targets.length === 0) {
    throw new ObserverError("CHANGED_BOUNDARY_REQUIRED", "Changed-boundary coverage requires at least one named target.", { restartFrom: "selection" });
  }
  const scenarios = matrix.scenarios.filter(scenario => scenario.tiers.includes(tier));
  const knownScenarioIds = new Set(matrix.scenarios.map(scenario => scenario.id));
  for (const target of inventory.targets) {
    const unknownScenarioIds = [...target.scenarioIds, target.faultScenarioId].filter(id => !knownScenarioIds.has(id));
    if (unknownScenarioIds.length > 0) {
      throw new ObserverError("SCENARIO_UNKNOWN", `Target ${target.id} names a scenario outside the observation matrix.`, { targetId: target.id, unknownScenarioIds: [...new Set(unknownScenarioIds)], restartFrom: "inventory" });
    }
  }
  const selectedScenarioIds = new Set(scenarios.map(scenario => scenario.id));
  const cases = [];
  for (const target of targets) {
    for (const scenarioId of target.scenarioIds) {
      if (!selectedScenarioIds.has(scenarioId)) continue;
      cases.push({ id: `observe--${target.id}--${scenarioId}`, kind: "observation", targetId: target.id, scenarioId });
    }
    if (!selectedScenarioIds.has(target.faultScenarioId)) {
      throw new ObserverError("FAULT_SCENARIO_OUTSIDE_TIER", `Target ${target.id} requires a controlled-fault scenario inside tier ${tier}.`, { targetId: target.id, scenarioId: target.faultScenarioId, tier, restartFrom: "selection" });
    }
    cases.push({ id: `fault--${target.id}--${target.faultScenarioId}`, kind: "controlled_fault", targetId: target.id, scenarioId: target.faultScenarioId });
  }
  for (const scenario of scenarios) {
    cases.push({ id: `scenario--${scenario.id}`, kind: "scenario_contract", scenarioId: scenario.id });
  }
  return {
    tier,
    reason: tier === "smoke" ? "Fast semantic and interaction confidence" : tier === "changed_boundary" ? "Named receiver boundary changed" : "Release acceptance across the declared matrix",
    targets: targets.map(target => target.id),
    scenarios: scenarios.map(scenario => scenario.id),
    cases,
    expectedWork: cases.length,
    caseCounts: {
      observation: cases.filter(entry => entry.kind === "observation").length,
      controlledFault: cases.filter(entry => entry.kind === "controlled_fault").length,
      scenarioContract: cases.filter(entry => entry.kind === "scenario_contract").length,
    },
  };
}

export function evaluateControlledObservation(target, observed) {
  switch (target.oracle) {
    case "semantic":
      return { status: observed.accessibleName === "Specimen family" && observed.labelPosition === "above" ? "pass" : "fail", normalized: observed };
    case "interaction":
      return { status: observed.focusOwner === "preview" && observed.acceptedGeneration === 0 && observed.settlement === "stale" ? "pass" : "fail", normalized: observed };
    case "geometry":
      return { status: observed.scrollWidth <= observed.viewportWidth && observed.minimumHitTarget >= 44 ? "pass" : "fail", normalized: observed };
    case "computed_style":
      return { status: observed.customProperty === "--contract-action" && observed.resolvedValue === "rgb(37, 70, 245)" ? "pass" : "fail", normalized: observed };
    case "bitmap_crop":
      return { status: observed.crop === "workflow" && observed.connectorLayer < observed.cardLayer ? "pass" : "fail", normalized: observed };
    default:
      throw new ObserverError("ORACLE_UNSUPPORTED", `Oracle ${target.oracle} requires a registered evaluator.`, { targetId: target.id, restartFrom: "inventory" });
  }
}

export function validateReceipt(receipt) {
  requireKeys(receipt, ["schemaVersion", "receiptId", "caseId", "targetId", "decisionBoundary", "source", "receiver", "subject", "environment", "viewportMedia", "observation", "result", "artifacts", "measurements", "standing", "classification", "restartFrom"], "receipt");
  if (receipt.schemaVersion !== "0.1.0") throw new ObserverError("RECEIPT_VERSION_UNSUPPORTED", "Receipt schemaVersion must equal 0.1.0.", { restartFrom: "receipt" });
  requireBoundedString(receipt.receiptId, { boundary: "receipt", field: "receiptId", maxBytes: OBSERVER_RESOURCE_LIMITS.identifierBytes, pattern: IDENTIFIER_PATTERN, restartFrom: "receipt" });
  requireBoundedString(receipt.caseId, { boundary: "receipt", field: "caseId", maxBytes: OBSERVER_RESOURCE_LIMITS.caseIdBytes, pattern: IDENTIFIER_PATTERN, restartFrom: "receipt" });
  requireBoundedString(receipt.targetId, { boundary: "receipt", field: "targetId", maxBytes: OBSERVER_RESOURCE_LIMITS.identifierBytes, pattern: IDENTIFIER_PATTERN, restartFrom: "receipt" });
  requireBoundedString(receipt.restartFrom, { boundary: "receipt", field: "restartFrom", maxBytes: OBSERVER_RESOURCE_LIMITS.identifierBytes, pattern: IDENTIFIER_PATTERN, restartFrom: "receipt" });
  requireBoundedString(receipt.decisionBoundary, { boundary: "receipt", field: "decisionBoundary", maxBytes: OBSERVER_RESOURCE_LIMITS.proseBytes, restartFrom: "receipt" });
  if (!ORACLES.has(receipt.observation)) throw new ObserverError("ORACLE_UNSUPPORTED", "Receipt observation type is outside the admitted set.", { observation: receipt.observation, restartFrom: "receipt" });
  requireEnum(receipt.standing, STANDINGS, "receipt.standing", "receipt");
  requireEnum(receipt.classification, CLASSIFICATIONS, "receipt.classification", "receipt");
  requireKeys(receipt.source, ["semanticId", "version", "coordinate", "manifestKind", "manifestSha256"], "receipt.source");
  requireKeys(receipt.source.coordinate, ["brand", "mode"], "receipt.source.coordinate");
  requireKeys(receipt.receiver, ["semanticId", "version", "manifestKind", "manifestSha256"], "receipt.receiver");
  for (const [boundary, coordinate] of [["receipt.source", receipt.source], ["receipt.receiver", receipt.receiver]]) {
    requireBoundedString(coordinate.semanticId, { boundary, field: "semanticId", maxBytes: OBSERVER_RESOURCE_LIMITS.identifierBytes, pattern: IDENTIFIER_PATTERN, restartFrom: "coordinate" });
    requireBoundedString(coordinate.version, { boundary, field: "version", maxBytes: OBSERVER_RESOURCE_LIMITS.identifierBytes, pattern: /^\d+\.\d+\.\d+$/u, restartFrom: "coordinate" });
  }
  for (const field of ["brand", "mode"]) requireBoundedString(receipt.source.coordinate[field], { boundary: "receipt.source.coordinate", field, maxBytes: OBSERVER_RESOURCE_LIMITS.identifierBytes, pattern: IDENTIFIER_PATTERN, restartFrom: "coordinate" });
  requireKeys(receipt.environment, ["coordinateKind", "playwrightVersion", "browserName", "browserVersion", "browserRevision", "node", "platform", "arch", "fontSet", "headless"], "receipt.environment");
  for (const field of ["coordinateKind", "playwrightVersion", "browserName", "browserVersion", "browserRevision", "node", "platform", "arch"]) {
    requireBoundedString(receipt.environment[field], { boundary: "receipt.environment", field, maxBytes: OBSERVER_RESOURCE_LIMITS.identifierBytes, restartFrom: "environment" });
  }
  requireBoundedString(receipt.environment.fontSet, { boundary: "receipt.environment", field: "fontSet", maxBytes: OBSERVER_RESOURCE_LIMITS.proseBytes, restartFrom: "environment" });
  if (typeof receipt.environment.headless !== "boolean") throw new ObserverError("INVALID_CONTRACT", "receipt.environment.headless must be boolean.", { restartFrom: "environment" });
  if (receipt.environment?.playwrightVersion !== "1.64.1") throw new ObserverError("ENVIRONMENT_COORDINATE_MISMATCH", "Receipt must bind to Playwright 1.64.1.", { observed: receipt.environment?.playwrightVersion, restartFrom: "environment" });
  for (const coordinate of [receipt.source, receipt.receiver]) {
    if (!/^[a-f0-9]{64}$/u.test(coordinate?.manifestSha256 ?? "")) throw new ObserverError("DIGEST_INVALID", "Source and receiver coordinates require SHA-256 digests.", { restartFrom: "coordinate" });
  }
  if (receipt.source.manifestKind !== SOURCE_MANIFEST_KIND || receipt.receiver.manifestKind !== RECEIVER_MANIFEST_KIND) {
    throw new ObserverError("MANIFEST_KIND_MISMATCH", "Source and receiver coordinates require their declared generated-output and production-build manifest kinds.", { sourceKind: receipt.source.manifestKind, receiverKind: receipt.receiver.manifestKind, restartFrom: "coordinate" });
  }
  requireKeys(receipt.subject, ["kind", "path", "sha256", "bytes"], "receipt.subject");
  requireBoundedString(receipt.subject.path, { boundary: "receipt.subject", field: "path", maxBytes: OBSERVER_RESOURCE_LIMITS.artifactPathBytes, restartFrom: "receipt" });
  if (!Number.isInteger(receipt.subject.bytes) || receipt.subject.bytes < 1 || receipt.subject.bytes > OBSERVER_RESOURCE_LIMITS.artifactBytes) resourceLimitExceeded("receipt.subject.bytes", OBSERVER_RESOURCE_LIMITS.artifactBytes, receipt.subject.bytes, "receipt");
  requireKeys(receipt.viewportMedia, ["scenarioId", "width", "height", "textScale", "direction", "media", "colorMode", "motion", "image", "font", "input", "state", "javaScript"], "receipt.viewportMedia");
  requireBoundedString(receipt.viewportMedia.scenarioId, { boundary: "receipt.viewportMedia", field: "scenarioId", maxBytes: OBSERVER_RESOURCE_LIMITS.identifierBytes, pattern: IDENTIFIER_PATTERN, restartFrom: "receipt" });
  if (!Number.isInteger(receipt.viewportMedia.width) || receipt.viewportMedia.width < 1 || receipt.viewportMedia.width > OBSERVER_RESOURCE_LIMITS.viewportWidth || !Number.isInteger(receipt.viewportMedia.height) || receipt.viewportMedia.height < 1 || receipt.viewportMedia.height > OBSERVER_RESOURCE_LIMITS.viewportHeight) {
    throw new ObserverError("VIEWPORT_INVALID", "Receipt viewport dimensions must remain inside the declared finite envelope.", { maximum: { width: OBSERVER_RESOURCE_LIMITS.viewportWidth, height: OBSERVER_RESOURCE_LIMITS.viewportHeight }, restartFrom: "receipt" });
  }
  if (![1, 2, 4].includes(receipt.viewportMedia.textScale)) throw new ObserverError("INVALID_CONTRACT", "Receipt textScale is unsupported.", { restartFrom: "receipt" });
  requireEnum(receipt.viewportMedia.direction, DIRECTIONS, "receipt.viewportMedia.direction", "receipt");
  requireEnum(receipt.viewportMedia.media, MEDIA, "receipt.viewportMedia.media", "receipt");
  requireEnum(receipt.viewportMedia.colorMode, COLOR_MODES, "receipt.viewportMedia.colorMode", "receipt");
  requireEnum(receipt.viewportMedia.motion, MOTION, "receipt.viewportMedia.motion", "receipt");
  requireEnum(receipt.viewportMedia.image, IMAGE_STATES, "receipt.viewportMedia.image", "receipt");
  requireEnum(receipt.viewportMedia.font, FONT_STATES, "receipt.viewportMedia.font", "receipt");
  requireEnum(receipt.viewportMedia.input, INPUT_MODES, "receipt.viewportMedia.input", "receipt");
  requireEnum(receipt.viewportMedia.state, RECEIVER_STATES, "receipt.viewportMedia.state", "receipt");
  if (typeof receipt.viewportMedia.javaScript !== "boolean") throw new ObserverError("INVALID_CONTRACT", "receipt.viewportMedia.javaScript must be boolean.", { restartFrom: "receipt" });
  requireKeys(receipt.result, ["status", "normalized"], "receipt.result");
  requireEnum(receipt.result.status, RESULT_STATES, "receipt.result.status", "receipt");
  validateNormalizedEnvelope(receipt.result.normalized);
  requireBoundedArray(receipt.artifacts, { boundary: "receipt.artifacts", minimum: 0, maximum: OBSERVER_RESOURCE_LIMITS.artifacts, restartFrom: "receipt" });
  const artifactPaths = new Set();
  let emittedBytes = 0;
  for (const artifact of receipt.artifacts) {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
      throw new ObserverError("ARTIFACT_BOUNDARY_INVALID", "Receipt artifacts require normalized contained paths, positive byte counts, and SHA-256 digests.", { artifact, restartFrom: "receipt" });
    }
    requireKeys(artifact, ["path", "sha256", "bytes"], "receipt.artifact");
    const pathSegments = typeof artifact.path === "string" ? artifact.path.split("/") : [];
    if (
      pathSegments[0] !== "artifacts" ||
      pathSegments.length < 2 ||
      pathSegments.slice(1).some(segment => !segment || segment === "." || segment === "..") ||
      artifact.path.includes("\\") ||
      !/^[a-f0-9]{64}$/u.test(artifact.sha256 ?? "") ||
      !Number.isInteger(artifact.bytes) ||
      artifact.bytes < 1 ||
      artifact.bytes > OBSERVER_RESOURCE_LIMITS.artifactBytes
    ) {
      throw new ObserverError("ARTIFACT_BOUNDARY_INVALID", "Receipt artifacts require normalized contained paths, positive byte counts, and SHA-256 digests.", { artifact, restartFrom: "receipt" });
    }
    const pathBytes = Buffer.byteLength(artifact.path, "utf8");
    if (pathBytes > OBSERVER_RESOURCE_LIMITS.artifactPathBytes) resourceLimitExceeded("receipt.artifact.path", OBSERVER_RESOURCE_LIMITS.artifactPathBytes, pathBytes, "receipt");
    if (artifactPaths.has(artifact.path)) throw new ObserverError("ARTIFACT_PATH_DUPLICATE", "Receipt artifact paths must be unique.", { artifactPath: artifact.path, restartFrom: "receipt" });
    artifactPaths.add(artifact.path);
    emittedBytes += artifact.bytes;
    if (emittedBytes > OBSERVER_RESOURCE_LIMITS.aggregateArtifactBytes) resourceLimitExceeded("receipt.artifacts.bytes", OBSERVER_RESOURCE_LIMITS.aggregateArtifactBytes, emittedBytes, "receipt");
  }
  const subjectArtifact = receipt.artifacts.find(artifact => artifact.path === receipt.subject?.path);
  if (receipt.subject?.kind !== "synthetic_receiver_fixture" || !subjectArtifact || subjectArtifact.sha256 !== receipt.subject.sha256 || subjectArtifact.bytes !== receipt.subject.bytes) {
    throw new ObserverError("SUBJECT_ARTIFACT_MISMATCH", "The observed subject must name matching contained fixture bytes.", { restartFrom: "receipt" });
  }
  requireKeys(receipt.measurements, ["elapsedMs", "emittedBytes", "peakRssBytes", "assertionCount"], "receipt.measurements");
  if (
    typeof receipt.measurements.elapsedMs !== "number" ||
    !Number.isFinite(receipt.measurements.elapsedMs) ||
    receipt.measurements.elapsedMs < 0 ||
    !Number.isSafeInteger(receipt.measurements.emittedBytes) ||
    !Number.isSafeInteger(receipt.measurements.peakRssBytes) ||
    receipt.measurements.peakRssBytes < 0 ||
    !Number.isInteger(receipt.measurements?.assertionCount) ||
    receipt.measurements.assertionCount < 1 ||
    receipt.measurements?.emittedBytes !== emittedBytes
  ) {
    throw new ObserverError("MEASUREMENT_INVALID", "Receipt measurements require a positive assertion count and the exact total emitted artifact bytes.", { expectedEmittedBytes: emittedBytes, restartFrom: "receipt" });
  }
  return receipt;
}
