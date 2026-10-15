import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const examples = [
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

for (const [name, script, ...args] of examples) {
  const result = spawnSync("uv", [
    "--cache-dir", ".artifacts/uv-cache", "run", "--no-project", "--python", "3.12",
    "python", `.agents/skills/${name}/exercises/${script}`, ...args,
  ], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`Skill exercise held: ${name}`);
    process.exitCode = 1;
    break;
  }
}
