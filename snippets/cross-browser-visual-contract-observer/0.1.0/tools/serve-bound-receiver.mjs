import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { packageRoot } from "./paths.mjs";

const host = "127.0.0.1";
const port = 4179;
const receiverRoot = resolve(packageRoot, "../../react-aria-visual-contract-receiver/0.1.0");
const distributionRoot = resolve(receiverRoot, "dist");
const build = spawnSync("npm", ["run", "build"], {
  cwd: receiverRoot,
  encoding: "utf8",
  stdio: "inherit",
});
if (build.error) throw build.error;
if (build.status !== 0) throw new Error(`bound receiver build exited ${build.status}`);

const mediaTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
]);

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);
    const pathname = requestUrl.pathname === "/" ? "/receiver-entry.html" : decodeURIComponent(requestUrl.pathname);
    const path = resolve(distributionRoot, `.${pathname}`);
    if (path !== distributionRoot && !path.startsWith(`${distributionRoot}${sep}`)) {
      response.writeHead(400).end("invalid path");
      return;
    }
    const bytes = await readFile(path);
    response.writeHead(200, {
      "content-type": mediaTypes.get(extname(path)) ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(bytes);
  } catch (error) {
    response.writeHead(error?.code === "ENOENT" ? 404 : 500).end("not found");
  }
});

server.listen(port, host, () => {
  process.stdout.write(`bound receiver listening at http://${host}:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
