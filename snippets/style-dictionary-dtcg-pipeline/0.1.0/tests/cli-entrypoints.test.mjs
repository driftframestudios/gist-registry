import "../node-runtime-admission.mjs";

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const packageRoot = resolve(import.meta.dirname, "..");
const tools = [
  "build-candidates.mjs",
  "make-manifest.mjs",
  "validate-source.mjs",
  "verify-generated.mjs",
];

test("every command tool binds direct execution through the package-local identity helper", async () => {
  for (const tool of tools) {
    const source = await readFile(resolve(packageRoot, "tools", tool), "utf8");
    assert.match(source, /from "\.\.\/node-cli-entrypoint\.mjs";/u, tool);
    assert.match(source, /if \(isDirectNodeInvocation\(import\.meta\.url\)\)/u, tool);
  }
});

test("a symbolic-link route runs validation and every linked tool retains runtime admission", async (context) => {
  if (process.platform === "win32") return;
  const root = await mkdtemp(join(tmpdir(), "style-dictionary-cli-links-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const override = join(root, "override-node-version.mjs");
  await writeFile(
    override,
    'Object.defineProperty(process, "version", { value: "v26.11.0" });\n',
  );

  const directValidation = spawnSync(
    process.execPath,
    [resolve(packageRoot, "tools/validate-source.mjs")],
    { cwd: packageRoot, encoding: "utf8" },
  );
  assert.equal(directValidation.status, 0, directValidation.stderr);
  assert.match(directValidation.stdout, /"formatProfile"/u);

  for (const tool of tools) {
    const link = join(root, tool);
    await symlink(resolve(packageRoot, "tools", tool), link);
    if (tool === "validate-source.mjs") {
      const acceptedLink = spawnSync(process.execPath, [link], {
        cwd: packageRoot,
        encoding: "utf8",
      });
      assert.equal(acceptedLink.status, 0, acceptedLink.stderr);
      assert.equal(acceptedLink.stdout, directValidation.stdout);
    }
    const staleLink = spawnSync(process.execPath, ["--import", override, link], {
      cwd: packageRoot,
      encoding: "utf8",
    });
    assert.notEqual(staleLink.status, 0, tool);
    assert.match(staleLink.stderr, /NODE_SECURITY_FLOOR/u, tool);
  }
});
