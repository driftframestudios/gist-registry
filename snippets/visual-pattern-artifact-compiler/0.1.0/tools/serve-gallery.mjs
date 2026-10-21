import { createServer } from "node:http";
import { readFile, rm } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { compileArtifactFamily } from "../src/compiler.mjs";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputRoot = resolve(packageRoot, ".artifacts/browser-gallery");
const host = "127.0.0.1";
const port = 4181;

await rm(outputRoot, { recursive: true, force: true });
await compileArtifactFamily({
  contractPath: resolve(packageRoot, "source/pattern-contract.json"),
  svgPath: resolve(packageRoot, "source/pattern.svg"),
  galleryShellPath: resolve(packageRoot, "source/gallery-shell.html"),
  outputDir: outputRoot,
});

const mediaTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".webp", "image/webp"],
]);

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);
    const pathname = requestUrl.pathname === "/" ? "/gallery.html" : decodeURIComponent(requestUrl.pathname);
    const requestedPath = resolve(outputRoot, `.${pathname}`);
    if (requestedPath !== outputRoot && !requestedPath.startsWith(`${outputRoot}${sep}`)) {
      response.writeHead(400).end("invalid path");
      return;
    }
    const bytes = await readFile(requestedPath);
    response.writeHead(200, {
      "content-type": mediaTypes.get(extname(requestedPath)) ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(bytes);
  } catch (error) {
    response.writeHead(error?.code === "ENOENT" ? 404 : 500).end("unavailable");
  }
});

server.listen(port, host, () => {
  process.stdout.write(`visual artifact gallery listening at http://${host}:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
