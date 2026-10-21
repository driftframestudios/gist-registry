import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import {
  evaluateControlledObservation,
  inspectPngScreenshot,
  ObserverError,
  sha256,
  validateBitmapCaptureEnvelope,
} from "./contracts.mjs";

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
    const classifyInput = event => {
      if (event instanceof KeyboardEvent) return "keyboard";
      if (event.pointerType === "touch") return "touch";
      return "pointer";
    };
    const recordInput = event => {
      if (root.dataset.observationInput) return;
      root.dataset.observationInput = classifyInput(event);
    };
    addEventListener("keydown", recordInput, { capture: true });
    addEventListener("pointerdown", recordInput, { capture: true });
  }, scenario);
  if (scenario.input === "keyboard") await page.keyboard.press("Shift");
  else if (scenario.input === "pointer") await page.getByRole("heading", { level: 1 }).click({ position: { x: 1, y: 1 } });
  else if (scenario.input === "touch") await page.getByRole("heading", { level: 1 }).tap({ position: { x: 1, y: 1 } });
  await page.waitForFunction(input => document.documentElement.dataset.observationInput === input, scenario.input);
}

async function bitmapDifferenceMetric(page, visibleBytes, referenceBytes, cardRegions, envelope) {
  return page.evaluate(async ({ visible, reference, regions, expected }) => {
    const decode = source => new Promise((resolveImage, rejectImage) => {
      const image = new Image();
      image.addEventListener("load", () => resolveImage(image), { once: true });
      image.addEventListener("error", () => rejectImage(new Error("Bitmap comparison input could not be decoded.")), { once: true });
      image.src = `data:image/png;base64,${source}`;
    });
    const readPixels = async source => {
      const image = await decode(source);
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
      context.drawImage(image, 0, 0);
      return {
        width: canvas.width,
        height: canvas.height,
        pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
      };
    };

    const [visibleImage, referenceImage] = await Promise.all([
      readPixels(visible),
      readPixels(reference),
    ]);
    if (
      visibleImage.width !== referenceImage.width ||
      visibleImage.height !== referenceImage.height
    ) {
      throw new Error("Bitmap comparison inputs require identical dimensions.");
    }
    if (
      visibleImage.width !== expected.pixelWidth
      || visibleImage.height !== expected.pixelHeight
      || visibleImage.width * visibleImage.height > expected.pixels
    ) {
      throw new Error("Bitmap comparison dimensions exceed the admitted capture envelope.");
    }

    const pixelWidth = visibleImage.width;
    const pixelHeight = visibleImage.height;
    const scaleX = pixelWidth / regions.cropWidth;
    const scaleY = pixelHeight / regions.cropHeight;
    const boundedCardRegions = regions.cards.map(card => ({
      left: Math.max(0, Math.ceil(card.left * scaleX)),
      top: Math.max(0, Math.ceil(card.top * scaleY)),
      right: Math.min(pixelWidth, Math.floor(card.right * scaleX)),
      bottom: Math.min(pixelHeight, Math.floor(card.bottom * scaleY)),
    }));
    const insideCard = (x, y) => boundedCardRegions.some(card => (
      x >= card.left && x < card.right && y >= card.top && y < card.bottom
    ));

    let changedPixels = 0;
    let cardPixels = 0;
    let cardChangedPixels = 0;
    for (let y = 0; y < pixelHeight; y += 1) {
      for (let x = 0; x < pixelWidth; x += 1) {
        const offset = (y * pixelWidth + x) * 4;
        const changed = (
          visibleImage.pixels[offset] !== referenceImage.pixels[offset] ||
          visibleImage.pixels[offset + 1] !== referenceImage.pixels[offset + 1] ||
          visibleImage.pixels[offset + 2] !== referenceImage.pixels[offset + 2] ||
          visibleImage.pixels[offset + 3] !== referenceImage.pixels[offset + 3]
        );
        const cardPixel = insideCard(x, y);
        if (changed) changedPixels += 1;
        if (cardPixel) cardPixels += 1;
        if (changed && cardPixel) cardChangedPixels += 1;
      }
    }

    return {
      kind: "connector_visibility_pixel_difference",
      reference: "connector_hidden",
      pixelWidth,
      pixelHeight,
      totalPixels: pixelWidth * pixelHeight,
      changedPixels,
      cardPixels,
      cardChangedPixels,
    };
  }, {
    visible: visibleBytes.toString("base64"),
    reference: referenceBytes.toString("base64"),
    regions: cardRegions,
    expected: envelope,
  });
}

export async function observeTarget(page, target, { artifactDirectory = null } = {}) {
  let observed;
  const artifacts = [];
  const artifactSources = {};
  if (target.oracle === "semantic") {
    const namedSelect = page.getByRole("combobox", { name: "Specimen family" });
    const accessibleName = await namedSelect.count() === 1 ? "Specimen family" : "";
    await page.locator("#family-field").scrollIntoViewIfNeeded();
    observed = await page.evaluate(accessibleName => {
      const rectangle = element => {
        const bounds = element?.getBoundingClientRect();
        return bounds
          ? {
              width: Number(bounds.width.toFixed(3)),
              height: Number(bounds.height.toFixed(3)),
              left: Number(bounds.left.toFixed(3)),
              right: Number(bounds.right.toFixed(3)),
              top: Number(bounds.top.toFixed(3)),
              bottom: Number(bounds.bottom.toFixed(3)),
            }
          : null;
      };
      const label = document.querySelector("#family-label");
      const select = document.querySelector("#family");
      const labelBox = rectangle(label);
      const selectBox = rectangle(select);
      const style = label ? getComputedStyle(label) : null;
      const labelVisible = Boolean(
        style
        && style.display !== "none"
        && style.visibility === "visible"
        && Number.parseFloat(style.opacity) > 0
        && labelBox?.width > 0
        && labelBox?.height > 0
      );
      return {
        accessibleName,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        labelVisible,
        labelPosition: labelBox && selectBox && labelBox.bottom <= selectBox.top ? "above" : "other",
        label: labelBox,
        control: selectBox,
      };
    }, accessibleName);
  } else if (target.oracle === "interaction") {
    await page.locator("#preview").focus();
    await page.locator("#preview").press("Enter");
    await page.waitForFunction(() => /^(?:Candidate|Late|Stale)/u.test(document.querySelector("#status").value));
    observed = await page.evaluate(() => {
      const classifySettlement = status => {
        if (status.startsWith("Stale")) return "stale";
        if (status.includes("replaced")) return "late-applied";
        return "candidate";
      };
      const acceptedGeneration = status => {
        const match = status.match(/Accepted generation (\d+)/u);
        if (match) return Number(match[1]);
        if (status.includes("replaced")) return 1;
        return -1;
      };
      const status = document.querySelector("#status").value;
      return {
        focusOwner: document.activeElement?.id || document.activeElement?.tagName.toLowerCase(),
        acceptedGeneration: acceptedGeneration(status),
        settlement: classifySettlement(status),
      };
    });
  } else if (target.oracle === "geometry") {
    observed = await page.evaluate(() => {
      const rectangle = element => {
        const bounds = element.getBoundingClientRect();
        return {
          id: element.id,
          width: Number(bounds.width.toFixed(3)),
          height: Number(bounds.height.toFixed(3)),
          left: Number(bounds.left.toFixed(3)),
          right: Number(bounds.right.toFixed(3)),
          top: Number(bounds.top.toFixed(3)),
          bottom: Number(bounds.bottom.toFixed(3)),
          clientWidth: element.clientWidth,
          clientHeight: element.clientHeight,
          scrollWidth: element.scrollWidth,
          scrollHeight: element.scrollHeight,
        };
      };
      const workflow = document.querySelector(".workflow");
      return {
        viewportWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        direction: getComputedStyle(document.documentElement).direction,
        workflow: rectangle(workflow),
        controls: [...document.querySelectorAll("select, button")].map(rectangle),
        cards: [...workflow.querySelectorAll(".card")].map(rectangle),
      };
    });
  } else if (target.oracle === "computed_style") {
    observed = await page.evaluate(() => ({
      customProperty: "--contract-action",
      resolvedValue: getComputedStyle(document.querySelector("#preview")).backgroundColor,
    }));
  } else if (target.oracle === "bitmap_crop") {
    const workflow = page.locator(".workflow");
    const connector = workflow.locator("svg");
    const cardRegions = await workflow.evaluate(root => {
      const crop = root.getBoundingClientRect();
      return {
        cropWidth: crop.width,
        cropHeight: crop.height,
        deviceScaleFactor: devicePixelRatio,
        cards: [...root.querySelectorAll(".card")].map(card => {
          const bounds = card.getBoundingClientRect();
          return {
            left: bounds.left - crop.left,
            top: bounds.top - crop.top,
            right: bounds.right - crop.left,
            bottom: bounds.bottom - crop.top,
          };
        }),
      };
    });
    if (cardRegions.cards.length !== 2) {
      throw new ObserverError("BITMAP_ENVELOPE_INVALID", "The workflow bitmap requires its two declared card regions.", {
        observed: cardRegions.cards.length,
        restartFrom: "receiver_bitmap_boundary",
      });
    }
    // Locator screenshots align fractional CSS edges to the surrounding device
    // pixels. Admit one pixel per axis during preflight, then bind comparison to
    // the PNG's exact IHDR dimensions before either image reaches a decoder.
    const screenshotEdgeAllowance = 1;
    const predictedEnvelope = validateBitmapCaptureEnvelope({
      cropWidth: Math.ceil(cardRegions.cropWidth),
      cropHeight: Math.ceil(cardRegions.cropHeight),
      pixelWidth: Math.ceil(cardRegions.cropWidth * cardRegions.deviceScaleFactor) + screenshotEdgeAllowance,
      pixelHeight: Math.ceil(cardRegions.cropHeight * cardRegions.deviceScaleFactor) + screenshotEdgeAllowance,
      cardCount: cardRegions.cards.length,
    });
    const screenshot = await workflow.screenshot();
    const visibleDimensions = inspectPngScreenshot(screenshot, "bitmap.visibleScreenshotBytes");
    if (
      visibleDimensions.pixelWidth > predictedEnvelope.pixelWidth
      || visibleDimensions.pixelHeight > predictedEnvelope.pixelHeight
    ) {
      throw new ObserverError("BITMAP_ENVELOPE_INVALID", "The PNG dimensions must remain inside the preflight capture envelope.", {
        predicted: {
          pixelWidth: predictedEnvelope.pixelWidth,
          pixelHeight: predictedEnvelope.pixelHeight,
        },
        observed: visibleDimensions,
        restartFrom: "receiver_bitmap_boundary",
      });
    }
    const envelope = validateBitmapCaptureEnvelope({
      cropWidth: predictedEnvelope.cropWidth,
      cropHeight: predictedEnvelope.cropHeight,
      ...visibleDimensions,
      cardCount: predictedEnvelope.cardCount,
    });
    const screenshotSha256 = sha256(screenshot);
    let referenceScreenshot;
    const priorVisibility = await connector.evaluate(element => {
      const prior = element.style.visibility;
      element.style.visibility = "hidden";
      return prior;
    });
    try {
      referenceScreenshot = await workflow.screenshot();
    } finally {
      await connector.evaluate((element, visibility) => {
        element.style.visibility = visibility;
      }, priorVisibility);
    }
    const referenceDimensions = inspectPngScreenshot(referenceScreenshot, "bitmap.referenceScreenshotBytes");
    if (
      referenceDimensions.pixelWidth !== envelope.pixelWidth
      || referenceDimensions.pixelHeight !== envelope.pixelHeight
    ) {
      throw new ObserverError("BITMAP_DIMENSION_MISMATCH", "Visible and reference PNG captures require one shared size coordinate.", {
        visible: {
          pixelWidth: envelope.pixelWidth,
          pixelHeight: envelope.pixelHeight,
        },
        reference: referenceDimensions,
        restartFrom: "receiver_bitmap_boundary",
      });
    }
    const metric = await bitmapDifferenceMetric(
      page,
      screenshot,
      referenceScreenshot,
      cardRegions,
      envelope,
    );
    if (artifactDirectory) {
      const path = resolve(artifactDirectory, `${target.id}.png`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, screenshot);
      const receiptPath = `artifacts/${basename(path)}`;
      artifacts.push({ path: receiptPath, sha256: screenshotSha256, bytes: screenshot.byteLength });
      artifactSources[receiptPath] = path;
    }
    observed = {
      crop: "workflow",
      screenshotSha256,
      screenshotBytes: screenshot.byteLength,
      referenceSha256: sha256(referenceScreenshot),
      referenceBytes: referenceScreenshot.byteLength,
      metric,
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
