import "./node-runtime-admission.mjs";

import {fileURLToPath} from "node:url";
import {dirname, relative, resolve} from "node:path";
import {defineConfig} from "vite";

const packageRoot = fileURLToPath(new URL(".", import.meta.url));

function stableSourcemapPath(relativeSourcePath, sourcemapPath) {
  return relative(
    packageRoot,
    resolve(dirname(sourcemapPath), relativeSourcePath)
  ).replaceAll("\\", "/");
}

export default defineConfig({
  base: "./",
  build: {
    emptyOutDir: true,
    outDir: "dist",
    rollupOptions: {
      input: [
        fileURLToPath(new URL("./receiver-entry.html", import.meta.url)),
        fileURLToPath(new URL("./source/native-receiver.html", import.meta.url)),
        fileURLToPath(new URL("./source/semantic-reading.html", import.meta.url))
      ],
      output: {
        sourcemapPathTransform: stableSourcemapPath
      }
    },
    sourcemap: true
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.mjs"]
  }
});
