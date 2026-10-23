import "./node-runtime-guard.mjs";

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const root = resolve(import.meta.dirname, "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const pythonExamples = [
  ["visualization-question-routing", "exercise.py", "--check"],
  ["longitudinal-observation-visualization", "exercise.py", "--check"],
  ["spatial-support-and-change-visualization", "exercise.py", "--check"],
  ["omics-coordinate-and-measurement-views", "verify.py"],
  ["scientific-scale-and-transform-fidelity", "verify.py"],
  ["scientific-figure-composition", "verify.py"],
  ["typed-error-recovery-contracts", "exercise.py"],
  ["controlled-context-comparison", "exercise.py"],
  ["parity-bound-workload-measurement", "exercise.py"],
  ["interruption-safe-resource-ownership", "exercise.py"],
  ["bounded-representation-admission", "exercise.py"],
];

const nodeExamples = [
  ["design-token-pipeline-stewardship", "exercise"],
  ["semantic-visual-receiver-contracts", "exercise"],
  ["visual-contract-receipt-design", "exercise"],
  ["visual-artifact-family-publication", "exercise"],
];

const runtimeModes = new Set(["all", "node", "python"]);

function exercise(examples, commandFor) {
  for (const [name, script, ...args] of examples) {
    const [command, commandArguments] = commandFor(name, script, args);
    const result = spawnSync(command, commandArguments, { cwd: root, stdio: "inherit" });
    if (result.status !== 0) {
      console.error(`Skill exercise held: ${name}`);
      return false;
    }
  }
  return true;
}

const { values } = parseArgs({
  options: { runtime: { type: "string", default: "all" } },
  strict: true,
});
if (!runtimeModes.has(values.runtime))
  throw new Error("--runtime must be one of: all, node, python");

if (
  values.runtime !== "node" &&
  !exercise(pythonExamples, (name, script, args) => [
    "uv",
    [
      "--cache-dir", ".artifacts/uv-cache", "run", "--no-project", "--python", "3.12",
      "python", `.agents/skills/${name}/exercises/${script}`, ...args,
    ],
  ])
) {
  process.exitCode = 1;
}

if (
  !process.exitCode &&
  values.runtime !== "python" &&
  !exercise(nodeExamples, (name, script, args) => [
    npm,
    ["--prefix", `.agents/skills/${name}`, "run", script, "--", ...args],
  ])
) {
  process.exitCode = 1;
}

if (!process.exitCode && values.runtime !== "python") {
  const nodeOnlyExamples = [
    ["secret-boundary-inspection", "exercise"],
    ["secret-boundary-inspection", "test:source-identity"],
  ];
  if (!exercise(nodeOnlyExamples, (name, script, args) => [
    npm,
    ["--prefix", `.agents/skills/${name}`, "run", script, "--", ...args],
  ])) {
    process.exitCode = 1;
  }
}
