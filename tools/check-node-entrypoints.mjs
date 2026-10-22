import "./node-runtime-guard.mjs";

import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  NODE_RUNTIME_DEV_ENGINE,
  NODE_RUNTIME_POLICY,
} from "./node-runtime-policy.mjs";
import { isDirectNodeInvocation } from "./node-cli-entrypoint.mjs";

const modulePath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(modulePath), "..");
const inventoryPath = resolve(repositoryRoot, "tools/node-entrypoints.json");
const guardPath = resolve(repositoryRoot, "tools/node-runtime-guard.mjs");
const portableAdmissionPath = resolve(
  repositoryRoot,
  "tools/portable-node-runtime-admission.mjs",
);
const portableCliIdentityPath = resolve(
  repositoryRoot,
  "tools/portable-node-cli-entrypoint.mjs",
);
const ignoredDirectories = new Set([
  ".artifacts",
  ".git",
  ".ruff_cache",
  ".tools",
  ".venv",
  "__pycache__",
  "node_modules",
]);

function repositoryPath(path) {
  return relative(repositoryRoot, path).split(sep).join("/");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function inspectRegularCoordinate(path, findings, code) {
  const resolvedPath = resolve(repositoryRoot, path);
  try {
    const status = await lstat(resolvedPath);
    if (!status.isFile()) {
      findings.push({ code, path, reason: "entrypoint coordinate must be a regular file" });
      return null;
    }
    const identity = await realpath(resolvedPath);
    if (identity !== resolvedPath) {
      findings.push({ code: "NODE_ENTRYPOINT_SYMLINK", path, resolved: repositoryPath(identity) });
      return null;
    }
    return resolvedPath;
  } catch (error) {
    findings.push({ code, path, reason: error?.code ?? "unreadable entrypoint coordinate" });
    return null;
  }
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function inspectSortedUnique(values, field, findings) {
  const expected = sortedUnique(values);
  if (values.length !== expected.length || values.some((value, index) => value !== expected[index])) {
    findings.push({ code: "NODE_ENTRYPOINT_INVENTORY_ORDER", field, expected });
  }
}

function packageCarriesAdmission(manifest) {
  const runtime = manifest.devEngines?.runtime;
  return (
    manifest.engines?.node === NODE_RUNTIME_POLICY.engineRange &&
    runtime?.name === NODE_RUNTIME_DEV_ENGINE.name &&
    runtime?.version === NODE_RUNTIME_DEV_ENGINE.version &&
    runtime?.onFail === NODE_RUNTIME_DEV_ENGINE.onFail
  );
}

function isInside(owner, candidate) {
  return candidate === owner || candidate.startsWith(owner + sep);
}

export function splitShellSegments(command) {
  const segments = [];
  let current = "";
  let quote = null;
  let escaped = false;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      current += character;
      escaped = true;
      continue;
    }
    if (quote) {
      current += character;
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }
    if (character === ";" || character === "|" || character === "&" || character === "\n") {
      if (current.trim()) segments.push(current.trim());
      current = "";
      if (command[index + 1] === character) index += 1;
      continue;
    }
    current += character;
  }
  if (current.trim()) segments.push(current.trim());
  return { segments, supported: quote === null && !escaped };
}

async function inspectGuardImport(path, findings) {
  const resolvedPath = await inspectRegularCoordinate(path, findings, "NODE_ENTRYPOINT_MISSING");
  if (!resolvedPath) return;
  const source = await readFile(resolvedPath, "utf8");
  const body = source.startsWith("#!") ? source.slice(source.indexOf("\n") + 1) : source;
  const match = /^\s*import\s+["']([^"']*node-runtime-guard\.mjs)["'];/u.exec(body);
  if (!match) {
    findings.push({ code: "NODE_ENTRYPOINT_GUARD_MISSING", path });
    return;
  }
  try {
    const importedIdentity = await realpath(resolve(dirname(resolvedPath), match[1]));
    const guardIdentity = await realpath(guardPath);
    if (importedIdentity !== guardIdentity) {
      findings.push({
        code: "NODE_ENTRYPOINT_GUARD_IDENTITY",
        path,
        observed: repositoryPath(importedIdentity),
        expected: repositoryPath(guardIdentity),
      });
    }
  } catch (error) {
    findings.push({
      code: "NODE_ENTRYPOINT_GUARD_UNRESOLVED",
      path,
      reason: error?.code ?? "guard import cannot be resolved",
    });
  }
}

async function inspectRootCliIdentity(path, findings) {
  const resolvedPath = await inspectRegularCoordinate(path, findings, "NODE_CLI_ENTRYPOINT_MISSING");
  if (!resolvedPath) return;
  const source = await readFile(resolvedPath, "utf8");
  if (!/import\s+\{\s*isDirectNodeInvocation\s*\}\s+from\s+["']\.\/node-cli-entrypoint\.mjs["'];/u.test(source)) {
    findings.push({ code: "NODE_CLI_IDENTITY_IMPORT_MISSING", path });
  }
  if (!/if\s*\(isDirectNodeInvocation\(import\.meta\.url\)\)/u.test(source)) {
    findings.push({ code: "NODE_CLI_IDENTITY_CHECK_MISSING", path });
  }
}

async function inspectPackageCliIdentity(path, packages, findings) {
  const resolvedPath = await inspectRegularCoordinate(
    path,
    findings,
    "NODE_PACKAGE_CLI_ENTRYPOINT_MISSING",
  );
  if (!resolvedPath) return;
  const owner = [...packages.values()].find((entry) => isInside(entry.root, resolvedPath));
  if (!owner) {
    findings.push({ code: "NODE_PACKAGE_CLI_ENTRYPOINT_UNOWNED", path });
    return;
  }
  const source = await readFile(resolvedPath, "utf8");
  const match = /import\s+\{\s*isDirectNodeInvocation\s*\}\s+from\s+["']([^"']*node-cli-entrypoint\.mjs)["'];/u.exec(source);
  if (!match || !/if\s*\(isDirectNodeInvocation\(import\.meta\.url\)\)/u.test(source)) {
    findings.push({ code: "NODE_PACKAGE_CLI_IDENTITY_CHECK_MISSING", path });
    return;
  }
  try {
    const localHelper = await realpath(resolve(dirname(resolvedPath), match[1]));
    const expectedHelper = resolve(owner.root, "node-cli-entrypoint.mjs");
    if (localHelper !== expectedHelper) {
      findings.push({
        code: "NODE_PACKAGE_CLI_IDENTITY_HELPER",
        path,
        observed: repositoryPath(localHelper),
        expected: repositoryPath(expectedHelper),
      });
      return;
    }
    const [canonicalBytes, localBytes] = await Promise.all([
      readFile(portableCliIdentityPath),
      readFile(localHelper),
    ]);
    if (!canonicalBytes.equals(localBytes)) {
      findings.push({ code: "NODE_PACKAGE_CLI_IDENTITY_PARITY", path });
    }
  } catch (error) {
    findings.push({
      code: "NODE_PACKAGE_CLI_IDENTITY_UNRESOLVED",
      path,
      reason: error?.code ?? "package CLI identity helper cannot be resolved",
    });
  }
}

async function findFiles(directory, predicate) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        paths.push(...(await findFiles(resolve(directory, entry.name), predicate)));
      }
    } else if (entry.isFile() && predicate(entry.name)) {
      paths.push(resolve(directory, entry.name));
    }
  }
  return paths.sort((left, right) => left.localeCompare(right, "en"));
}

async function findTestEntrypoints(directory, findings) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) {
      findings.push({
        code: "NODE_TEST_PATH_SYMLINK",
        path: repositoryPath(path),
      });
    } else if (entry.isDirectory()) {
      paths.push(...(await findTestEntrypoints(path, findings)));
    } else if (entry.isFile() && /\.(?:spec|test)\.mjs$/u.test(entry.name)) {
      paths.push(path);
    }
  }
  return paths.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

async function inspectTestCoverage(inventory, findings) {
  const paths = [];
  for (const root of inventory.selfGuardedTestRoots) {
    const resolvedRoot = resolve(repositoryRoot, root);
    try {
      const status = await lstat(resolvedRoot);
      if (!status.isDirectory() || (await realpath(resolvedRoot)) !== resolvedRoot) {
        findings.push({ code: "NODE_TEST_ROOT_IDENTITY", path: root });
        continue;
      }
      paths.push(...(await findTestEntrypoints(resolvedRoot, findings)));
    } catch (error) {
      findings.push({
        code: "NODE_TEST_ROOT_MISSING",
        path: root,
        reason: error?.code ?? "test root cannot be inspected",
      });
    }
  }
  const repositoryPaths = new Set(sortedUnique(paths.map(repositoryPath)));
  for (const path of repositoryPaths) {
    await inspectGuardImport(path, findings);
  }
  return repositoryPaths;
}

async function discoverMjsCoordinates(directory, root, findings) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) {
      if (entry.name.endsWith(".mjs")) {
        findings.push({
          code: "NODE_GLOBAL_MJS_SYMLINK",
          path: relative(root, path).split(sep).join("/"),
        });
      }
    } else if (entry.isDirectory()) {
      paths.push(...(await discoverMjsCoordinates(path, root, findings)));
    } else if (entry.isFile() && entry.name.endsWith(".mjs")) {
      paths.push(relative(root, path).split(sep).join("/"));
    }
  }
  return sortedUnique(paths);
}

export async function inspectMjsClassification(root, classifiedPaths) {
  const resolvedRoot = resolve(root);
  const findings = [];
  const discovered = await discoverMjsCoordinates(resolvedRoot, resolvedRoot, findings);
  const classified = new Set(classifiedPaths);
  for (const path of discovered) {
    if (!classified.has(path)) {
      findings.push({ code: "NODE_GLOBAL_MJS_UNCLASSIFIED", path });
    }
  }
  return { discovered, findings };
}

async function inspectGlobalMjsCoverage(
  inventory,
  packages,
  guardedTests,
  packageTests,
  findings,
) {
  const explicit = new Set([
    ...inventory.diagnosticEntrypoints,
    ...inventory.supportModules,
    ...inventory.selfGuardedEntrypoints,
    ...guardedTests,
    ...inventory.packageGuardedEntrypoints,
    ...inventory.packageSupportModules,
    ...packageTests,
    ...[...packages.values()].map(({ admissionPath }) => repositoryPath(admissionPath)),
  ]);
  const globalInspection = await inspectMjsClassification(repositoryRoot, explicit);
  findings.push(...globalInspection.findings);
  return {
    discoveredCount: globalInspection.discovered.length,
    packageSupportCount: inventory.packageSupportModules.length,
  };
}

async function inspectPackageSupportModules(inventory, packages, findings) {
  for (const path of inventory.packageSupportModules) {
    const resolvedPath = await inspectRegularCoordinate(
      path,
      findings,
      "NODE_PACKAGE_SUPPORT_MISSING",
    );
    if (!resolvedPath) continue;
    if (![...packages.values()].some((entry) => isInside(entry.root, resolvedPath))) {
      findings.push({ code: "NODE_PACKAGE_SUPPORT_UNOWNED", path });
    }
  }
}

async function inspectPackageGuardedRoots(inventory, findings) {
  const manifests = new Map();
  const canonicalAdmission = await readFile(portableAdmissionPath);
  for (const root of inventory.packageGuardedRoots) {
    const resolvedRoot = resolve(repositoryRoot, root);
    try {
      const status = await lstat(resolvedRoot);
      if (!status.isDirectory() || (await realpath(resolvedRoot)) !== resolvedRoot) {
        findings.push({ code: "NODE_PACKAGE_ROOT_IDENTITY", path: root });
        continue;
      }
      const manifestPath = resolve(resolvedRoot, "package.json");
      const manifest = await readJson(manifestPath);
      if (!packageCarriesAdmission(manifest)) {
        findings.push({
          code: "NODE_PACKAGE_ADMISSION_DRIFT",
          path: repositoryPath(manifestPath),
        });
        continue;
      }
      const admissionPath = resolve(resolvedRoot, "node-runtime-admission.mjs");
      const resolvedAdmission = await inspectRegularCoordinate(
        repositoryPath(admissionPath),
        findings,
        "NODE_PACKAGE_ADMISSION_MISSING",
      );
      if (!resolvedAdmission) continue;
      if (!canonicalAdmission.equals(await readFile(resolvedAdmission))) {
        findings.push({
          code: "NODE_PACKAGE_ADMISSION_PARITY",
          path: repositoryPath(admissionPath),
        });
        continue;
      }
      manifests.set(manifestPath, {
        admissionPath: resolvedAdmission,
        root: resolvedRoot,
        manifest,
      });
      const sourceFiles = await findFiles(
        resolvedRoot,
        (name) => name.endsWith(".mjs") || name === "package.json",
      );
      for (const path of sourceFiles) {
        const source = await readFile(path, "utf8");
        if (/(?:^|\/)tools\/node-runtime-(?:guard|policy)\.mjs/u.test(source)) {
          findings.push({
            code: "NODE_PORTABLE_PACKAGE_ROOT_DEPENDENCY",
            path: repositoryPath(path),
          });
        }
      }
    } catch (error) {
      findings.push({
        code: "NODE_PACKAGE_ROOT_MISSING",
        path: root,
        reason: error?.code ?? "package root cannot be inspected",
      });
    }
  }
  return manifests;
}

async function inspectPackageGuardImport(path, packages, findings) {
  const resolvedPath = await inspectRegularCoordinate(
    path,
    findings,
    "NODE_PACKAGE_ENTRYPOINT_MISSING",
  );
  if (!resolvedPath) return;
  const owner = [...packages.values()].find((entry) => isInside(entry.root, resolvedPath));
  if (!owner) {
    findings.push({ code: "NODE_PACKAGE_ENTRYPOINT_UNOWNED", path });
    return;
  }
  const source = await readFile(resolvedPath, "utf8");
  const match = /^\s*import\s+["']([^"']*node-runtime-admission\.mjs)["'];/u.exec(source);
  if (!match) {
    findings.push({ code: "NODE_PACKAGE_ENTRYPOINT_GUARD_MISSING", path });
    return;
  }
  try {
    const observed = await realpath(resolve(dirname(resolvedPath), match[1]));
    if (observed !== owner.admissionPath) {
      findings.push({
        code: "NODE_PACKAGE_ENTRYPOINT_GUARD_IDENTITY",
        path,
        observed: repositoryPath(observed),
        expected: repositoryPath(owner.admissionPath),
      });
    }
  } catch (error) {
    findings.push({
      code: "NODE_PACKAGE_ENTRYPOINT_GUARD_UNRESOLVED",
      path,
      reason: error?.code ?? "package guard import cannot be resolved",
    });
  }
}

async function inspectPackageGuardedEntrypoints(inventory, packages, findings) {
  for (const path of inventory.packageGuardedEntrypoints) {
    await inspectPackageGuardImport(path, packages, findings);
  }
}

async function inspectPackageTestCoverage(packages, findings) {
  const paths = new Set();
  for (const entry of packages.values()) {
    for (const path of await findTestEntrypoints(entry.root, findings)) {
      paths.add(repositoryPath(path));
    }
  }
  for (const path of sortedUnique(paths)) {
    await inspectPackageGuardImport(path, packages, findings);
  }
  return paths;
}

async function inspectToolCoverage(inventory, findings) {
  const declared = new Set([
    ...inventory.diagnosticEntrypoints,
    ...inventory.supportModules,
    ...inventory.selfGuardedEntrypoints,
  ]);
  const tools = await findFiles(resolve(repositoryRoot, "tools"), (name) => name.endsWith(".mjs"));
  const toolPaths = new Set(tools.map(repositoryPath));
  for (const path of toolPaths) {
    if (!declared.has(path)) findings.push({ code: "NODE_TOOL_ENTRYPOINT_UNCLASSIFIED", path });
  }
  for (const path of declared) {
    if (!path.startsWith("tools/")) continue;
    if (!toolPaths.has(path)) {
      findings.push({ code: "NODE_TOOL_ENTRYPOINT_STALE", path });
    }
  }
}

async function inspectPreloadedScript(entry, findings) {
  const manifestPath = await inspectRegularCoordinate(
    entry.manifest,
    findings,
    "NODE_SCRIPT_MANIFEST_MISSING",
  );
  if (!manifestPath) return;
  const manifest = await readJson(manifestPath);
  const command = manifest.scripts?.[entry.script];
  if (typeof command !== "string") {
    findings.push({ code: "NODE_PRELOADED_SCRIPT_MISSING", ...entry });
    return;
  }
  const match = /(?:^|&&\s*)node\s+--import\s+(\S*node-runtime-guard\.mjs)(?:\s|$)/u.exec(command);
  if (!match) {
    findings.push({ code: "NODE_PRELOADED_SCRIPT_GUARD_MISSING", ...entry, command });
    return;
  }
  try {
    const importedIdentity = await realpath(resolve(dirname(manifestPath), match[1]));
    const guardIdentity = await realpath(guardPath);
    if (importedIdentity !== guardIdentity) {
      findings.push({
        code: "NODE_PRELOADED_SCRIPT_GUARD_IDENTITY",
        ...entry,
        observed: repositoryPath(importedIdentity),
      });
    }
  } catch (error) {
    findings.push({
      code: "NODE_PRELOADED_SCRIPT_GUARD_UNRESOLVED",
      ...entry,
      reason: error?.code ?? "guard preload cannot be resolved",
    });
  }
}

async function inspectPackageNodeCommands(inventory, packages, packageTests, findings) {
  const selfGuarded = new Set(inventory.selfGuardedEntrypoints);
  const diagnostic = new Set(inventory.diagnosticEntrypoints);
  const packageEntrypoints = new Set(inventory.packageGuardedEntrypoints);
  const manifests = await findFiles(repositoryRoot, (name) => name === "package.json");
  for (const manifestPath of manifests) {
    const manifest = await readJson(manifestPath);
    const admittedPackage = packages.get(manifestPath);
    for (const [script, command] of Object.entries(manifest.scripts ?? {})) {
      const parsed = splitShellSegments(command);
      if (!parsed.supported) {
        findings.push({
          code: "NODE_PACKAGE_COMMAND_TOPOLOGY",
          manifest: repositoryPath(manifestPath),
          script,
          command,
        });
        continue;
      }
      for (const segment of parsed.segments) {
        if (!segment.startsWith("node ")) {
          if (/(?:^|\s)node(?:\s|$)/u.test(segment)) {
            findings.push({
              code: "NODE_PACKAGE_COMMAND_UNCLASSIFIED",
              manifest: repositoryPath(manifestPath),
              script,
              invocation: segment,
            });
          }
          continue;
        }
        const invocation = segment.slice("node ".length).trim();
        const preload = /^--import\s+(\S*node-runtime-guard\.mjs)(?:\s|$)/u.exec(invocation);
        if (preload) {
          try {
            const importedIdentity = await realpath(resolve(dirname(manifestPath), preload[1]));
            if (importedIdentity !== (await realpath(guardPath))) {
              findings.push({
                code: "NODE_PACKAGE_COMMAND_GUARD_IDENTITY",
                manifest: repositoryPath(manifestPath),
                script,
                observed: repositoryPath(importedIdentity),
              });
            }
          } catch (error) {
            findings.push({
              code: "NODE_PACKAGE_COMMAND_GUARD_UNRESOLVED",
              manifest: repositoryPath(manifestPath),
              script,
              reason: error?.code ?? "guard preload cannot be resolved",
            });
          }
          continue;
        }
        const words = invocation.split(/\s+/u);
        const targets = (words[0] === "--test" ? words.slice(1) : words.slice(0, 1)).filter(
          (word) => word.endsWith(".mjs") || word.includes("*.mjs"),
        );
        if (targets.length === 0) {
          findings.push({
            code: "NODE_PACKAGE_COMMAND_UNCLASSIFIED",
            manifest: repositoryPath(manifestPath),
            script,
            invocation,
          });
          continue;
        }
        for (const target of targets) {
          const targetPath = repositoryPath(resolve(dirname(manifestPath), target));
          if (admittedPackage) {
            const resolvedTarget = resolve(dirname(manifestPath), target);
            if (!isInside(admittedPackage.root, resolvedTarget)) {
              findings.push({
                code: "NODE_PACKAGE_COMMAND_ESCAPES_ROOT",
                manifest: repositoryPath(manifestPath),
                script,
                target,
              });
            } else if (target.includes("*")) {
              if (!invocation.startsWith("--test ")) {
                findings.push({
                  code: "NODE_PACKAGE_COMMAND_GLOB_UNCLASSIFIED",
                  manifest: repositoryPath(manifestPath),
                  script,
                  target,
                });
              }
            } else if (!packageEntrypoints.has(targetPath) && !packageTests.has(targetPath)) {
              findings.push({
                code: "NODE_PACKAGE_ENTRYPOINT_UNDECLARED",
                manifest: repositoryPath(manifestPath),
                script,
                target: targetPath,
              });
            } else {
              await inspectPackageGuardImport(targetPath, packages, findings);
            }
            continue;
          }
          if (!selfGuarded.has(targetPath) && !diagnostic.has(targetPath)) {
            findings.push({
              code: "NODE_PACKAGE_COMMAND_GUARD_MISSING",
              manifest: repositoryPath(manifestPath),
              script,
              target: targetPath,
            });
          }
        }
      }
    }
  }
}

async function inspectPublicExerciseRoute(entry, rootManifest, findings) {
  await inspectRegularCoordinate(entry.path, findings, "NODE_PUBLIC_EXERCISE_MISSING");
  const manifestPath = await inspectRegularCoordinate(
    entry.manifest,
    findings,
    "NODE_PUBLIC_EXERCISE_MANIFEST_MISSING",
  );
  if (!manifestPath) return;
  const manifest = await readJson(manifestPath);
  const packageCommand = manifest.scripts?.[entry.packageScript];
  const absoluteEntrypoint = resolve(repositoryRoot, entry.path);
  const relativeEntrypoint = isInside(dirname(manifestPath), absoluteEntrypoint)
    ? relative(dirname(manifestPath), absoluteEntrypoint).split(sep).join("/")
    : null;
  const packageRoot = repositoryPath(dirname(manifestPath));
  const rootCommand = rootManifest.scripts?.[entry.rootScript];
  if (relativeEntrypoint === null || packageCommand !== entry.packageCommand) {
    findings.push({ code: "NODE_PUBLIC_EXERCISE_ROUTE_MISSING", ...entry });
  }
  if (
    rootCommand !== `npm --prefix ${packageRoot} run ${entry.packageScript}`
  ) {
    findings.push({ code: "NODE_PUBLIC_EXERCISE_ROOT_ROUTE_MISSING", ...entry });
  }
}

function shellCodeCommands(source) {
  const commands = [];
  let shellFence = false;
  for (const line of source.split("\n")) {
    const fence = /^\s*```([^\s`]*)/u.exec(line);
    if (fence) {
      if (shellFence || fence[1] === "") shellFence = false;
      else shellFence = new Set(["bash", "console", "sh", "shell", "zsh"]).has(fence[1]);
      continue;
    }
    if (shellFence && /^\s*(?:\$\s+)?node\s+/u.test(line)) commands.push(line.trim());
  }
  return commands;
}

async function inspectPublishedCommands(findings) {
  const markdown = await findFiles(repositoryRoot, (name) => name.endsWith(".md"));
  const accepted = new Set(["node tools/check-node-runtime.mjs"]);
  for (const path of markdown) {
    for (const command of shellCodeCommands(await readFile(path, "utf8"))) {
      const normalized = command.replace(/^\$\s+/u, "");
      if (!accepted.has(normalized)) {
        findings.push({ code: "NODE_PUBLIC_RAW_COMMAND", path: repositoryPath(path), command });
      }
    }
  }
}

export async function inspectNodeEntrypoints(root = repositoryRoot) {
  if (resolve(root) !== repositoryRoot) {
    throw new Error("Node entrypoint inspection currently binds the repository root.");
  }
  const inventory = await readJson(inventoryPath);
  const findings = [];
  inspectSortedUnique(inventory.diagnosticEntrypoints, "diagnosticEntrypoints", findings);
  inspectSortedUnique(inventory.supportModules, "supportModules", findings);
  inspectSortedUnique(inventory.selfGuardedTestRoots, "selfGuardedTestRoots", findings);
  inspectSortedUnique(inventory.selfGuardedEntrypoints, "selfGuardedEntrypoints", findings);
  inspectSortedUnique(inventory.identityGuardedEntrypoints, "identityGuardedEntrypoints", findings);
  inspectSortedUnique(inventory.eagerEntrypoints, "eagerEntrypoints", findings);
  inspectSortedUnique(inventory.packageGuardedRoots, "packageGuardedRoots", findings);
  inspectSortedUnique(
    inventory.packageGuardedEntrypoints,
    "packageGuardedEntrypoints",
    findings,
  );
  inspectSortedUnique(
    inventory.packageIdentityGuardedEntrypoints,
    "packageIdentityGuardedEntrypoints",
    findings,
  );
  inspectSortedUnique(inventory.packageSupportModules, "packageSupportModules", findings);

  const partitionedRootEntrypoints = sortedUnique([
    ...inventory.identityGuardedEntrypoints,
    ...inventory.eagerEntrypoints,
  ]);
  if (
    partitionedRootEntrypoints.length !== inventory.selfGuardedEntrypoints.length ||
    partitionedRootEntrypoints.some(
      (path, index) => path !== inventory.selfGuardedEntrypoints[index],
    )
  ) {
    findings.push({
      code: "NODE_ROOT_ENTRYPOINT_PARTITION",
      expected: inventory.selfGuardedEntrypoints,
      observed: partitionedRootEntrypoints,
    });
  }

  for (const path of inventory.diagnosticEntrypoints) {
    await inspectRegularCoordinate(path, findings, "NODE_DIAGNOSTIC_ENTRYPOINT_MISSING");
    await inspectRootCliIdentity(path, findings);
  }
  for (const path of inventory.supportModules) {
    await inspectRegularCoordinate(path, findings, "NODE_SUPPORT_MODULE_MISSING");
  }
  for (const path of inventory.selfGuardedEntrypoints) await inspectGuardImport(path, findings);
  for (const path of inventory.identityGuardedEntrypoints) {
    await inspectRootCliIdentity(path, findings);
  }
  const guardedTests = await inspectTestCoverage(inventory, findings);
  const packages = await inspectPackageGuardedRoots(inventory, findings);
  await inspectPackageSupportModules(inventory, packages, findings);
  await inspectPackageGuardedEntrypoints(inventory, packages, findings);
  for (const path of inventory.packageIdentityGuardedEntrypoints) {
    await inspectPackageCliIdentity(path, packages, findings);
  }
  const packageTests = await inspectPackageTestCoverage(packages, findings);
  const globalCoverage = await inspectGlobalMjsCoverage(
    inventory,
    packages,
    guardedTests,
    packageTests,
    findings,
  );
  for (const entry of inventory.preloadedScripts) await inspectPreloadedScript(entry, findings);

  const rootManifest = await readJson(resolve(repositoryRoot, "package.json"));
  for (const entry of inventory.publicExerciseRoutes) {
    await inspectPublicExerciseRoute(entry, rootManifest, findings);
  }
  await inspectToolCoverage(inventory, findings);
  await inspectPackageNodeCommands(inventory, packages, packageTests, findings);
  await inspectPublishedCommands(findings);

  return {
    packageCount: packages.size,
    discoveredMjsCount: globalCoverage.discoveredCount,
    packageSupportCount: globalCoverage.packageSupportCount,
    routeCheckCount:
      inventory.selfGuardedEntrypoints.length +
      guardedTests.size +
      inventory.packageGuardedEntrypoints.length +
      packageTests.size,
    findings,
  };
}

async function main() {
  const result = await inspectNodeEntrypoints();
  if (result.findings.length > 0) {
    console.error(JSON.stringify({ nodeEntrypointInspection: result }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(
      "Node entrypoint inspection: passed " +
        `(${result.routeCheckCount} guarded route checks; ` +
        `${result.packageCount} portable package boundaries; ` +
        `${result.discoveredMjsCount} classified .mjs files)`,
    );
  }
}

if (isDirectNodeInvocation(import.meta.url)) await main();
