import "../tools/node-runtime-guard.mjs";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  defaultProjectionRoot,
  observePages,
  projectionManifestFile,
} from "../tools/observe-pages.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalPath(path) {
  if (path === "index.html") return "/";
  if (path.endsWith("/index.html")) return "/" + path.replace(/index\.html$/u, "");
  return "/" + path;
}

function createResponse({
  status = 200,
  body = Buffer.alloc(0),
  url = "https://kindlight.io/",
  contentType = "text/plain",
  cors = "*",
}) {
  return {
    status,
    headers: {
      get(name) {
        if (name.toLowerCase() === "content-type") return contentType;
        if (name.toLowerCase() === "access-control-allow-origin") return cors;
        return null;
      },
    },
    url,
    async arrayBuffer() {
      return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
    },
  };
}

function createFetcher(routes) {
  return async function fetcher(url) {
    const key = new URL(url).pathname;
    if (!Object.hasOwn(routes, key)) {
      throw new Error(`unexpected request to ${url}`);
    }
    return routes[key]();
  };
}

async function withFixture(action) {
  const root = await mkdtemp(join(tmpdir(), "gist-registry-pages-observer-"));
  try {
    const projectionRoot = resolve(root, defaultProjectionRoot);
    await mkdir(projectionRoot, { recursive: true });
    const recordPath = "observations/delivery/records/schema-registry-artifact-0.1.0-20260830t052206z.json";
    const indexPath = "observations/delivery/index.json";
    const files = {
      "index.html": Buffer.from("<!doctype html><title>Gist Registry</title>", "utf8"),
      [indexPath]: Buffer.from("{\"index\":true}", "utf8"),
      [recordPath]: Buffer.from("{\"record\":true}", "utf8"),
      ".nojekyll": Buffer.from("", "utf8"),
    };

    for (const [path, bytes] of Object.entries(files))
      await writeFile(resolve(projectionRoot, path), bytes, { encoding: "utf8" }).catch(async error => {
        if (error.code === "ENOENT") {
          await mkdir(dirname(resolve(projectionRoot, path)), { recursive: true });
          await writeFile(resolve(projectionRoot, path), bytes);
        } else {
          throw error;
        }
      });

    const manifest = {
      projectionFormatVersion: "0.1.0",
      projectionOwner: "gist-registry-pages-builder",
      canonicalOrigin: "https://kindlight.io",
      sourceRevision: "0000000000000000000000000000000000000000",
      sourceStanding: "accepted_revision",
      fileScope: "Every projection file except projection-manifest.json itself.",
      files: Object.entries(files).map(([path, bytes]) => ({
        path,
        bytes: bytes.length,
        sha256: sha256(bytes),
      })),
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");
    const manifestPath = resolve(projectionRoot, projectionManifestFile);
    await writeFile(manifestPath, manifestBytes);
    await action({
      root,
      projectionRoot: defaultProjectionRoot,
      manifest,
      manifestBytes,
      manifestPath,
      recordPath,
      indexPath,
      files,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("the Pages observer confirms live/public parity when all file projections match", async () => {
  await withFixture(async ({ root, projectionRoot, manifest, manifestBytes, recordPath, indexPath, files }) => {
    const canonicalManifest = manifest.canonicalOrigin;
    const fetcher = createFetcher({
      "/": () =>
        createResponse({
          body: files["index.html"],
          url: `${canonicalManifest}/`,
          contentType: "text/html; charset=UTF-8",
        }),
      "/observations/delivery/index.json": () =>
        createResponse({
          body: files[indexPath],
          url: `${canonicalManifest}/${indexPath}`,
          contentType: "application/json; charset=utf-8",
        }),
      "/observations/delivery/records/schema-registry-artifact-0.1.0-20260830t052206z.json": () =>
        createResponse({
          body: files[recordPath],
          url: `${canonicalManifest}/${recordPath}`,
          contentType: "application/json",
        }),
      "/projection-manifest.json": () =>
        createResponse({
          body: manifestBytes,
          url: `${canonicalManifest}/projection-manifest.json`,
          contentType: "application/json; charset=utf-8",
        }),
    });
    const result = await observePages({ root, projectionRoot, fetcher });
    assert.equal(result.result, "all_returned_bytes_match_projection");
    assert.equal(result.sourceRevision, manifest.sourceRevision);
    assert.equal(result.projectionOwner, "gist-registry-pages-builder");
    assert.equal(result.fileCount, 4);
    assert.equal(result.contentTypeCounts["text/html; charset=utf-8"], 1);
    assert.equal(result.contentTypeCounts["application/json; charset=utf-8"], 2);
    assert.equal(result.contentTypeCounts["application/json"], 1);
    assert.equal(result.projectionManifest.path, projectionManifestFile);
    assert.equal(result.projectionManifest.cors, "*");
    assert.equal(result.durableDeliveryRecords.length, 1);
    assert.equal(result.durableDeliveryRecords[0].path, recordPath);
    assert.equal(result.durableDeliveryRecords[0].cors, "*");
  });
});

test("the Pages observer rejects a non-200 response", async () => {
  await withFixture(async ({ root, projectionRoot, manifest, manifestBytes, recordPath, indexPath, files }) => {
    const canonicalManifest = manifest.canonicalOrigin;
    const fetcher = createFetcher({
      "/": () =>
        createResponse({
          body: files["index.html"],
          url: `${canonicalManifest}/`,
          contentType: "text/html; charset=UTF-8",
        }),
      "/observations/delivery/index.json": () =>
        createResponse({
          body: files[indexPath],
          url: `${canonicalManifest}/${indexPath}`,
          contentType: "application/json; charset=utf-8",
        }),
      "/observations/delivery/records/schema-registry-artifact-0.1.0-20260830t052206z.json": () =>
        createResponse({
          status: 404,
          body: files[recordPath],
          url: `${canonicalManifest}/${recordPath}`,
          contentType: "application/json",
        }),
      "/projection-manifest.json": () =>
        createResponse({
          body: manifestBytes,
          url: `${canonicalManifest}/projection-manifest.json`,
          contentType: "application/json; charset=utf-8",
        }),
    });
    await assert.rejects(
      observePages({ root, projectionRoot, fetcher }),
      /must return HTTP 200/u,
    );
  });
});

test("the Pages observer rejects byte-count or SHA mismatch", async () => {
  await withFixture(async ({ root, projectionRoot, manifest, manifestBytes, recordPath, indexPath, files }) => {
    const canonicalManifest = manifest.canonicalOrigin;
    const fetcher = createFetcher({
      "/": () =>
        createResponse({
          body: files["index.html"],
          url: `${canonicalManifest}/`,
          contentType: "text/html; charset=UTF-8",
        }),
      "/observations/delivery/index.json": () =>
        createResponse({
          body: Buffer.from("{\"index\":false}", "utf8"),
          url: `${canonicalManifest}/${indexPath}`,
          contentType: "application/json; charset=utf-8",
        }),
      "/observations/delivery/records/schema-registry-artifact-0.1.0-20260830t052206z.json": () =>
        createResponse({
          body: files[recordPath],
          url: `${canonicalManifest}/${recordPath}`,
          contentType: "application/json",
        }),
      "/projection-manifest.json": () =>
        createResponse({
          body: manifestBytes,
          url: `${canonicalManifest}/projection-manifest.json`,
          contentType: "application/json; charset=utf-8",
        }),
    });
    await assert.rejects(
      observePages({ root, projectionRoot, fetcher }),
      /must have expected byte count|must have expected SHA-256/u,
    );
  });
});

test("the Pages observer rejects a canonical final URL mismatch", async () => {
  await withFixture(async ({ root, projectionRoot, manifest, manifestBytes, recordPath, files }) => {
    const canonicalManifest = manifest.canonicalOrigin;
    const fetcher = createFetcher({
      "/": () =>
        createResponse({
          body: files["index.html"],
          url: `${canonicalManifest}/?view=raw`,
          contentType: "text/html; charset=UTF-8",
        }),
      "/observations/delivery/index.json": () =>
        createResponse({
          body: files["observations/delivery/index.json"],
          url: `${canonicalManifest}/observations/delivery/index.json`,
          contentType: "application/json; charset=utf-8",
        }),
      "/observations/delivery/records/schema-registry-artifact-0.1.0-20260830t052206z.json": () =>
        createResponse({
          body: files[recordPath],
          url: `${canonicalManifest}/${recordPath}`,
          contentType: "application/json",
        }),
      "/projection-manifest.json": () =>
        createResponse({
          body: manifestBytes,
          url: `${canonicalManifest}/projection-manifest.json`,
          contentType: "application/json; charset=utf-8",
        }),
    });
    await assert.rejects(
      observePages({ root, projectionRoot, fetcher }),
      /response URL must be query-free|must preserve its exact canonical URL/u,
    );
  });
});

test("the Pages observer rejects an interior path traversal before requesting it", async () => {
  await withFixture(async ({ root, projectionRoot, manifest, manifestPath }) => {
    manifest.files[0].path = "nested/../index.html";
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    await assert.rejects(
      observePages({
        root,
        projectionRoot,
        fetcher: async url => {
          throw new Error(`observer requested an unsafe path: ${url}`);
        },
      }),
      /must contain complete contained path segments/u,
    );
  });
});

test("the package exposes the Pages observer as a manual command", async () => {
  assert.equal((await readFile(resolve(repositoryRoot, "package.json"), "utf8")).includes("observe-pages"), true);
});
