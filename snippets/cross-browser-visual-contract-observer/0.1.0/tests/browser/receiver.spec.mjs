import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test, expect } from "@playwright/test";
import { applyScenario, environmentCoordinate, formBrowserReceipt, observeTarget } from "../../src/browser-observer.mjs";
import { selectTier, validateInventory, validateMatrix } from "../../src/contracts.mjs";
import { publishReceipt } from "../../src/publication.mjs";
import { packageRoot } from "../../tools/paths.mjs";

const inventory = JSON.parse(readFileSync(resolve(packageRoot, "inventory/decisions.json"), "utf8"));
const matrix = JSON.parse(readFileSync(resolve(packageRoot, "inventory/matrix.json"), "utf8"));
const coordinates = JSON.parse(readFileSync(resolve(packageRoot, "source/coordinates.json"), "utf8"));
const receiverPath = resolve(packageRoot, "source/receiver.html");
const receiverBytes = readFileSync(receiverPath);
const receiverUrl = pathToFileURL(receiverPath).href;
const boundReceiverRoot = resolve(packageRoot, "../../react-aria-visual-contract-receiver/0.1.0/dist");
const boundReceiverUrl = "http://127.0.0.1:4179/receiver-entry.html";
const subjectArtifact = {
  path: "artifacts/receiver.html",
  sha256: createHash("sha256").update(receiverBytes).digest("hex"),
  bytes: receiverBytes.byteLength,
};

// Guard the finite input envelope during module admission, before Playwright
// allocates a browser context for any target or scenario.
validateInventory(inventory);
validateMatrix(matrix);
const fullPlan = selectTier({ tier: "full" }, inventory, matrix);
const targetsById = new Map(inventory.targets.map(target => [target.id, target]));
const scenariosById = new Map(matrix.scenarios.map(scenario => [scenario.id, scenario]));

async function loadReceiver(page, query = "") {
  await page.goto(`${receiverUrl}${query}`, { waitUntil: "load" });
}

function scenarioQuery(scenario, extra = {}) {
  const params = new URLSearchParams({
    dir: scenario.direction,
    image: scenario.image,
    font: scenario.font,
    state: scenario.state,
    ...extra,
  });
  return `?${params}`;
}

function scenarioContext(scenario) {
  return {
    viewport: scenario.viewport,
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    reducedMotion: scenario.motion === "reduced" ? "reduce" : "no-preference",
    forcedColors: scenario.colorMode === "forced" ? "active" : "none",
    hasTouch: scenario.input === "touch",
    javaScriptEnabled: scenario.javaScript !== false,
  };
}

async function expectReceiptCoordinateApplied(page, receipt) {
  const applied = await page.evaluate(() => {
    const root = document.documentElement;
    const rootStyle = getComputedStyle(root);
    const image = document.querySelector("#orientation-image");
    const query = new URL(location.href).searchParams;
    return {
      coordinate: {
        scenarioId: root.dataset.observationScenario,
        width: innerWidth,
        height: innerHeight,
        textScale: Number.parseFloat(rootStyle.fontSize) / 16,
        direction: rootStyle.direction,
        media: matchMedia("print").matches ? "print" : "screen",
        colorMode: matchMedia("(forced-colors: active)").matches ? "forced" : "normal",
        motion: matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduced" : "full",
        image: image.complete && image.naturalWidth > 0 ? "available" : "missing",
        font: rootStyle.fontFamily.includes("MissingContractFont") ? "missing" : "system",
        input: root.dataset.observationInput,
        state: document.querySelector("#state").value,
        javaScript: true,
      },
      query: {
        direction: query.get("dir"),
        image: query.get("image"),
        font: query.get("font"),
        state: query.get("state"),
      },
      deviceScaleFactor: devicePixelRatio,
    };
  });
  expect(applied.coordinate).toEqual(receipt.viewportMedia);
  expect(applied.query).toEqual({
    direction: receipt.viewportMedia.direction,
    image: receipt.viewportMedia.image,
    font: receipt.viewportMedia.font,
    state: receipt.viewportMedia.state,
  });
  expect(applied.deviceScaleFactor).toBe(1);
}

function walkFiles(root, directory = root) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(root, path));
    else if (entry.isFile()) files.push(relative(root, path).replaceAll("\\", "/"));
  }
  return files.sort();
}

function boundReceiverManifestDigest() {
  const mediaType = path => ({
    ".css": "text/css",
    ".html": "text/html",
    ".js": "text/javascript",
    ".map": "application/json",
  })[extname(path)] ?? "application/octet-stream";
  const manifest = {
    schemaVersion: "0.1.0",
    files: walkFiles(boundReceiverRoot).map(path => {
      const bytes = readFileSync(resolve(boundReceiverRoot, path));
      return {
        path,
        mediaType: mediaType(path),
        bytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    }),
  };
  return createHash("sha256").update(`${JSON.stringify(manifest, null, 2)}\n`).digest("hex");
}

test("bound Issue #62 production build digest and interactive receiver load together", async ({ page }) => {
  expect(boundReceiverManifestDigest()).toBe(coordinates.receiver.manifestSha256);
  await page.goto(boundReceiverUrl, { waitUntil: "load" });
  await expect(page.getByRole("heading", { name: "One accepted token coordinate, two semantic control routes" })).toBeVisible();

  await page.locator("#native-specimen").selectOption("release-receipt");
  const preview = page.getByRole("button", { name: "Request native preview" });
  await preview.click();
  await expect(page.getByRole("status")).toContainText("accepted Release receipt");
  await expect(page.getByRole("definition").filter({ hasText: "receiver:1:release-receipt" })).toBeVisible();
  await expect(preview).toBeFocused();
});

test("browser coordinate carries exact tool, product, and lock-bound revision", async ({ browser, browserName }) => {
  const coordinate = await environmentCoordinate(browserName, browser);
  expect(coordinate.playwrightVersion).toBe("1.64.1");
  expect(coordinate.browserVersion.length).toBeGreaterThan(0);
  expect(coordinate.browserRevision).toMatch(/^\d+$/u);
});

for (const caseDefinition of fullPlan.cases) {
  const scenario = scenariosById.get(caseDefinition.scenarioId);

  if (caseDefinition.kind === "observation") {
    const target = targetsById.get(caseDefinition.targetId);
    test(`${caseDefinition.id} passes with the intended signal`, async ({ browser, browserName }, testInfo) => {
      const started = performance.now();
      const context = await browser.newContext(scenarioContext(scenario));
      const page = await context.newPage();
      try {
        await loadReceiver(page, scenarioQuery(scenario, target.oracle === "interaction" ? { stale: "1" } : {}));
        await applyScenario(page, scenario);
        expect(page.viewportSize()).toEqual(scenario.viewport);
        await expect(page.locator("#state")).toHaveValue(scenario.state);
        const result = await observeTarget(page, target, { artifactDirectory: resolve(packageRoot, ".artifacts/browser", testInfo.project.name, target.id, scenario.id) });
        expect(result.status).toBe("pass");
        if (target.oracle === "semantic") {
          expect(result.normalized.accessibleName).toBe("Specimen family");
          expect(result.normalized.labelVisible).toBe(true);
          expect(result.normalized.label.width).toBeGreaterThan(0);
          expect(result.normalized.label.height).toBeGreaterThan(0);
          expect(result.normalized.label.bottom).toBeLessThanOrEqual(result.normalized.control.top + 0.5);
        }
        if (target.oracle === "geometry") {
          expect(result.normalized.controls.map(control => control.id).sort()).toEqual(["accept", "family", "preview", "state"]);
          expect(result.normalized.cards.map(card => card.id).sort()).toEqual(["accepted", "candidate"]);
          for (const control of result.normalized.controls) {
            expect(control.width, `${control.id} width`).toBeGreaterThanOrEqual(44);
            expect(control.height, `${control.id} height`).toBeGreaterThanOrEqual(44);
            expect(control.left, `${control.id} inline start`).toBeGreaterThanOrEqual(-0.5);
            expect(control.right, `${control.id} inline end`).toBeLessThanOrEqual(result.normalized.viewportWidth + 0.5);
          }
          for (const card of result.normalized.cards) {
            expect(card.scrollWidth, `${card.id} inline content`).toBeLessThanOrEqual(card.clientWidth + 1);
            expect(card.scrollHeight, `${card.id} block content`).toBeLessThanOrEqual(card.clientHeight + 1);
          }
        }
        if (target.oracle === "bitmap_crop") {
          expect(result.normalized.screenshotSha256).not.toBe(result.normalized.referenceSha256);
          expect(result.normalized.metric.changedPixels).toBeGreaterThan(0);
          expect(result.normalized.metric.cardPixels).toBeGreaterThan(0);
          expect(result.normalized.metric.cardChangedPixels).toBe(0);
        }
        const receipt = formBrowserReceipt({
          receiptId: `${target.id}-${scenario.id}-${browserName}`,
          target,
          result,
          subjectArtifact,
          environment: await environmentCoordinate(browserName, browser),
          scenario,
          coordinates,
          elapsedMs: Number((performance.now() - started).toFixed(3)),
          peakRssBytes: process.memoryUsage().rss,
        });
        expect(receipt.classification).toBe(target.oracle === "bitmap_crop" ? "declared_engine_platform_variance" : "deterministic_implementation_change");
        expect(receipt.caseId).toBe(caseDefinition.id);
        await expectReceiptCoordinateApplied(page, receipt);
        const receiptRoot = resolve(packageRoot, ".artifacts/browser-receipts", browserName, target.id, scenario.id);
        const pointer = await publishReceipt(receiptRoot, receipt, {
          artifactSources: { [subjectArtifact.path]: receiverPath, ...result.artifactSources },
          ownerRoot: packageRoot,
        });
        expect(pointer.receiptId).toBe(`${target.id}-${scenario.id}-${browserName}`);
      } finally {
        await context.close();
      }
    });
    continue;
  }

  if (caseDefinition.kind === "controlled_fault") {
    const target = targetsById.get(caseDefinition.targetId);
    test(`${caseDefinition.id} proves the intended oracle`, async ({ browser }, testInfo) => {
      const context = await browser.newContext(scenarioContext(scenario));
      const page = await context.newPage();
      try {
        await loadReceiver(page, scenarioQuery(scenario, { fault: target.fault }));
        await applyScenario(page, scenario);
        const result = await observeTarget(page, target, { artifactDirectory: resolve(packageRoot, ".artifacts/browser-faults", testInfo.project.name, target.id, scenario.id) });
        expect(result.status).toBe("fail");
        if (target.oracle === "geometry") {
          expect(result.normalized.scrollWidth).toBeLessThanOrEqual(result.normalized.viewportWidth);
          const candidate = result.normalized.cards.find(card => card.id === "candidate");
          const accepted = result.normalized.cards.find(card => card.id === "accepted");
          expect(accepted.top).toBeLessThan(candidate.bottom);
          expect(accepted.left).toBeLessThan(candidate.right);
        }
        if (target.oracle === "bitmap_crop") {
          expect(result.normalized.metric.changedPixels).toBeGreaterThan(0);
          expect(result.normalized.metric.cardChangedPixels).toBeGreaterThan(0);
        }
      } finally {
        await context.close();
      }
    });
    continue;
  }

  test(`${caseDefinition.id} applies its declared rendering and input state`, async ({ browser }) => {
    const context = await browser.newContext(scenarioContext(scenario));
    const page = await context.newPage();
    try {
      if (scenario.javaScript === false) {
        await page.goto(receiverUrl, { waitUntil: "load" });
        await expect(page.getByRole("heading", { name: "Specimen review receiver" })).toBeVisible();
        await expect(page.locator(".semantic-companion")).toContainText("The accepted state remains available");
        expect(page.viewportSize()).toEqual(scenario.viewport);
        return;
      }
      await loadReceiver(page, scenarioQuery(scenario));
      await applyScenario(page, scenario);
      await expect(page.getByRole("heading", { name: "Specimen review receiver" })).toBeVisible();
      await expect(page.locator(".semantic-companion")).toContainText("Accepted coordinate");
      await expect(page.locator("#state")).toHaveValue(scenario.state);
      if (scenario.state === "pending") await expect(page.locator("#status")).toContainText(/Pending generation/u);
      else if (scenario.state === "stale") await expect(page.locator("#status")).toContainText(/Stale generation/u);
      else await expect(page.locator("[data-accepted]")).toContainText(scenario.state);

      const rendering = await page.evaluate(() => ({
        direction: document.documentElement.dir,
        fontSize: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
        fontFamily: getComputedStyle(document.documentElement).fontFamily,
        print: matchMedia("print").matches,
        forcedColors: matchMedia("(forced-colors: active)").matches,
        transitionSeconds: Number.parseFloat(getComputedStyle(document.querySelector("output")).transitionDuration),
      }));
      expect(rendering.direction).toBe(scenario.direction);
      expect(rendering.fontSize).toBe(16 * scenario.textScale);
      expect(rendering.print).toBe(scenario.media === "print");
      expect(rendering.forcedColors).toBe(scenario.colorMode === "forced");
      expect(rendering.transitionSeconds > 0).toBe(scenario.motion === "full");
      if (scenario.font === "missing") expect(rendering.fontFamily).toContain("MissingContractFont");
      if (scenario.media === "print") await expect(page.locator(".actions")).toBeHidden();
      if (scenario.image === "missing") await expect(page.locator("#orientation-image")).toHaveAttribute("alt", /candidate.*accepted/u);
      if (scenario.viewport.width === 320) {
        const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
        expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
      }

      const accept = page.locator("#accept");
      if (scenario.input === "keyboard") {
        await accept.focus();
        await accept.press("Enter");
        await expect(accept).toBeFocused();
      } else if (scenario.input === "pointer") {
        await accept.click();
      } else if (scenario.input === "touch") {
        await accept.tap();
      }
      if (scenario.input !== "none") await expect(page.locator("#status")).toContainText(/Accepted generation/u);
    } finally {
      await context.close();
    }
  });
}

for (const fault of [
  "geometry-select-collapse",
  "geometry-card-reversed",
  "geometry-card-clipped",
]) {
  test(`${fault} independently fails the geometry contract`, async ({ browser }) => {
    const scenario = scenariosById.get("narrow-200");
    const target = targetsById.get("narrow-reflow");
    const context = await browser.newContext(scenarioContext(scenario));
    const page = await context.newPage();
    try {
      await loadReceiver(page, scenarioQuery(scenario, { fault }));
      await applyScenario(page, scenario);
      const result = await observeTarget(page, target);
      expect(result.status).toBe("fail");
      if (fault === "geometry-select-collapse") {
        expect(result.normalized.controls.find(control => control.id === "family").width).toBeLessThan(44);
      } else if (fault === "geometry-card-reversed") {
        const candidate = result.normalized.cards.find(card => card.id === "candidate");
        const accepted = result.normalized.cards.find(card => card.id === "accepted");
        expect(accepted.top).toBeLessThan(candidate.top);
      } else {
        expect(result.normalized.cards.some(card => card.scrollHeight > card.clientHeight + 1)).toBe(true);
      }
    } finally {
      await context.close();
    }
  });
}

test("a zero-area clipped label fails the semantic oracle while retaining its accessible name", async ({ browser }) => {
  const scenario = scenariosById.get("baseline");
  const target = targetsById.get("family-label");
  const context = await browser.newContext(scenarioContext(scenario));
  const page = await context.newPage();
  try {
    await loadReceiver(page, scenarioQuery(scenario, { fault: "semantic-visible" }));
    await applyScenario(page, scenario);
    const result = await observeTarget(page, target);
    expect(result.status).toBe("fail");
    expect(result.normalized.accessibleName).toBe("Specimen family");
    expect(result.normalized.label.width * result.normalized.label.height).toBe(0);
  } finally {
    await context.close();
  }
});
