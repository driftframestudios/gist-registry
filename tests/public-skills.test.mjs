import assert from "node:assert/strict";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  loadPublicSkills,
  skillCatalogSchemaId,
  validatePublicSkillCatalog,
} from "../tools/public-skills.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const fixedSourceRevision = "1111111111111111111111111111111111111111";
const repositoryBlobBase =
  "https://github.com/driftframestudios/gist-registry/blob/" + fixedSourceRevision + "/";
const expectedPublicReady = [
  "architecture-convergence-vantages",
  "bounded-representation-admission",
  "contextual-jargon-scan",
  "controlled-context-comparison",
  "interruption-safe-resource-ownership",
  "longitudinal-observation-visualization",
  "omics-coordinate-and-measurement-views",
  "parity-bound-workload-measurement",
  "probe-bearing-exemplar-formation",
  "repository-collaboration-cycle",
  "scientific-figure-composition",
  "scientific-scale-and-transform-fidelity",
  "secret-boundary-inspection",
  "spatial-support-and-change-visualization",
  "transaction-boundary-evidence-mapping",
  "typed-error-recovery-contracts",
  "versioned-exemplar-successor",
  "visualization-question-routing"
];

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function expectedRepositoryUrl(repositoryPath) {
  return repositoryBlobBase + repositoryPath
    .split("/")
    .map(segment => encodeURIComponent(segment))
    .join("/");
}

async function withSkillFixture(action) {
  const root = await mkdtemp(join(tmpdir(), "gist-registry-skills-test-"));
  try {
    await cp(resolve(repositoryRoot, ".agents"), resolve(root, ".agents"), {
      recursive: true,
    });
    await cp(
      resolve(repositoryRoot, "schemas/skills"),
      resolve(root, "schemas/skills"),
      { recursive: true },
    );
    await cp(resolve(repositoryRoot, "README.md"), resolve(root, "README.md"));
    return await action(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("the repository selection classifies every skill and exposes only complete public-ready packages", async () => {
  const model = await loadPublicSkills({
    root: repositoryRoot,
    sourceSha: fixedSourceRevision,
  });

  assert.deepEqual(model.publicReady.map(skill => skill.name), expectedPublicReady);
  assert.deepEqual(model.catalog.skills.map(skill => skill.name), expectedPublicReady);
  assert.equal(model.catalog.$schema, skillCatalogSchemaId);
  assert.equal(model.catalog.sourceRevision, fixedSourceRevision);
  assert.equal(
    model.publicReady.flatMap(skill => skill.files).every(file => /^[a-f0-9]{64}$/u.test(file.sha256)),
    true,
  );
  for (const skill of model.catalog.skills)
    for (const binding of [skill.source, ...skill.dependencies]) {
      assert.equal(binding.repositoryUrl, expectedRepositoryUrl(binding.repositoryPath));
      assert.equal(binding.repositoryUrl.includes("/blob/main/"), false);
    }
  validatePublicSkillCatalog(model.schema, model.catalog);
});

test("registry checks run when skill sources or runbooks change", async () => {
  const workflow = await readFile(
    resolve(repositoryRoot, ".github/workflows/registry-checks.yml"),
    "utf8",
  );
  assert.match(workflow, /- "\.agents\/skills\/\*\*"/u);
  assert.match(workflow, /- "\.agents\/runbooks\/\*\*"/u);
});

test("an omitted or invented selection entry cannot change the repository skill inventory", async () => {
  await withSkillFixture(async root => {
    const selectionPath = resolve(root, ".agents/skills/publication-selection.json");
    const selection = await json(selectionPath);
    selection.skills.pop();
    await writeJson(selectionPath, selection);
    await assert.rejects(
      loadPublicSkills({ root, sourceSha: fixedSourceRevision }),
      /classify every repository skill exactly once/u,
    );

    selection.skills.push({
      name: "invented-skill",
      sourcePath: ".agents/skills/invented-skill/SKILL.md",
      publicationStanding: "public_ready",
      evidenceStanding: "instruction_only",
      dependencies: [],
      readinessNote: "Invented fixture.",
    });
    selection.skills.sort((left, right) => left.name.localeCompare(right.name));
    await writeJson(selectionPath, selection);
    await assert.rejects(
      loadPublicSkills({ root, sourceSha: fixedSourceRevision }),
      /classify every repository skill exactly once/u,
    );
  });
});

test("publication paths stay inside the repository and resolve to regular files", async () => {
  await withSkillFixture(async root => {
    const selectionPath = resolve(root, ".agents/skills/publication-selection.json");
    const selection = await json(selectionPath);
    selection.skills[0].dependencies = ["../outside.md"];
    await writeJson(selectionPath, selection);
    await assert.rejects(
      loadPublicSkills({ root, sourceSha: fixedSourceRevision }),
      /must be a safe relative path/u,
    );
  });

  await withSkillFixture(async root => {
    const reference = resolve(
      root,
      ".agents/skills/architecture-convergence-vantages/references/filesystem-state-transitions.md",
    );
    const outside = resolve(root, "outside.md");
    await writeFile(outside, "outside\n", "utf8");
    await rm(reference);
    await symlink(outside, reference);
    await assert.rejects(
      loadPublicSkills({ root, sourceSha: fixedSourceRevision }),
      /must be a regular file/u,
    );
  });

  await withSkillFixture(async root => {
    const references = resolve(
      root,
      ".agents/skills/architecture-convergence-vantages/references",
    );
    const inRootTarget = resolve(root, "owned-references");
    await rename(references, inRootTarget);
    await symlink(inRootTarget, references, "dir");
    await assert.rejects(
      loadPublicSkills({ root, sourceSha: fixedSourceRevision }),
      /must not traverse symbolic links/u,
    );
  });

  await withSkillFixture(async root => {
    const references = resolve(
      root,
      ".agents/skills/architecture-convergence-vantages/references",
    );
    const outside = await mkdtemp(join(tmpdir(), "gist-registry-skills-outside-"));
    try {
      await cp(references, outside, { recursive: true });
      await rm(references, { recursive: true });
      await symlink(outside, references, "dir");
      await assert.rejects(
        loadPublicSkills({ root, sourceSha: fixedSourceRevision }),
        /physical repository root/u,
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test("a public-ready package carries every relative Markdown dependency", async () => {
  await withSkillFixture(async root => {
    const skillPath = resolve(
      root,
      ".agents/skills/architecture-convergence-vantages/SKILL.md",
    );
    const source = await readFile(skillPath, "utf8");
    await writeFile(
      skillPath,
      source.replace(
        "references/filesystem-state-transitions.md",
        "references/unpublished-state-transitions.md",
      ),
      "utf8",
    );
    await assert.rejects(
      loadPublicSkills({ root, sourceSha: fixedSourceRevision }),
      /must include relative link target/u,
    );
  });
});

test("private locators and house annotations stop at the source-package boundary", async () => {
  for (const marker of [
    "https://www.notion.so/example-private-route",
    "::the_author::",
  ]) {
    await withSkillFixture(async root => {
      const skillPath = resolve(
        root,
        ".agents/skills/contextual-jargon-scan/SKILL.md",
      );
      const source = await readFile(skillPath, "utf8");
      await writeFile(skillPath, source + "\n" + marker + "\n", "utf8");
      await assert.rejects(
        loadPublicSkills({ root, sourceSha: fixedSourceRevision }),
        /must not carry/u,
      );
    });
  }
});

test("a public-ready source package uses ordinary Markdown structure", async () => {
  for (const breakTag of ["<br>", '<br class="scenario">']) {
    await withSkillFixture(async root => {
      const skillPath = resolve(
        root,
        ".agents/skills/contextual-jargon-scan/SKILL.md",
      );
      const source = await readFile(skillPath, "utf8");
      await writeFile(
        skillPath,
        source + "\nA visible break tag" + breakTag + "\n",
        "utf8",
      );
      await assert.rejects(
        loadPublicSkills({ root, sourceSha: fixedSourceRevision }),
        /must use ordinary Markdown structure instead of HTML break tags/u,
      );
    });
  }
});

test("a similarly named custom element remains valid source text", async () => {
  await withSkillFixture(async root => {
    const skillPath = resolve(
      root,
      ".agents/skills/contextual-jargon-scan/SKILL.md",
    );
    const source = await readFile(skillPath, "utf8");
    await writeFile(
      skillPath,
      source + "\n<br-example>Named example</br-example>\n",
      "utf8",
    );
    await loadPublicSkills({ root, sourceSha: fixedSourceRevision });
  });
});

test("a newly withheld skill stays outside the catalog and public source packages", async () => {
  await withSkillFixture(async root => {
    const name = "private-calibration-recipe";
    const sourcePath = `.agents/skills/${name}/SKILL.md`;
    await mkdir(resolve(root, `.agents/skills/${name}`));
    await writeFile(resolve(root, sourcePath), [
      "---", `name: ${name}`,
      "description: Calibrates a private fixture. Applies during this boundary test.",
      "---", "", "# Private calibration recipe", "",
    ].join("\n"));
    const selectionPath = resolve(root, ".agents/skills/publication-selection.json");
    const selection = await json(selectionPath);
    selection.skills.push({ name, sourcePath, publicationStanding: "public_possible",
      evidenceStanding: "instruction_only", dependencies: [], readinessNote: "Private fixture." });
    selection.skills.sort((left, right) => left.name.localeCompare(right.name));
    await writeJson(selectionPath, selection);
    const model = await loadPublicSkills({ root, sourceSha: fixedSourceRevision });
    assert.deepEqual(model.withheldNames, [name]);
    assert.deepEqual(model.catalog.skills.map(skill => skill.name), expectedPublicReady);
    assert.equal(JSON.stringify(model.catalog).includes(name), false);

    const skillPath = resolve(root, ".agents/skills/contextual-jargon-scan/SKILL.md");
    const source = await readFile(skillPath, "utf8");
    await writeFile(skillPath, source + "\nPrivate calibration recipe\n", "utf8");
    await assert.rejects(
      loadPublicSkills({ root, sourceSha: fixedSourceRevision }),
      /must not name a withheld skill or title/u,
    );
  });
});

test("the typed exchange projection rejects an unrecognized publication standing", async () => {
  const model = await loadPublicSkills({
    root: repositoryRoot,
    sourceSha: fixedSourceRevision,
  });
  const changed = structuredClone(model.catalog);
  changed.skills[0].publicationStanding = "draft";
  assert.throws(
    () => validatePublicSkillCatalog(model.schema, changed),
    /must satisfy its schema/u,
  );
});
