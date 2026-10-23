import "../../node-runtime-admission.mjs";

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";

const require = createRequire(import.meta.url);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const galleryUrl = "http://127.0.0.1:4181/gallery.html";
const vectorUrl = "http://127.0.0.1:4181/source.svg";

async function packageCoordinate(packageName) {
  let directory = dirname(require.resolve(packageName));
  for (let index = 0; index < 8; index += 1) {
    try {
      const manifest = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
      if (manifest.name === packageName) return { directory, version: manifest.version };
    } catch {}
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`Unable to locate package metadata for ${packageName}.`);
}

async function browserCoordinate(browserName, browser) {
  const core = await packageCoordinate("playwright-core");
  const playwright = await packageCoordinate("@playwright/test");
  const catalog = JSON.parse(await readFile(resolve(core.directory, "browsers.json"), "utf8"));
  const revision = catalog.browsers.find(({ name }) => name === browserName)?.revision;
  return {
    coordinateKind: "browser_runtime",
    playwrightVersion: playwright.version,
    browserName,
    browserVersion: browser.version(),
    browserRevision: String(revision),
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    fontSet: "system-ui synthetic fixture",
    headless: true,
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("gallery preserves meaning, reflow, media modes, and SVG bounds", async ({ browser, browserName }) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 900 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
  });
  const page = await context.newPage();
  try {
    await page.route("**/*.webp", route => route.abort("blockedbyclient"));
    await page.goto(galleryUrl, { waitUntil: "load" });
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });

    await expect(page.getByRole("heading", { name: "Source-to-decision route", level: 1 })).toBeVisible();
    await expect(page.locator("main > p")).toBeVisible();
    await expect(page.locator("figcaption")).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.locator("figure img")).toHaveJSProperty("naturalWidth", 0);
    const narrowGeometry = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      rootFontSize: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
      overflowingElements: [...document.body.querySelectorAll("*")].flatMap(element => {
        const bounds = element.getBoundingClientRect();
        return bounds.left < -0.5
          || bounds.right > document.documentElement.clientWidth + 0.5
          // Browser table geometry rounds collapsed borders to whole CSS pixels.
          // A one-pixel delta is representation rounding; larger deltas identify
          // content that expands its own box and can widen the document.
          || element.scrollWidth > element.clientWidth + 1
          ? [{
              element: element.tagName.toLowerCase(),
              className: element.getAttribute("class") ?? "",
              clientWidth: element.clientWidth,
              scrollWidth: element.scrollWidth,
              left: bounds.left,
              right: bounds.right,
            }]
          : [];
      }),
    }));
    expect(narrowGeometry.rootFontSize).toBe(32);
    expect(narrowGeometry.overflowingElements).toEqual([]);
    expect(narrowGeometry.scrollWidth).toBeLessThanOrEqual(narrowGeometry.clientWidth);

    await page.emulateMedia({ forcedColors: "active", media: "screen" });
    await expect(page.getByRole("heading", { name: "Source-to-decision route", level: 1 })).toBeVisible();
    await expect(page.locator("figcaption")).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();

    await page.emulateMedia({ forcedColors: "none", media: "print" });
    await expect(page.getByRole("heading", { name: "Source-to-decision route", level: 1 })).toBeVisible();
    await expect(page.locator("figcaption")).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();

    await page.unroute("**/*.webp");
    await page.goto(vectorUrl, { waitUntil: "load" });
    const layerBounds = await page.evaluate(() => {
      const root = document.documentElement;
      const viewBox = root.viewBox.baseVal;
      return [...document.querySelectorAll("[data-layer]")].map(layer => {
        const box = layer.getBBox();
        return {
          layer: layer.getAttribute("data-layer"),
          x: box.x,
          y: box.y,
          right: box.x + box.width,
          bottom: box.y + box.height,
          viewBox: {
            x: viewBox.x,
            y: viewBox.y,
            right: viewBox.x + viewBox.width,
            bottom: viewBox.y + viewBox.height,
          },
        };
      });
    });
    expect(layerBounds.length).toBeGreaterThan(0);
    for (const bound of layerBounds) {
      expect(bound.x, `${bound.layer} left`).toBeGreaterThanOrEqual(bound.viewBox.x);
      expect(bound.y, `${bound.layer} top`).toBeGreaterThanOrEqual(bound.viewBox.y);
      expect(bound.right, `${bound.layer} right`).toBeLessThanOrEqual(bound.viewBox.right);
      expect(bound.bottom, `${bound.layer} bottom`).toBeLessThanOrEqual(bound.viewBox.bottom);
    }

    const manifestBytes = await readFile(resolve(packageRoot, ".artifacts/browser-gallery/manifest.json"));
    const receipt = {
      schemaVersion: "0.1.0",
      subject: {
        semanticId: "visual-pattern-artifact-compiler",
        version: "0.1.0",
        manifestSha256: sha256(manifestBytes),
      },
      environment: await browserCoordinate(browserName, browser),
      observations: {
        unavailableImageCompanion: "pass",
        narrow320AtText200Percent: "pass",
        forcedColors: "pass",
        print: "pass",
        svgDataLayerBounds: "pass",
      },
      standing: "candidate",
    };
    const receiptDirectory = resolve(packageRoot, ".artifacts/browser-observations");
    await mkdir(receiptDirectory, { recursive: true });
    await writeFile(resolve(receiptDirectory, `${browserName}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
  } finally {
    await context.close();
  }
});
