import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, posix, resolve, sep } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export const skillSelectionPath = ".agents/skills/publication-selection.json";
export const skillSchemaSourcePath =
  "schemas/skills/0.1.0/public-skill-catalog.schema.json";
export const skillCatalogSchemaId =
  "https://kindlight.io/schemas/gist-registry/skills/0.1.0/public-skill-catalog.schema.json";

const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const sourceRevisionPattern = /^[a-f0-9]{40}$/u;
const safeRelativePathPattern = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\).+$/u;
const localMarkdownLinkPattern = /\[[^\]]*\]\(([^)]+)\)/gu;
const htmlBreakPattern = /<br(?=[\s/>])[^>]*>/iu;
const privateLocatorPatterns = [
  { label: "private Notion locator", pattern: /https?:\/\/(?:www\.)?notion\.(?:so|site)\b/iu },
  { label: "user-specific filesystem path", pattern: /(?:file:\/\/)?\/Users\//u },
  { label: "house annotation", pattern: /::[a-z][^:\n]{0,80}::/iu },
  { label: "house database marker", pattern: /~(?:loamthreads|loam_threads)\b/iu },
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isInside(owner, candidate) {
  const resolvedOwner = resolve(owner);
  const resolvedCandidate = resolve(candidate);
  return (
    resolvedCandidate === resolvedOwner ||
    resolvedCandidate.startsWith(resolvedOwner + sep)
  );
}

function requireString(value, label) {
  assert.equal(typeof value, "string", label + " must be a string");
  assert.ok(value.trim(), label + " must not be empty");
}

export function requireSkillRelativePath(path, label) {
  requireString(path, label);
  assert.match(path, safeRelativePathPattern, label + " must be a safe relative path");
  assert.equal(path.includes("//"), false, label + " must use normalized separators");
  return path;
}

async function requireRegularFile(root, relativePath, label) {
  requireSkillRelativePath(relativePath, label);
  const path = resolve(root, relativePath);
  assert.ok(isInside(root, path), label + " must stay inside the repository root");
  const entry = await lstat(path).catch(() => null);
  assert.ok(entry, label + " is unavailable");
  assert.equal(entry.isSymbolicLink(), false, label + " must be a regular file");
  assert.ok(entry.isFile(), label + " must be a regular file");
  const [physicalRoot, physicalPath] = await Promise.all([realpath(root), realpath(path)]);
  assert.ok(
    isInside(physicalRoot, physicalPath),
    label + " must stay inside the physical repository root",
  );
  assert.equal(
    physicalPath,
    resolve(physicalRoot, relativePath),
    label + " must not traverse symbolic links",
  );
  return path;
}

async function readRegularFile(root, relativePath, label) {
  return readFile(await requireRegularFile(root, relativePath, label));
}

async function readJson(root, relativePath, label) {
  const bytes = await readRegularFile(root, relativePath, label);
  try {
    return { bytes, value: JSON.parse(bytes.toString("utf8")) };
  } catch (error) {
    throw new Error(label + " must be valid JSON: " + error.message);
  }
}

function parseSkillSource(bytes, expectedName, label) {
  const source = bytes.toString("utf8");
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---\n/u);
  assert.ok(frontmatter, label + " must begin with YAML frontmatter");
  const metadata = new Map();
  for (const line of frontmatter[1].split("\n")) {
    const separator = line.indexOf(":");
    assert.ok(separator > 0, label + " frontmatter must use key: value lines");
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    assert.equal(metadata.has(key), false, label + " frontmatter repeats " + key);
    metadata.set(key, value);
  }
  assert.deepEqual(
    [...metadata.keys()].sort(compareText),
    ["description", "name"],
    label + " frontmatter must carry exactly name and description",
  );
  assert.equal(metadata.get("name"), expectedName, label + " name must match selection");
  requireString(metadata.get("description"), label + " description");
  const heading = source.match(/^# (.+)$/mu);
  assert.ok(heading, label + " must carry one level-one title");
  return {
    description: metadata.get("description"),
    source,
    title: heading[1].trim(),
  };
}

function assertPublicTextSafe(source, label) {
  assert.equal(
    htmlBreakPattern.test(source),
    false,
    label + " must use ordinary Markdown structure instead of HTML break tags",
  );
  for (const candidate of privateLocatorPatterns)
    assert.equal(
      candidate.pattern.test(source),
      false,
      label + " must not carry a " + candidate.label,
    );
}

function markdownLocalTargets(source, sourcePath) {
  const targets = [];
  for (const match of source.matchAll(localMarkdownLinkPattern)) {
    let target = match[1].trim();
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    target = target.split(/\s+["']/u, 1)[0];
    if (
      !target ||
      target.startsWith("#") ||
      target.startsWith("/") ||
      /^[a-z][a-z0-9+.-]*:/iu.test(target)
    ) continue;
    const withoutFragment = target.split("#", 1)[0].split("?", 1)[0];
    if (!withoutFragment) continue;
    let decoded;
    try {
      decoded = decodeURIComponent(withoutFragment);
    } catch {
      throw new Error(sourcePath + " carries an invalid encoded relative link: " + target);
    }
    const resolved = posix.normalize(posix.join(posix.dirname(sourcePath), decoded));
    requireSkillRelativePath(resolved, sourcePath + " relative link");
    targets.push(resolved);
  }
  return targets;
}

function validateSchema(schema, catalog) {
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
  addFormats(ajv, { mode: "full" });
  assert.ok(ajv.validateSchema(schema), "public skill schema must be valid");
  const validate = ajv.compile(schema);
  assert.ok(
    validate(catalog),
    "public skill catalog must satisfy its schema: " +
      (validate.errors ?? [])
        .map(error => (error.instancePath || "/") + " " + error.message)
        .join("; "),
  );
}

function repositoryBlobUrl(sourceSha, sourcePath) {
  const encodedPath = sourcePath
    .split("/")
    .map(segment => encodeURIComponent(segment))
    .join("/");
  return (
    "https://github.com/driftframestudios/gist-registry/blob/" +
    sourceSha +
    "/" +
    encodedPath
  );
}

function pathBinding(sourceSha, file) {
  return {
    repositoryPath: file.repositoryPath,
    publishedPath: "/" + file.publishedPath,
    sha256: file.sha256,
    repositoryUrl: repositoryBlobUrl(sourceSha, file.repositoryPath),
  };
}

async function repositorySkillNames(root) {
  const skillsRoot = resolve(root, ".agents/skills");
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const names = [];
  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    assert.equal(entry.isSymbolicLink(), false, entry.name + " skill entry must not be a symlink");
    if (!entry.isDirectory()) continue;
    if (!skillNamePattern.test(entry.name)) continue;
    await requireRegularFile(
      root,
      ".agents/skills/" + entry.name + "/SKILL.md",
      entry.name + " SKILL.md",
    );
    names.push(entry.name);
  }
  return names;
}

export async function loadPublicSkills({ root, sourceSha } = {}) {
  assert.match(sourceSha, sourceRevisionPattern, "skill source revision must be a full Git SHA");
  const selection = await readJson(root, skillSelectionPath, skillSelectionPath);
  const schemaSource = await readJson(root, skillSchemaSourcePath, skillSchemaSourcePath);
  const value = selection.value;

  assert.equal(value?.schemaVersion, "1", "skill publication selection version must be 1");
  assert.equal(value?.repository, "gist-registry", "skill selection must name gist-registry");
  assert.equal(value?.schemaRef, skillSchemaSourcePath, "skill selection must name its schema source");
  assert.equal(value?.projectionBase, "https://kindlight.io/skills/", "skill projection base must be canonical");
  assert.ok(Array.isArray(value?.skills), "skill selection must carry skills");
  assert.equal(schemaSource.value.$id, skillCatalogSchemaId, "skill schema identity must be canonical");

  const expectedNames = await repositorySkillNames(root);
  const selectedNames = value.skills.map(entry => entry?.name);
  assert.deepEqual(selectedNames, [...selectedNames].sort(compareText), "skill selection must be name-sorted");
  assert.deepEqual(selectedNames, expectedNames, "skill selection must classify every repository skill exactly once");

  const ready = [];
  const withheldNames = [];
  const withheldTerms = [];
  for (const entry of value.skills) {
    assert.ok(entry && typeof entry === "object" && !Array.isArray(entry), "each skill selection must be an object");
    assert.match(entry.name, skillNamePattern, "skill name must be path-safe");
    assert.equal(
      entry.sourcePath,
      ".agents/skills/" + entry.name + "/SKILL.md",
      entry.name + " source path must be canonical",
    );
    assert.ok(
      entry.publicationStanding === "public_ready" ||
        entry.publicationStanding === "public_possible",
      entry.name + " publication standing must be recognized",
    );
    assert.ok(
      entry.evidenceStanding === "instruction_only" || entry.evidenceStanding === "exercised",
      entry.name + " evidence standing must be recognized",
    );
    assert.ok(Array.isArray(entry.dependencies), entry.name + " dependencies must be an array");
    assert.deepEqual(
      entry.dependencies,
      [...entry.dependencies].sort(compareText),
      entry.name + " dependencies must be path-sorted",
    );
    assert.equal(new Set(entry.dependencies).size, entry.dependencies.length, entry.name + " dependencies must be unique");
    requireString(entry.readinessNote, entry.name + " readiness note");

    const sourceBytes = await readRegularFile(root, entry.sourcePath, entry.name + " source");
    for (const dependency of entry.dependencies)
      await requireRegularFile(root, dependency, entry.name + " dependency " + dependency);

    const parsed = parseSkillSource(sourceBytes, entry.name, entry.sourcePath);
    if (entry.publicationStanding === "public_possible") {
      withheldNames.push(entry.name);
      withheldTerms.push(
        entry.name,
        entry.name.replaceAll("-", " "),
        parsed.title,
        parsed.title.replaceAll("-", " "),
      );
      continue;
    }

    const files = [entry.sourcePath, ...entry.dependencies];
    const fileModels = [];
    for (const repositoryPath of files) {
      const bytes = await readRegularFile(root, repositoryPath, entry.name + " source package");
      const source = bytes.toString("utf8");
      assertPublicTextSafe(source, repositoryPath);
      fileModels.push({
        repositoryPath,
        publishedPath: "skills/source/" + repositoryPath,
        bytes,
        sha256: sha256(bytes),
      });
    }
    const packagePaths = new Set(files);
    for (const file of fileModels)
      for (const target of markdownLocalTargets(file.bytes.toString("utf8"), file.repositoryPath))
        assert.ok(
          packagePaths.has(target),
          entry.name + " source package must include relative link target " + target,
        );
    ready.push({ ...entry, ...parsed, files: fileModels });
  }

  for (const skill of ready)
    for (const withheldTerm of withheldTerms)
      for (const file of skill.files)
        assert.equal(
          file.bytes.toString("utf8").toLocaleLowerCase("en-US").includes(
            withheldTerm.toLocaleLowerCase("en-US"),
          ),
          false,
          file.repositoryPath + " must not name a withheld skill or title",
        );

  const skills = ready.map(skill => ({
    name: skill.name,
    title: skill.title,
    description: skill.description,
    publicationStanding: "public_ready",
    evidenceStanding: skill.evidenceStanding,
    canonicalUrl: "https://kindlight.io/skills/" + skill.name + "/",
    source: pathBinding(sourceSha, skill.files[0]),
    dependencies: skill.files.slice(1).map(file => pathBinding(sourceSha, file)),
  }));
  const catalog = {
    schemaVersion: "0.1.0",
    $schema: skillCatalogSchemaId,
    repository: "gist-registry",
    canonicalUrl: "https://kindlight.io/skills/index.json",
    sourceRevision: sourceSha,
    publicationScope:
      "Every listed entry has public-ready standing and an exact source package in this projection.",
    skills,
  };
  validateSchema(schemaSource.value, catalog);

  return {
    catalog,
    catalogBytes: Buffer.from(JSON.stringify(catalog, null, 2) + "\n", "utf8"),
    publicReady: ready,
    selectionBytes: selection.bytes,
    schema: schemaSource.value,
    schemaBytes: schemaSource.bytes,
    withheldNames,
    withheldTerms: [...new Set(withheldTerms)],
  };
}

export function publicSkillInputPaths(model) {
  return [
    skillSelectionPath,
    skillSchemaSourcePath,
    ...model.publicReady.flatMap(skill => skill.files.map(file => file.repositoryPath)),
  ];
}

export function validatePublicSkillCatalog(schema, catalog) {
  validateSchema(schema, catalog);
}
