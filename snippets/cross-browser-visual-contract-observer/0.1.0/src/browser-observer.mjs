import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { evaluateControlledObservation, sha256 } from "./contracts.mjs";

const require = createRequire(import.meta.url);

async function packageVersion(packageName) {
  const entry = require.resolve(packageName);
  let directory = dirname(entry);
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

export async function declaredBrowserRevisions() {
  const core = await packageVersion("playwright-core");
  const catalog = JSON.parse(await readFile(resolve(core.directory, "browsers.json"), "utf8"));
  return Object.fromEntries(
    catalog.browsers
      .filter(entry => ["chromium", "firefox", "webkit"].includes(entry.name))
      .map(entry => [entry.name, String(entry.revision)]),
  );
}

export async function environmentCoordinate(browserName, browser) {
  const revisions = await declaredBrowserRevisions();
  const playwright = await packageVersion("@playwright/test");
  return {
    coordinateKind: "browser_runtime",
    playwrightVersion: playwright.version,
    browserName,
    browserVersion: browser.version(),
    browserRevision: revisions[browserName],
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    fontSet: "system-ui synthetic fixture",
    headless: true,
  };
}

export async function applyScenario(page, scenario) {
  await page.setViewportSize(scenario.viewport);
  await page.emulateMedia({
    media: scenario.media,
    reducedMotion: scenario.motion === "reduced" ? "reduce" : "no-preference",
    forcedColors: scenario.colorMode === "forced" ? "active" : "none",
  });
  await page.evaluate(({ id, direction, textScale, input }) => {
    const root = document.documentElement;
    root.dir = direction;
    root.style.fontSize = `${textScale * 100}%`;
    root.dataset.observationScenario = id;
    root.dataset.observationInput = input === "none" ? "none" : "";
    const recordInput = event => {
      if (root.dataset.observationInput) return;
      root.dataset.observationInput = event instanceof KeyboardEvent
        ? "keyboard"
        : event.pointerType === "touch"
          ? "touch"
          : "pointer";
    };
    addEventListener("keydown", recordInput, { capture: true });
    addEventListener("pointerdown", recordInput, { capture: true });
  }, scenario);
  if (scenario.input === "keyboard") await page.keyboard.press("Shift");
  else if (scenario.input === "pointer") await page.getByRole("heading", { level: 1 }).click({ position: { x: 1, y: 1 } });
  else if (scenario.input === "touch") await page.getByRole("heading", { level: 1 }).tap({ position: { x: 1, y: 1 } });
  await page.waitForFunction(input => document.documentElement.dataset.observationInput === input, scenario.input);
}

export async function observeTarget(page, target, { artifactDirectory = null } = {}) {
  let observed;
  const artifacts = [];
  const artifactSources = {};
  if (target.oracle === "semantic") {
    const namedSelect = page.getByRole("combobox", { name: "Specimen family" });
    const accessibleName = await namedSelect.count() === 1 ? "Specimen family" : "";
    observed = await page.evaluate(accessibleName => {
      const label = document.querySelector('label[for="family"]');
      const select = document.querySelector("#family");
      const labelBox = label?.getBoundingClientRect();
      const selectBox = select.getBoundingClientRect();
      return { accessibleName, labelPosition: labelBox && labelBox.bottom <= selectBox.top ? "above" : "other" };
    }, accessibleName);
  } else if (target.oracle === "interaction") {
    await page.locator("#preview").focus();
    await page.locator("#preview").press("Enter");
    await page.waitForFunction(() => /^(?:Candidate|Late|Stale)/u.test(document.querySelector("#status").value));
    observed = await page.evaluate(() => ({
      focusOwner: document.activeElement?.id || document.activeElement?.tagName.toLowerCase(),
      acceptedGeneration: Number(document.querySelector("#status").value.match(/Accepted generation (\d+)/u)?.[1] ?? (document.querySelector("#status").value.includes("replaced") ? 1 : -1)),
      settlement: document.querySelector("#status").value.startsWith("Stale") ? "stale" : document.querySelector("#status").value.includes("replaced") ? "late-applied" : "candidate",
    }));
  } else if (target.oracle === "geometry") {
    observed = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button")];
      return {
        viewportWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        minimumHitTarget: Math.min(...buttons.map(button => button.getBoundingClientRect().height)),
      };
    });
  } else if (target.oracle === "computed_style") {
    observed = await page.evaluate(() => ({
      customProperty: "--contract-action",
      resolvedValue: getComputedStyle(document.querySelector("#preview")).backgroundColor,
    }));
  } else if (target.oracle === "bitmap_crop") {
    const workflow = page.locator(".workflow");
    const screenshot = await workflow.screenshot();
    const screenshotSha256 = sha256(screenshot);
    if (artifactDirectory) {
      const path = resolve(artifactDirectory, `${target.id}.png`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, screenshot);
      const receiptPath = `artifacts/${basename(path)}`;
      artifacts.push({ path: receiptPath, sha256: screenshotSha256, bytes: screenshot.byteLength });
      artifactSources[receiptPath] = path;
    }
    observed = {
      ...await page.evaluate(() => ({
      crop: "workflow",
      connectorLayer: Number(getComputedStyle(document.querySelector(".workflow svg")).zIndex),
      cardLayer: Number(getComputedStyle(document.querySelector(".card")).zIndex),
      })),
      screenshotSha256,
      screenshotBytes: screenshot.byteLength,
    };
  }
  return { ...evaluateControlledObservation(target, observed), artifacts, artifactSources };
}

export function formBrowserReceipt({ receiptId, target, result, subjectArtifact, environment, scenario, coordinates, elapsedMs, peakRssBytes }) {
  const sourceCoordinate = value => ({ semanticId: value.semanticId, version: value.version, coordinate: value.coordinate, manifestKind: value.manifestKind, manifestSha256: value.manifestSha256 });
  const receiverCoordinate = value => ({ semanticId: value.semanticId, version: value.version, manifestKind: value.manifestKind, manifestSha256: value.manifestSha256 });
  const artifacts = [subjectArtifact, ...(result.artifacts ?? [])];
  return {
    schemaVersion: "0.1.0",
    receiptId,
    caseId: `observe--${target.id}--${scenario.id}`,
    targetId: target.id,
    decisionBoundary: target.decision,
    source: sourceCoordinate(coordinates.tokenSource),
    receiver: receiverCoordinate(coordinates.receiver),
    subject: { kind: "synthetic_receiver_fixture", ...subjectArtifact },
    environment,
    viewportMedia: {
      scenarioId: scenario.id,
      width: scenario.viewport.width,
      height: scenario.viewport.height,
      textScale: scenario.textScale,
      direction: scenario.direction,
      media: scenario.media,
      colorMode: scenario.colorMode,
      motion: scenario.motion,
      image: scenario.image,
      font: scenario.font,
      input: scenario.input,
      state: scenario.state,
      javaScript: scenario.javaScript !== false,
    },
    observation: target.oracle,
    result: { status: result.status, normalized: result.normalized },
    artifacts,
    measurements: {
      elapsedMs,
      emittedBytes: artifacts.reduce((total, artifact) => total + artifact.bytes, 0),
      peakRssBytes,
      assertionCount: 1,
    },
    standing: "candidate",
    classification: target.oracle === "bitmap_crop"
      ? "declared_engine_platform_variance"
      : "deterministic_implementation_change",
    restartFrom: target.restartFrom,
  };
}
