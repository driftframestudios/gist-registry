import assert from "node:assert/strict";
import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(modulePath), "..");
const ignoredDirectories = new Set([".artifacts", ".git", ".tools", "node_modules"]);
const externalScheme = /^[a-z][a-z0-9+.-]*:/iu;

function isInside(root, path) {
  return path === root || path.startsWith(root + sep);
}

async function readmePaths(root) {
  const paths = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && /^README(?:\.[^/]+)?\.md$/iu.test(entry.name))
        paths.push(path);
    }
  }
  await visit(root);
  return paths.sort();
}

function markdownTargets(source) {
  return [...source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)]
    .map(match => match[1].trim())
    .map(target => {
      if (target.startsWith("<") && target.endsWith(">")) return target.slice(1, -1);
      return target.replace(/\s+(?:"[^"]*"|'[^']*')$/u, "");
    });
}

function localPath(target) {
  if (!target || target.startsWith("#") || target.startsWith("/")) return null;
  if (externalScheme.test(target)) return null;
  const pathOnly = target.split("#", 1)[0].split("?", 1)[0];
  if (!pathOnly) return null;
  try {
    return decodeURIComponent(pathOnly);
  } catch {
    throw new Error("README link contains invalid percent encoding: " + target);
  }
}

export async function checkReadmeRoutes({ root = repositoryRoot } = {}) {
  const resolvedRoot = resolve(root);
  const readmes = await readmePaths(resolvedRoot);
  const broken = [];
  let linkCount = 0;

  for (const readme of readmes) {
    const source = await readFile(readme, "utf8");
    for (const target of markdownTargets(source)) {
      const path = localPath(target);
      if (path === null) continue;
      linkCount += 1;
      const candidate = resolve(dirname(readme), path);
      if (!isInside(resolvedRoot, candidate)) {
        broken.push(relative(resolvedRoot, readme) + " -> " + target + " (outside repository)");
        continue;
      }
      const entry = await lstat(candidate).catch(() => null);
      if (!entry)
        broken.push(relative(resolvedRoot, readme) + " -> " + target + " (missing)");
    }
  }
  assert.deepEqual(broken, [], "local README routes must resolve\n" + broken.join("\n"));

  const registry = JSON.parse(await readFile(resolve(resolvedRoot, "registry.json"), "utf8"));
  const familyIds = [...new Set(registry.entries.map(entry => entry.semanticId))].sort();
  const catalog = await readFile(resolve(resolvedRoot, "snippets/README.md"), "utf8");
  const rootReadme = await readFile(resolve(resolvedRoot, "README.md"), "utf8");
  const stateMarkers = [
    "## Current state",
    "| Registry acceptance |",
    "| Manifest maturity |",
    "| Continuation |",
    "| Publication |",
    "**Current coordinate:**",
    "## Next evidence-bearing route",
  ];

  for (const familyId of familyIds) {
    const route = familyId + "/README.md";
    assert.equal(
      catalog.split("(" + route + ")").length - 1,
      1,
      familyId + " must appear exactly once in snippets/README.md",
    );
    assert.ok(
      rootReadme.includes("snippets/" + route),
      familyId + " must have a root README route",
    );
    const familyReadme = await readFile(resolve(resolvedRoot, "snippets", route), "utf8");
    for (const marker of stateMarkers)
      assert.ok(familyReadme.includes(marker), familyId + " must include " + marker);
  }

  assert.ok(rootReadme.includes("[Artifact family catalog](snippets/README.md)"));
  assert.ok(rootReadme.includes("[`registry.json`](registry.json)"));
  assert.ok(rootReadme.includes("## Quickest proof"));

  return {
    readmeCount: readmes.length,
    localLinkCount: linkCount,
    familyCount: familyIds.length,
    exactVersionCount: registry.entries.length,
  };
}

async function main() {
  const result = await checkReadmeRoutes();
  console.log(
    "README routes: ok (" +
      result.readmeCount +
      " READMEs, " +
      result.localLinkCount +
      " local links, " +
      result.familyCount +
      " families, " +
      result.exactVersionCount +
      " exact versions)",
  );
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath)
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
