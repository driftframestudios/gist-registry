import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, opendir, rename, rm, rmdir } from "node:fs/promises";
import { release as osRelease } from "node:os";
import path from "node:path";

import sharp from "sharp";

const CONTRACT_KEYS = new Set([
  "schemaVersion",
  "artifactId",
  "title",
  "description",
  "alt",
  "caption",
  "outputBaseName",
  "outputMediaType",
  "metadataPolicy",
  "fontCoordinate",
  "sourceStanding",
  "rightsStanding",
  "owner",
  "intrinsic",
  "widths",
  "states",
  "readingOrder",
]);

export const DEFAULT_RESOURCE_LIMITS = Object.freeze({
  contractBytes: 64 * 1024,
  svgBytes: 1024 * 1024,
  galleryShellBytes: 256 * 1024,
  totalSourceBytes: 1280 * 1024,
  states: 64,
  widths: 8,
  intrinsicPixels: 32_000_000,
  derivativePixels: 64_000_000,
  outputBytes: 16 * 1024 * 1024,
  sourceReferences: 64,
});

const ACTIVE_SVG_ELEMENTS = Object.freeze([
  "script",
  "foreignObject",
  "iframe",
  "object",
  "embed",
  "audio",
  "video",
  "animate",
  "animateMotion",
  "animateTransform",
  "set",
]);

const ACTIVE_GALLERY_ELEMENTS = Object.freeze([
  "script",
  "iframe",
  "object",
  "embed",
  "frame",
  "frameset",
  "base",
  "form",
]);

const STATIC_SVG_ELEMENTS = new Set([
  "circle", "clipPath", "defs", "desc", "ellipse", "feBlend", "feColorMatrix",
  "feComponentTransfer", "feComposite", "feConvolveMatrix", "feDiffuseLighting",
  "feDisplacementMap", "feDistantLight", "feDropShadow", "feFlood", "feFuncA",
  "feFuncB", "feFuncG", "feFuncR", "feGaussianBlur", "feImage", "feMerge",
  "feMergeNode", "feMorphology", "feOffset", "fePointLight", "feSpecularLighting",
  "feSpotLight", "feTile", "feTurbulence", "filter", "g", "image", "line",
  "linearGradient", "marker", "mask", "metadata", "path", "pattern", "polygon",
  "polyline", "radialGradient", "rect", "stop", "style", "svg", "switch",
  "symbol", "text", "textPath", "title", "tspan", "use", "view",
]);

const STATIC_GALLERY_ELEMENTS = new Set([
  "article", "aside", "body", "code", "dd", "div", "dl", "dt", "em",
  "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6",
  "head", "header", "html", "img", "li", "main", "meta", "ol", "p",
  "picture", "section", "small", "source", "span", "strong", "style", "table",
  "tbody", "td", "tfoot", "th", "thead", "title", "tr", "ul",
]);

const RESOURCE_ATTRIBUTE = /\b(?:href|xlink:href|src|poster|data|action|formaction)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/giu;
const SRCSET_ATTRIBUTE = /\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/giu;
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)'"`]+))\s*\)/giu;
const PRIVATE_LOCATOR = /(?:\b(?:file|private-local)\s*:|\/(?:Users|home|private\/var)\/|[A-Za-z]:\\(?:Users|Documents|Desktop)\\|\\\\[^\s"'<>]+\\|\b(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\b|\b10(?:\.\d{1,3}){3}\b|\b192\.168(?:\.\d{1,3}){2}\b|\b172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}\b)/iu;
const EXTERNAL_LOCATOR = /(?:\b(?:https?|ftp|wss?|data|blob|file)\s*:|(?<!:)\/\/)/iu;

export class VisualArtifactError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "VisualArtifactError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

// Artifact identity uses ordinal code-unit order. Locale collation belongs in a
// receiving view and therefore stays outside manifest formation.
export function compareOrdinalText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort(compareOrdinalText).map((key) => [key, stable(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

function runtimeLibcCoordinate() {
  const header = process.report?.getReport?.().header ?? {};
  if (header.glibcVersionRuntime) {
    return Object.freeze({ family: "glibc", version: header.glibcVersionRuntime });
  }
  if (process.platform === "linux") {
    return Object.freeze({ family: "runtime_unspecified" });
  }
  return Object.freeze({ family: "platform_native" });
}

function assertRecord(value, owner) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VisualArtifactError("invalid_record", `${owner} must be an object.`, { owner });
  }
}

function requireText(value, owner) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new VisualArtifactError("missing_text", `${owner} requires a non-empty string.`, { owner });
  }
  return value.trim();
}

function normalizeResourceLimits(overrides = {}) {
  assertRecord(overrides, "resourceLimits");
  const unknown = Object.keys(overrides).filter((key) => !(key in DEFAULT_RESOURCE_LIMITS));
  if (unknown.length > 0) {
    throw new VisualArtifactError("invalid_resource_limits", "Resource limits contain unsupported fields.", {
      fields: unknown.sort(),
    });
  }
  const limits = { ...DEFAULT_RESOURCE_LIMITS, ...overrides };
  for (const [resource, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new VisualArtifactError("invalid_resource_limits", "Every resource limit must be a positive safe integer.", {
        resource,
        observed: value,
      });
    }
  }
  return Object.freeze(limits);
}

function assertWithinResourceLimit(resource, observed, limit, restartAt) {
  if (!Number.isSafeInteger(observed) || observed > limit) {
    throw new VisualArtifactError("resource_limit_exceeded", `${resource} exceeds its admitted resource envelope.`, {
      resource,
      observed,
      limit,
      restartAt,
    });
  }
}

async function readBoundedFile(filePath, resource, limit, {
  expectedBytes = null,
  owner = "source coordinate",
  restartAt = "reduce_source_bytes",
} = {}) {
  let pathEntry;
  try {
    pathEntry = await lstat(filePath);
  } catch (error) {
    throw new VisualArtifactError("invalid_source_file", `The ${owner} requires a readable regular file.`, {
      resource,
      filePath,
      cause: error.message,
    });
  }
  if (!pathEntry.isFile() || pathEntry.isSymbolicLink()) {
    throw new VisualArtifactError("invalid_source_file", `The ${owner} must resolve directly to a regular file.`, {
      resource,
      filePath,
    });
  }
  assertWithinResourceLimit(resource, pathEntry.size, limit, restartAt);
  if (expectedBytes !== null && pathEntry.size !== expectedBytes) {
    throw new VisualArtifactError("source_size_mismatch", `The ${owner} byte count differs from its declared coordinate.`, {
      resource,
      expectedBytes,
      observedBytes: pathEntry.size,
    });
  }

  let handle;
  try {
    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
    handle = await open(filePath, flags);
  } catch (error) {
    throw new VisualArtifactError("invalid_source_file", `The ${owner} changed or became unreadable before capture.`, {
      resource,
      filePath,
      cause: error.message,
    });
  }
  let primaryError = null;
  try {
    const openedEntry = await handle.stat();
    if (!openedEntry.isFile() || openedEntry.dev !== pathEntry.dev || openedEntry.ino !== pathEntry.ino) {
      throw new VisualArtifactError("source_file_changed", `The ${owner} changed before capture completed.`, {
        resource,
        filePath,
      });
    }
    assertWithinResourceLimit(resource, openedEntry.size, limit, restartAt);
    if (expectedBytes !== null && openedEntry.size !== expectedBytes) {
      throw new VisualArtifactError("source_size_mismatch", `The opened ${owner} byte count differs from its declared coordinate.`, {
        resource,
        expectedBytes,
        observedBytes: openedEntry.size,
      });
    }
    const bytes = Buffer.allocUnsafe(openedEntry.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const overflow = Buffer.allocUnsafe(1);
    const overflowRead = await handle.read(overflow, 0, 1, openedEntry.size);
    const settledEntry = await handle.stat();
    if (
      offset !== openedEntry.size
      || overflowRead.bytesRead > 0
      || settledEntry.size !== openedEntry.size
      || settledEntry.mtimeMs !== openedEntry.mtimeMs
    ) {
      throw new VisualArtifactError("source_file_changed", `The ${owner} changed during bounded capture.`, {
        resource,
        filePath,
      });
    }
    return bytes;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await handle.close();
    } catch (error) {
      if (primaryError === null) {
        throw new VisualArtifactError("source_file_close_failed", `The ${owner} descriptor requires operator recovery.`, {
          resource,
          filePath,
          cause: error.message,
        });
      }
    }
  }
}

function firstAttributeValue(match) {
  return match[1] ?? match[2] ?? match[3] ?? "";
}

function stripNamespaceDeclarations(source) {
  return source.replace(/\s+xmlns(?::[A-Za-z][\w.-]*)?\s*=\s*(?:"[^"]*"|'[^']*')/giu, "");
}

function decodeCssEscapesForInspection(source) {
  return source
    .replace(/\\(?:\r\n|[\n\r\f])/gu, "")
    .replace(
      /\\([0-9a-f]{1,6})(?:\r\n|[ \t\n\r\f])?|\\([^\n\r\f0-9a-f])/giu,
      (_match, hexadecimal, escapedCharacter) => {
        if (escapedCharacter !== undefined) return escapedCharacter;
        const codePoint = Number.parseInt(hexadecimal, 16);
        if (
          codePoint === 0
          || codePoint > 0x10ffff
          || (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          return "\ufffd";
        }
        return String.fromCodePoint(codePoint);
      },
    );
}

function validateScriptIndependentSource(source, {
  owner,
  activeElements,
  allowedElements,
  rejectXmlDeclarations = false,
  sourceReferenceLimit = DEFAULT_RESOURCE_LIMITS.sourceReferences,
}) {
  requireText(source, owner);
  // CSS escapes can encode active instructions and external locators through
  // alternate byte sequences. Normalize an inspection copy before applying
  // the static, self-contained stylesheet contract.
  const inspectionSource = decodeCssEscapesForInspection(source);
  const activePattern = new RegExp(`<\\s*(?:${activeElements.join("|")})\\b`, "iu");
  const activeMatch = source.match(activePattern);
  if (activeMatch) {
    throw new VisualArtifactError("active_source_content", `${owner} contains an active element outside this source coordinate.`, {
      owner,
      element: activeMatch[0].replace(/^<\s*/u, ""),
    });
  }
  const eventMatch = source.match(/\s((?:[A-Za-z][A-Za-z0-9_.-]*:)?on[A-Za-z][A-Za-z0-9_.:-]*)\s*=/iu);
  if (eventMatch) {
    throw new VisualArtifactError("active_source_content", `${owner} contains an event-handler attribute outside this source coordinate.`, {
      owner,
      attribute: eventMatch[1],
    });
  }
  if (/(?:@import\b|\bexpression\s*\()/iu.test(inspectionSource)) {
    throw new VisualArtifactError("active_source_content", `${owner} contains an active stylesheet instruction outside this source coordinate.`, {
      owner,
    });
  }
  if (/\b(?:-webkit-)?image-set\s*\(/iu.test(inspectionSource)) {
    throw new VisualArtifactError(
      "unsupported_source_syntax",
      `${owner} reserves CSS image-set() for a dedicated admitted source coordinate.`,
      { owner, syntax: "image-set" },
    );
  }
  if (rejectXmlDeclarations && /(?:<!DOCTYPE\b|<!ENTITY\b|<\?xml-stylesheet\b)/iu.test(source)) {
    throw new VisualArtifactError("active_source_content", `${owner} contains an externalizable XML declaration outside this source coordinate.`, {
      owner,
    });
  }
  if (owner === "galleryShell" && /<\s*meta\b[^>]*\bhttp-equiv\s*=\s*(?:"\s*refresh\s*"|'\s*refresh\s*'|refresh(?=\s|\/?>))/iu.test(source)) {
    throw new VisualArtifactError("active_source_content", "galleryShell contains a refresh instruction outside this source coordinate.", {
      owner,
    });
  }

  let sourceReferenceCount = 0;
  const countSourceReference = () => {
    sourceReferenceCount += 1;
    assertWithinResourceLimit(
      "sourceReferences",
      sourceReferenceCount,
      sourceReferenceLimit,
      "reduce_source_references",
    );
  };

  RESOURCE_ATTRIBUTE.lastIndex = 0;
  for (const match of source.matchAll(RESOURCE_ATTRIBUTE)) {
    countSourceReference();
    const reference = firstAttributeValue(match).trim();
    if (reference.includes("&") || !/^#[A-Za-z][A-Za-z0-9_.:-]*$/u.test(reference)) {
      throw new VisualArtifactError("external_source_reference", `${owner} resource attributes may resolve only to an in-document fragment.`, {
        owner,
        attribute: match[0].slice(0, match[0].indexOf("=")).trim(),
        reference,
      });
    }
  }

  SRCSET_ATTRIBUTE.lastIndex = 0;
  for (const match of source.matchAll(SRCSET_ATTRIBUTE)) {
    const attributeValue = firstAttributeValue(match).trim();
    const candidates = attributeValue.split(",").map((candidate) => candidate.trim());
    if (candidates.length === 0 || candidates.some((candidate) => candidate.length === 0)) {
      throw new VisualArtifactError("external_source_reference", `${owner} srcset requires explicit admitted candidates.`, {
        owner,
        attribute: "srcset",
        reference: attributeValue,
      });
    }
    for (const candidate of candidates) {
      countSourceReference();
      const [reference, ...descriptors] = candidate.split(/\s+/u);
      const descriptor = descriptors[0];
      const validDescriptor = descriptors.length === 0
        || (descriptors.length === 1 && /^(?:[1-9]\d*w|(?:\d+(?:\.\d+)?|\.\d+)x)$/u.test(descriptor));
      if (
        reference.includes("&")
        || !/^#[A-Za-z][A-Za-z0-9_.:-]*$/u.test(reference)
        || !validDescriptor
      ) {
        throw new VisualArtifactError("external_source_reference", `${owner} srcset candidates may resolve only to admitted in-document fragments.`, {
          owner,
          attribute: "srcset",
          reference: candidate,
        });
      }
    }
  }

  CSS_URL.lastIndex = 0;
  for (const match of inspectionSource.matchAll(CSS_URL)) {
    countSourceReference();
    const reference = firstAttributeValue(match).trim();
    if (!/^#[A-Za-z][A-Za-z0-9_.:-]*$/u.test(reference)) {
      throw new VisualArtifactError("external_source_reference", `${owner} stylesheet references may resolve only to an in-document fragment.`, {
        owner,
        reference,
      });
    }
  }

  const rawWithoutNamespaces = stripNamespaceDeclarations(source);
  const inspectedWithoutNamespaces = stripNamespaceDeclarations(inspectionSource);
  const privateMatch = rawWithoutNamespaces.match(PRIVATE_LOCATOR)
    ?? inspectedWithoutNamespaces.match(PRIVATE_LOCATOR);
  if (privateMatch) {
    throw new VisualArtifactError("private_source_locator", `${owner} contains a private or machine-specific locator.`, {
      owner,
      locator: privateMatch[0],
    });
  }
  const externalMatch = rawWithoutNamespaces.match(EXTERNAL_LOCATOR)
    ?? inspectedWithoutNamespaces.match(EXTERNAL_LOCATOR);
  if (externalMatch) {
    throw new VisualArtifactError("external_source_reference", `${owner} contains a network or file locator outside this source coordinate.`, {
      owner,
      locator: externalMatch[0],
    });
  }
  const elements = [...source.matchAll(/<\s*\/?\s*([A-Za-z][A-Za-z0-9:-]*)\b/gu)]
    .map((match) => owner === "galleryShell" ? match[1].toLowerCase() : match[1]);
  const unsupported = [...new Set(elements.filter((element) => !allowedElements.has(element)))].sort();
  if (unsupported.length > 0) {
    throw new VisualArtifactError("unsupported_source_element", `${owner} contains elements outside its static source subset.`, {
      owner,
      elements: unsupported,
    });
  }
  return Object.freeze({ elements: [...new Set(elements)].sort() });
}

export function validateContract(candidate, { limits: limitOverrides } = {}) {
  const limits = normalizeResourceLimits(limitOverrides);
  assertRecord(candidate, "contract");
  const unknown = Object.keys(candidate).filter((key) => !CONTRACT_KEYS.has(key));
  if (unknown.length > 0) {
    throw new VisualArtifactError("unknown_contract_key", "The contract contains unsupported fields.", { fields: unknown.sort() });
  }
  if (candidate.schemaVersion !== "0.1.0") {
    throw new VisualArtifactError("unsupported_schema", "The contract schema version requires an explicit adapter.", { observed: candidate.schemaVersion });
  }
  const contract = {
    ...candidate,
    artifactId: requireText(candidate.artifactId, "artifactId"),
    title: requireText(candidate.title, "title"),
    description: requireText(candidate.description, "description"),
    alt: requireText(candidate.alt, "alt"),
    caption: requireText(candidate.caption, "caption"),
    outputBaseName: requireText(candidate.outputBaseName, "outputBaseName"),
    outputMediaType: requireText(candidate.outputMediaType, "outputMediaType"),
    metadataPolicy: requireText(candidate.metadataPolicy, "metadataPolicy"),
    fontCoordinate: requireText(candidate.fontCoordinate, "fontCoordinate"),
    sourceStanding: requireText(candidate.sourceStanding, "sourceStanding"),
    rightsStanding: requireText(candidate.rightsStanding, "rightsStanding"),
    owner: requireText(candidate.owner, "owner"),
  };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(contract.artifactId)) {
    throw new VisualArtifactError("invalid_artifact_id", "artifactId must use lowercase semantic-id syntax.");
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(contract.outputBaseName)) {
    throw new VisualArtifactError("unsafe_output_name", "outputBaseName must remain a contained semantic identifier.");
  }
  if (contract.outputMediaType !== "image/webp") {
    throw new VisualArtifactError("unsupported_media_type", "This coordinate emits the declared WebP media type.", {
      observed: contract.outputMediaType,
    });
  }
  if (contract.metadataPolicy !== "strip_and_inspect") {
    throw new VisualArtifactError("unsupported_metadata_policy", "This coordinate strips derivative metadata and inspects the emitted files.", {
      observed: contract.metadataPolicy,
    });
  }
  if (contract.alt === contract.caption) {
    throw new VisualArtifactError("collapsed_description", "Alternative text and caption must serve distinct reading jobs.");
  }
  assertRecord(contract.intrinsic, "intrinsic");
  for (const axis of ["width", "height"]) {
    if (!Number.isSafeInteger(contract.intrinsic[axis]) || contract.intrinsic[axis] <= 0) {
      throw new VisualArtifactError("invalid_dimension", `intrinsic.${axis} must be a positive integer.`, { axis });
    }
  }
  assertWithinResourceLimit(
    "intrinsicPixels",
    contract.intrinsic.width * contract.intrinsic.height,
    limits.intrinsicPixels,
    "reduce_intrinsic_dimensions",
  );
  if (!Array.isArray(contract.widths) || contract.widths.length === 0) {
    throw new VisualArtifactError("missing_widths", "widths must name at least one derivative.");
  }
  assertWithinResourceLimit("widths", contract.widths.length, limits.widths, "reduce_derivative_widths");
  const widths = [...new Set(contract.widths)];
  if (widths.length !== contract.widths.length || widths.some((width) => !Number.isSafeInteger(width) || width < 128 || width > 4096)) {
    throw new VisualArtifactError("invalid_widths", "widths must be unique integers from 128 through 4096.");
  }
  contract.widths = widths.sort((a, b) => a - b);
  const derivativePixels = contract.widths.reduce((total, width) => {
    const height = Math.round((width * contract.intrinsic.height) / contract.intrinsic.width);
    return total + (width * height);
  }, 0);
  assertWithinResourceLimit("derivativePixels", derivativePixels, limits.derivativePixels, "reduce_derivative_dimensions");
  if (!Array.isArray(contract.states) || contract.states.length === 0) {
    throw new VisualArtifactError("missing_states", "states must carry the semantic reading.");
  }
  assertWithinResourceLimit("states", contract.states.length, limits.states, "reduce_semantic_states");
  const stateIds = new Set();
  contract.states = contract.states.map((state, index) => {
    assertRecord(state, `states[${index}]`);
    const id = requireText(state.id, `states[${index}].id`);
    if (!/^[a-z][a-z0-9-]*$/.test(id) || stateIds.has(id)) {
      throw new VisualArtifactError("invalid_state_identity", "State identities must be unique semantic tokens.", { id });
    }
    stateIds.add(id);
    return {
      id,
      label: requireText(state.label, `states[${index}].label`),
      meaning: requireText(state.meaning, `states[${index}].meaning`),
    };
  });
  if (!Array.isArray(contract.readingOrder) || contract.readingOrder.length !== stateIds.size) {
    throw new VisualArtifactError("invalid_reading_order", "readingOrder must include every state exactly once.");
  }
  const ordered = new Set(contract.readingOrder);
  if (ordered.size !== stateIds.size || [...ordered].some((id) => !stateIds.has(id))) {
    throw new VisualArtifactError("invalid_reading_order", "readingOrder must include every state exactly once.");
  }
  return Object.freeze(contract);
}

export function validateSvg(svgText, { limits: limitOverrides } = {}) {
  requireText(svgText, "svg");
  const limits = normalizeResourceLimits(limitOverrides);
  validateScriptIndependentSource(svgText, {
    owner: "svg",
    activeElements: ACTIVE_SVG_ELEMENTS,
    allowedElements: STATIC_SVG_ELEMENTS,
    rejectXmlDeclarations: true,
    sourceReferenceLimit: limits.sourceReferences,
  });
  if (!/<svg\b[^>]*\bviewBox="[^"]+"/.test(svgText) || !/<svg\b[^>]*\brole="img"/.test(svgText)) {
    throw new VisualArtifactError("svg_semantics", "SVG requires a viewBox and image role.");
  }
  const labelMatch = svgText.match(/<svg\b[^>]*\baria-labelledby="([^"]+)"/);
  if (!labelMatch) {
    throw new VisualArtifactError("svg_semantics", "SVG requires title and description references.");
  }
  const ids = [...svgText.matchAll(/\bid="([A-Za-z][A-Za-z0-9_.:-]*)"/g)].map((match) => match[1]);
  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    const repeated = ids.find((id, index) => ids.indexOf(id) !== index);
    throw new VisualArtifactError("repeated_svg_id", "SVG instance identities must be unique.", { id: repeated });
  }
  const refs = new Set(labelMatch[1].trim().split(/\s+/));
  for (const match of svgText.matchAll(/url\(#([A-Za-z][A-Za-z0-9_.:-]*)\)/g)) refs.add(match[1]);
  for (const match of svgText.matchAll(/\b(?:href|xlink:href)="#([A-Za-z][A-Za-z0-9_.:-]*)"/g)) refs.add(match[1]);
  const missing = [...refs].filter((id) => !unique.has(id));
  if (missing.length > 0) {
    throw new VisualArtifactError("missing_svg_reference", "SVG references must resolve within the same instance.", { ids: missing.sort() });
  }
  const connectorIndex = svgText.indexOf('data-layer="connectors"');
  const cardIndex = svgText.indexOf('data-layer="cards"');
  if (connectorIndex < 0 || cardIndex < 0 || connectorIndex >= cardIndex) {
    throw new VisualArtifactError("svg_painter_order", "Connector layers must precede cards in SVG painter order.");
  }
  return Object.freeze({ ids: [...unique].sort(), references: [...refs].sort(), connectorBeforeCards: true });
}

export function validateGalleryShell(shell, { limits: limitOverrides } = {}) {
  const limits = normalizeResourceLimits(limitOverrides);
  const inspection = validateScriptIndependentSource(shell, {
    owner: "galleryShell",
    activeElements: ACTIVE_GALLERY_ELEMENTS,
    allowedElements: STATIC_GALLERY_ELEMENTS,
    sourceReferenceLimit: limits.sourceReferences,
  });
  return Object.freeze({
    scriptIndependent: true,
    externalReferences: 0,
    privateLocators: 0,
    elements: inspection.elements,
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderGallery(shell, contract) {
  const largest = contract.widths.at(-1);
  const height = Math.round((largest * contract.intrinsic.height) / contract.intrinsic.width);
  const srcset = contract.widths.map((width) => `${contract.outputBaseName}-${width}.webp ${width}w`).join(", ");
  const picture = `<figure>\n      <picture>\n        <img src="${contract.outputBaseName}-${largest}.webp" srcset="${srcset}" sizes="(max-width: 48rem) 100vw, 76rem" width="${largest}" height="${height}" alt="${escapeHtml(contract.alt)}" />\n      </picture>\n      <figcaption>${escapeHtml(contract.caption)}</figcaption>\n    </figure>`;
  const rows = contract.readingOrder.map((id) => {
    const state = contract.states.find((entry) => entry.id === id);
    return `<tr><th scope="row">${escapeHtml(state.label)}</th><td>${escapeHtml(state.meaning)}</td></tr>`;
  }).join("\n        ");
  const table = `<table>\n        <thead><tr><th scope="col">Stage</th><th scope="col">Meaning</th></tr></thead>\n        <tbody>\n        ${rows}\n        </tbody>\n      </table>`;
  const replacements = new Map([
    ["{{TITLE}}", escapeHtml(contract.title)],
    ["{{DESCRIPTION}}", escapeHtml(contract.description)],
    ["{{PICTURE}}", picture],
    ["{{SEMANTIC_TABLE}}", table],
  ]);
  const missing = [...replacements.keys()].filter((marker) => !shell.includes(marker));
  if (missing.length > 0) {
    throw new VisualArtifactError("missing_gallery_marker", "The gallery shell requires every semantic publication marker.", {
      markers: missing,
    });
  }
  let html = shell;
  for (const [marker, value] of replacements) html = html.replaceAll(marker, value);
  const remaining = html.match(/\{\{[A-Z_]+\}\}/g);
  if (remaining) {
    throw new VisualArtifactError("unresolved_gallery_marker", "Gallery shell contains unresolved markers.", { markers: [...new Set(remaining)].sort() });
  }
  return html.endsWith("\n") ? html : `${html}\n`;
}

async function describeFile(root, relativePath, role, mediaType, extra = {}, maxBytes = DEFAULT_RESOURCE_LIMITS.outputBytes) {
  const bytes = await readBoundedFile(
    path.join(root, relativePath),
    "outputBytes",
    maxBytes,
    { owner: `generated output ${relativePath}`, restartAt: "reduce_output_family" },
  );
  return { role, path: relativePath, declaredMediaType: mediaType, bytes: bytes.length, sha256: sha256(bytes), ...extra };
}

async function requireNewDirectory(directory, expectedParent = null) {
  const parentPath = path.dirname(directory);
  const parentIdentity = expectedParent ?? await requirePublicationDirectory(
    parentPath,
    "output_parent",
    { create: true, recursive: true },
  );
  if (path.resolve(parentIdentity.directory) !== path.resolve(parentPath)) {
    throw publicationBoundaryError("output_parent", "unexpected_parent_coordinate");
  }
  await assertPublicationDirectory(parentIdentity);
  try {
    // The non-recursive leaf creation is the ownership transition. A separate
    // existence check would let two compilers both accept the same candidate.
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new VisualArtifactError("output_exists", "The output directory must be a fresh candidate boundary.", { directory });
    }
    throw error;
  }
  await assertPublicationDirectory(parentIdentity);
  const identity = await requirePublicationDirectory(directory, "candidate_output");
  return { identity, parentIdentity };
}

async function compileArtifactFamilyInternal({
  contractPath,
  svgPath,
  galleryShellPath,
  outputDir,
  faultAt,
  limits: limitOverrides,
  faultInjector,
  outputParentIdentity = null,
}, ownershipJournal = null) {
  if (faultInjector !== undefined && typeof faultInjector !== "function") {
    throw new VisualArtifactError(
      "invalid_fault_injector",
      "The output fault injector requires an async-compatible function.",
      { checkpoint: "compiler_input" },
    );
  }
  const startedAt = performance.now();
  const limits = normalizeResourceLimits(limitOverrides);
  const [contractBytes, svgBytes, shellBytes] = await Promise.all([
    readBoundedFile(contractPath, "contractBytes", limits.contractBytes),
    readBoundedFile(svgPath, "svgBytes", limits.svgBytes),
    readBoundedFile(galleryShellPath, "galleryShellBytes", limits.galleryShellBytes),
  ]);
  const inputBytes = contractBytes.length + svgBytes.length + shellBytes.length;
  assertWithinResourceLimit("totalSourceBytes", inputBytes, limits.totalSourceBytes, "reduce_source_bytes");
  let contractCandidate;
  try {
    contractCandidate = JSON.parse(contractBytes);
  } catch (error) {
    throw new VisualArtifactError("invalid_contract_json", "The source contract must contain valid JSON.", {
      cause: error.message,
    });
  }
  const contract = validateContract(contractCandidate, { limits });
  const svgText = svgBytes.toString("utf8");
  const svgInspection = validateSvg(svgText, { limits });
  const shell = shellBytes.toString("utf8");
  validateGalleryShell(shell, { limits });

  const semantic = {
    schemaVersion: "0.1.0",
    artifactId: contract.artifactId,
    title: contract.title,
    description: contract.description,
    alt: contract.alt,
    caption: contract.caption,
    readingOrder: contract.readingOrder,
    states: contract.readingOrder.map((id) => contract.states.find((state) => state.id === id)),
    sourceStanding: contract.sourceStanding,
    rightsStanding: contract.rightsStanding,
    owner: contract.owner,
  };
  const semanticBytes = Buffer.from(stableJson(semantic));
  const galleryBytes = Buffer.from(renderGallery(shell, contract));
  assertWithinResourceLimit(
    "outputBytes",
    svgBytes.length + semanticBytes.length + galleryBytes.length,
    limits.outputBytes,
    "reduce_output_family",
  );

  const { identity: outputIdentity, parentIdentity: outputParent } = await requireNewDirectory(
    outputDir,
    outputParentIdentity,
  );
  if (ownershipJournal) {
    ownershipJournal.directoryIdentity = outputIdentity;
    ownershipJournal.parentIdentity = outputParent;
  }
  await faultInjector?.(Object.freeze({
    checkpoint: "candidate_created",
    outputDir,
  }));
  let emittedOutputBytes = 0;
  const outputIdentities = [];
  const writeBoundedOutput = async (relativePath, bytes) => {
    const payload = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const nextTotal = emittedOutputBytes + payload.length;
    assertWithinResourceLimit("outputBytes", nextTotal, limits.outputBytes, "reduce_output_family");
    await assertPublicationDirectory(outputParent);
    await assertPublicationDirectory(outputIdentity);
    // Every write re-establishes the identity of the files already admitted to
    // this private candidate. A replaced leaf therefore stops the next write
    // instead of letting the compiler continue inside a mixed-owner boundary.
    for (const identity of outputIdentities) await assertPublicationFile(identity);
    const outputPath = path.join(outputDir, relativePath);
    const outputFileIdentity = await writeOwnedPublicationFile(
      outputPath,
      payload,
      `candidate_output.${relativePath}`,
      { cleanupRoot: outputIdentity },
    );
    await assertPublicationDirectory(outputParent);
    await assertPublicationDirectory(outputIdentity);
    for (const identity of outputIdentities) await assertPublicationFile(identity);
    await assertPublicationFile(outputFileIdentity);
    outputIdentities.push(outputFileIdentity);
    if (ownershipJournal) ownershipJournal.fileIdentities = outputIdentities;
    emittedOutputBytes = nextTotal;
    await faultInjector?.(Object.freeze({
      checkpoint: "candidate_output_written",
      outputDir,
      relativePath,
    }));
  };
  await writeBoundedOutput("source.svg", svgBytes);
  await writeBoundedOutput("semantic-companion.json", semanticBytes);

  const derivativeRecords = [];
  for (const width of contract.widths) {
    const relativePath = `${contract.outputBaseName}-${width}.webp`;
    const derivativeBytes = await sharp(svgBytes)
      .resize({ width, fit: "contain", withoutEnlargement: false })
      .webp({ quality: 88, effort: 6, smartSubsample: true })
      .toBuffer();
    const metadata = await sharp(derivativeBytes).metadata();
    if (metadata.format !== "webp" || metadata.width !== width) {
      throw new VisualArtifactError("derivative_shape", "Generated derivative must match its declared media type and width.", { relativePath, metadata });
    }
    const expectedHeight = Math.round((width * contract.intrinsic.height) / contract.intrinsic.width);
    if (metadata.height !== expectedHeight) {
      throw new VisualArtifactError("derivative_shape", "Generated derivative must retain the declared aspect ratio.", { relativePath, expectedHeight, actualHeight: metadata.height });
    }
    const metadataFields = ["exif", "icc", "iptc", "xmp"].filter((field) => metadata[field]);
    if (metadataFields.length > 0) {
      throw new VisualArtifactError("embedded_metadata", "Generated derivatives must carry the declared clean metadata standing.", { relativePath, metadataFields });
    }
    // Encode inside the admitted pixel envelope, then account for the encoded
    // bytes before the candidate filesystem receives them.
    await writeBoundedOutput(relativePath, derivativeBytes);
    derivativeRecords.push({
      role: "responsive_derivative",
      path: relativePath,
      declaredMediaType: "image/webp",
      bytes: derivativeBytes.byteLength,
      sha256: sha256(derivativeBytes),
      width: metadata.width,
      height: metadata.height,
    });
    if (faultAt === "after_first_derivative" && derivativeRecords.length === 1) {
      throw new VisualArtifactError("injected_fault", "The injected fault stopped after the first derivative.", {
        checkpoint: "first_derivative_written",
      });
    }
  }

  await writeBoundedOutput("gallery.html", galleryBytes);
  const records = [
    await describeFile(outputDir, "source.svg", "source_vector", "image/svg+xml", { svgInspection }, limits.outputBytes),
    await describeFile(outputDir, "semantic-companion.json", "semantic_companion", "application/json", {}, limits.outputBytes),
    await describeFile(outputDir, "gallery.html", "accessible_gallery", "text/html", {}, limits.outputBytes),
    ...derivativeRecords,
  ];
  const source = {
    contractSha256: sha256(contractBytes),
    svgSha256: sha256(svgBytes),
    galleryShellSha256: sha256(shellBytes),
  };
  source.aggregateSha256 = sha256(Buffer.from(stableJson(source)));
  const manifest = {
    schemaVersion: "0.1.0",
    artifactId: contract.artifactId,
    source,
    runtime: {
      node: process.versions.node,
      platform: process.platform,
      osRelease: osRelease(),
      architecture: process.arch,
      libc: runtimeLibcCoordinate(),
      sharp: sharp.versions.sharp,
      libvips: sharp.versions.vips,
    },
    rightsStanding: contract.rightsStanding,
    outputMediaType: contract.outputMediaType,
    metadataPolicy: contract.metadataPolicy,
    fontCoordinate: contract.fontCoordinate,
    sourceAdmission: {
      standing: "static_self_contained",
      localReferenceForm: "#semantic-id",
    },
    resourceLimits: limits,
    metadataStanding: "inspected_clean",
    outputs: records.sort((a, b) => compareOrdinalText(a.path, b.path)),
  };
  const manifestBytes = Buffer.from(stableJson(manifest));
  await writeBoundedOutput("manifest.json", manifestBytes);
  await assertPublicationDirectory(outputParent);
  await assertPublicationDirectory(outputIdentity);
  for (const identity of outputIdentities) await assertPublicationFile(identity);
  const measurement = Object.freeze({
    inputBytes,
    outputBytes: emittedOutputBytes,
    elapsedMilliseconds: Number((performance.now() - startedAt).toFixed(3)),
    maxRssKiB: process.resourceUsage().maxRSS,
    sourceFamilies: 1,
    derivativeWidths: contract.widths.length,
  });
  return Object.freeze({ contract, manifest, manifestDigest: sha256(manifestBytes), measurement, outputDir });
}

export async function compileArtifactFamily(options) {
  return compileArtifactFamilyInternal(options);
}

function acceptedIntegrityMismatch(message, details = {}) {
  return new VisualArtifactError("accepted_integrity_mismatch", message, {
    checkpoint: "existing_accepted_verified",
    ...details,
  });
}

function publicationBoundaryError(boundary, reason) {
  return new VisualArtifactError(
    "publication_boundary_invalid",
    "Artifact publication requires stable, directly addressed regular directories.",
    { checkpoint: "publication_root", boundary, reason },
  );
}

async function requirePublicationDirectory(directory, boundary, { create = false, recursive = false } = {}) {
  if (create) {
    try {
      await mkdir(directory, { recursive });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  let entry;
  try {
    entry = await lstat(directory);
  } catch (error) {
    throw publicationBoundaryError(boundary, error.code ?? "unreadable");
  }
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw publicationBoundaryError(boundary, "regular_directory_required");
  }
  return { directory, boundary, dev: entry.dev, ino: entry.ino };
}

async function assertPublicationDirectory(identity) {
  let entry;
  try {
    entry = await lstat(identity.directory);
  } catch (error) {
    throw publicationBoundaryError(identity.boundary, error.code ?? "unreadable");
  }
  if (
    !entry.isDirectory()
    || entry.isSymbolicLink()
    || entry.dev !== identity.dev
    || entry.ino !== identity.ino
  ) {
    throw publicationBoundaryError(identity.boundary, "directory_identity_changed");
  }
}

async function writeOwnedPublicationFile(filePath, bytes, boundary, { cleanupRoot = null } = {}) {
  const flags = fsConstants.O_WRONLY
    | fsConstants.O_CREAT
    | fsConstants.O_EXCL
    | (fsConstants.O_NOFOLLOW ?? 0);
  let handle;
  let openedIdentity = null;
  let primaryError = null;
  try {
    handle = await open(filePath, flags, 0o600);
    const opened = await handle.stat();
    if (!opened.isFile()) throw publicationBoundaryError(boundary, "regular_file_required");
    openedIdentity = {
      path: filePath,
      boundary,
      dev: opened.dev,
      ino: opened.ino,
      size: null,
    };
    await handle.writeFile(bytes);
    await handle.sync();
    const settled = await handle.stat();
    if (
      !settled.isFile()
      || settled.dev !== opened.dev
      || settled.ino !== opened.ino
      || settled.size !== bytes.byteLength
    ) {
      throw publicationBoundaryError(boundary, "file_identity_changed");
    }
    return {
      path: filePath,
      boundary,
      dev: settled.dev,
      ino: settled.ino,
      size: settled.size,
    };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await handle?.close();
    } catch (error) {
      if (!primaryError) throw error;
    }
    if (primaryError && cleanupRoot) {
      await removeOwnedPublicationFile(openedIdentity, cleanupRoot);
    }
  }
}

async function requirePublicationFileIdentity(filePath, boundary) {
  let entry;
  try {
    entry = await lstat(filePath);
  } catch (error) {
    throw publicationBoundaryError(boundary, error.code ?? "unreadable");
  }
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw publicationBoundaryError(boundary, "regular_file_required");
  }
  return { path: filePath, boundary, dev: entry.dev, ino: entry.ino, size: entry.size };
}

async function assertPublicationFile(identity) {
  let entry;
  try {
    entry = await lstat(identity.path);
  } catch (error) {
    throw publicationBoundaryError(identity.boundary, error.code ?? "unreadable");
  }
  if (
    !entry.isFile()
    || entry.isSymbolicLink()
    || entry.dev !== identity.dev
    || entry.ino !== identity.ino
    || (identity.size !== null && entry.size !== identity.size)
  ) {
    throw publicationBoundaryError(identity.boundary, "file_identity_changed");
  }
}

async function assertPublicationFileBytes(identity, expectedBytes) {
  await assertPublicationFile(identity);
  const observedBytes = await readBoundedFile(
    identity.path,
    "publicationBytes",
    expectedBytes.byteLength,
    {
      expectedBytes: expectedBytes.byteLength,
      owner: identity.boundary,
      restartAt: "rebuild_publication_coordinate",
    },
  );
  if (!observedBytes.equals(expectedBytes)) {
    throw publicationBoundaryError(identity.boundary, "file_bytes_changed");
  }
  await assertPublicationFile(identity);
}

async function removeOwnedPublicationFile(identity, root) {
  if (!identity) return;
  try {
    await assertPublicationDirectory(root);
    await assertPublicationFile(identity);
    await rm(identity.path);
  } catch {
    // A changed file stays in place for operator inspection; path cleanup would
    // otherwise risk removing a coordinate this invocation never created.
  }
}

async function acquirePublicationReservation(parent, reservationPath) {
  await assertPublicationDirectory(parent);
  try {
    await mkdir(reservationPath, { mode: 0o700 });
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new VisualArtifactError(
        "publication_busy",
        "Another publisher owns the accepted-coordinate reservation.",
        { checkpoint: "candidate_promotion", restartAt: "retry_publication" },
      );
    }
    throw error;
  }
  await assertPublicationDirectory(parent);
  return requirePublicationDirectory(reservationPath, "accepted_reservation");
}

async function releasePublicationReservation(identity, parent, root) {
  if (!identity) return;
  await removeOwnedEmptyDirectory(identity, parent, root);
}

async function removeOwnedEmptyDirectory(identity, parent, root) {
  if (!identity) return;
  try {
    await assertPublicationDirectory(root);
    await assertPublicationDirectory(parent);
    await assertPublicationDirectory(identity);
    await rmdir(identity.directory);
  } catch {
    // A changed owner boundary turns path-based cleanup into an unsafe write.
    // The stable publication root remains the recovery coordinate.
  }
}

async function removeOwnedCandidate(ownership, root) {
  if (!ownership?.directoryIdentity || !ownership.parentIdentity) return;
  for (const identity of [...ownership.fileIdentities].reverse()) {
    try {
      await assertPublicationDirectory(root);
      await assertPublicationDirectory(ownership.parentIdentity);
      await assertPublicationDirectory(ownership.directoryIdentity);
      await assertPublicationFile(identity);
      await rm(identity.path);
    } catch {
      // Preserve a changed leaf and its candidate boundary for inspection.
      // Recursive path cleanup could cross into a replacement coordinate.
    }
  }
  await removeOwnedEmptyDirectory(
    ownership.directoryIdentity,
    ownership.parentIdentity,
    root,
  );
}

function containedAcceptedPath(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  if (resolvedPath === resolvedRoot || !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw acceptedIntegrityMismatch("The existing accepted artifact inventory contains an escaped path.", { relativePath });
  }
  return resolvedPath;
}

function acceptedInventoryEnvelope(paths) {
  const directories = new Set();
  let maxDepth = 0;
  for (const outputPath of paths) {
    const segments = outputPath.split("/");
    maxDepth = Math.max(maxDepth, segments.length - 1);
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join("/"));
    }
  }
  return { maxDepth, maxEntries: paths.length + directories.size };
}

async function acceptedFileInventory(root, { maxDepth, maxEntries }) {
  const inventory = [];
  const rootEntry = await lstat(root).catch(() => null);
  if (!rootEntry?.isDirectory() || rootEntry.isSymbolicLink()) {
    throw acceptedIntegrityMismatch("The existing accepted artifact requires one regular directory.");
  }
  const pending = [{ directory: root, depth: 0 }];
  let observedEntries = 0;
  while (pending.length > 0) {
    const { directory, depth } = pending.pop();
    const handle = await opendir(directory);
    try {
      for await (const entry of handle) {
        observedEntries += 1;
        if (observedEntries > maxEntries) {
          throw acceptedIntegrityMismatch("The existing accepted artifact inventory exceeds its declared finite envelope.", { maxEntries });
        }
        const absolutePath = containedAcceptedPath(root, path.relative(root, path.join(directory, entry.name)));
        const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
        const pathEntry = await lstat(absolutePath);
        if (pathEntry.isSymbolicLink()) {
          throw acceptedIntegrityMismatch("The existing accepted artifact inventory requires regular files and directories.", {
            relativePath,
          });
        }
        if (pathEntry.isDirectory()) {
          const nextDepth = depth + 1;
          if (nextDepth > maxDepth) {
            throw acceptedIntegrityMismatch("The existing accepted artifact inventory exceeds its declared directory depth.", {
              relativePath,
              maxDepth,
            });
          }
          pending.push({ directory: absolutePath, depth: nextDepth });
        } else if (pathEntry.isFile()) inventory.push(relativePath);
        else {
          throw acceptedIntegrityMismatch("The existing accepted artifact inventory requires regular files and directories.", {
            relativePath,
          });
        }
      }
    } finally {
      await handle.close().catch(error => {
        if (error.code !== "ERR_DIR_CLOSED") throw error;
      });
    }
  }
  return inventory.sort();
}

async function readAcceptedFile(acceptedDir, relativePath, expectedBytes) {
  const outputPath = containedAcceptedPath(acceptedDir, relativePath);
  try {
    return await readBoundedFile(outputPath, "acceptedOutputBytes", expectedBytes, {
      expectedBytes,
      owner: `accepted output ${relativePath}`,
      restartAt: "rebuild_candidate",
    });
  } catch (error) {
    throw acceptedIntegrityMismatch("The existing accepted output bytes differ from the verified manifest.", {
      relativePath,
      causeCode: error.code,
      cause: error.message,
    });
  }
}

async function verifyExistingAcceptedDirectory({ acceptedDir, manifest, manifestDigest }) {
  const expectedManifestBytes = Buffer.from(stableJson(manifest));
  const manifestBytes = await readAcceptedFile(acceptedDir, "manifest.json", expectedManifestBytes.byteLength);
  if (sha256(manifestBytes) !== manifestDigest) {
    throw acceptedIntegrityMismatch("The existing accepted manifest bytes differ from the content-addressed digest.", {
      relativePath: "manifest.json",
    });
  }
  let storedManifest;
  try {
    storedManifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch (error) {
    throw acceptedIntegrityMismatch("The existing accepted manifest requires valid JSON.", {
      relativePath: "manifest.json",
      cause: error.message,
    });
  }
  if (stableJson(storedManifest) !== stableJson(manifest)) {
    throw acceptedIntegrityMismatch("The existing accepted manifest differs from the verified candidate manifest.", {
      relativePath: "manifest.json",
    });
  }

  const expectedInventory = ["manifest.json", ...manifest.outputs.map((output) => output.path)].sort();
  const observedInventory = await acceptedFileInventory(
    acceptedDir,
    acceptedInventoryEnvelope(expectedInventory),
  );
  if (stableJson(observedInventory) !== stableJson(expectedInventory)) {
    throw acceptedIntegrityMismatch("The existing accepted artifact inventory differs from the verified manifest.", {
      expectedInventory,
      observedInventory,
    });
  }

  for (const output of manifest.outputs) {
    const outputBytes = await readAcceptedFile(acceptedDir, output.path, output.bytes);
    if (outputBytes.byteLength !== output.bytes || sha256(outputBytes) !== output.sha256) {
      throw acceptedIntegrityMismatch("The existing accepted output bytes differ from the verified manifest.", {
        relativePath: output.path,
      });
    }
  }
}

async function captureAcceptedFileIdentities({ acceptedDir, manifest }) {
  const relativePaths = ["manifest.json", ...manifest.outputs.map((output) => output.path)];
  const identities = [];
  for (const relativePath of relativePaths) {
    identities.push(await requirePublicationFileIdentity(
      containedAcceptedPath(acceptedDir, relativePath),
      `accepted_file.${relativePath}`,
    ));
  }
  return identities;
}

async function assertAcceptedFileIdentities(identities) {
  for (const identity of identities) await assertPublicationFile(identity);
}

export async function publishArtifactFamily({
  contractPath,
  svgPath,
  galleryShellPath,
  publicationRoot,
  faultAt,
  limits,
  checkpointObserver,
  faultInjector,
}) {
  if (checkpointObserver !== undefined && typeof checkpointObserver !== "function") {
    throw new VisualArtifactError(
      "invalid_checkpoint_observer",
      "The checkpoint observer requires an async-compatible function.",
      { checkpoint: "publication_input" },
    );
  }
  if (faultInjector !== undefined && typeof faultInjector !== "function") {
    throw new VisualArtifactError(
      "invalid_fault_injector",
      "The publication fault injector requires an async-compatible function.",
      { checkpoint: "publication_input" },
    );
  }
  const absolutePublicationRoot = path.resolve(publicationRoot);
  const candidateParentPath = path.join(absolutePublicationRoot, ".candidates");
  const acceptedParentPath = path.join(absolutePublicationRoot, "accepted");
  const rootIdentity = await requirePublicationDirectory(
    absolutePublicationRoot,
    "root",
    { create: true, recursive: true },
  );
  const candidateParent = await requirePublicationDirectory(
    candidateParentPath,
    ".candidates",
    { create: true },
  );
  const acceptedParent = await requirePublicationDirectory(
    acceptedParentPath,
    "accepted",
    { create: true },
  );
  await assertPublicationDirectory(rootIdentity);
  const nonce = `${process.pid}-${randomUUID()}`;
  const candidateDir = path.join(candidateParentPath, nonce);
  let candidateIdentity;
  let acceptedDir;
  let pointerTempIdentity;
  let reservationIdentity;
  const pointerPath = path.join(absolutePublicationRoot, "accepted-pointer.json");
  const pointerTempPath = path.join(absolutePublicationRoot, `.accepted-pointer-${nonce}.tmp`);
  const candidateOwnership = {
    directoryIdentity: null,
    parentIdentity: candidateParent,
    fileIdentities: [],
  };
  try {
    const compiled = await compileArtifactFamilyInternal({
      contractPath,
      svgPath,
      galleryShellPath,
      outputDir: candidateDir,
      faultAt,
      limits,
      faultInjector,
      outputParentIdentity: candidateParent,
    }, candidateOwnership);
    candidateIdentity = candidateOwnership.directoryIdentity;
    await verifyExistingAcceptedDirectory({
      acceptedDir: candidateDir,
      manifest: compiled.manifest,
      manifestDigest: compiled.manifestDigest,
    });
    if (faultAt === "after_candidate_verification") {
      throw new VisualArtifactError("injected_fault", "The injected fault stopped after candidate verification.", { checkpoint: "candidate_verified" });
    }
    acceptedDir = path.join(acceptedParentPath, compiled.manifestDigest);
    await faultInjector?.(Object.freeze({
      checkpoint: "before_candidate_rename",
      root: absolutePublicationRoot,
      candidateParent: candidateParentPath,
      candidateDir,
      acceptedParent: acceptedParentPath,
      acceptedDir,
    }));
    await assertPublicationDirectory(rootIdentity);
    await assertPublicationDirectory(candidateParent);
    await assertPublicationDirectory(acceptedParent);
    await assertPublicationDirectory(candidateIdentity);
    const reservationPath = path.join(acceptedParentPath, `.${compiled.manifestDigest}.reservation`);
    reservationIdentity = await acquirePublicationReservation(acceptedParent, reservationPath);
    try {
      await assertPublicationDirectory(rootIdentity);
      await assertPublicationDirectory(candidateParent);
      await assertPublicationDirectory(acceptedParent);
      await assertPublicationDirectory(candidateIdentity);
      const existingDestination = await lstat(acceptedDir).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (existingDestination === null) {
        await rename(candidateDir, acceptedDir);
      } else {
        await removeOwnedCandidate(candidateOwnership, rootIdentity);
      }
      candidateIdentity = null;
      candidateOwnership.directoryIdentity = null;
    } finally {
      await releasePublicationReservation(reservationIdentity, acceptedParent, rootIdentity);
      reservationIdentity = null;
    }
    const acceptedIdentity = await requirePublicationDirectory(acceptedDir, "accepted_destination");
    await assertPublicationDirectory(acceptedParent);
    await verifyExistingAcceptedDirectory({
      acceptedDir,
      manifest: compiled.manifest,
      manifestDigest: compiled.manifestDigest,
    });
    const acceptedFileIdentities = await captureAcceptedFileIdentities({
      acceptedDir,
      manifest: compiled.manifest,
    });
    await checkpointObserver?.(Object.freeze({
      checkpoint: "accepted_bytes_verified",
      manifestDigest: compiled.manifestDigest,
      acceptedDir,
    }));
    if (faultAt === "after_accept_before_pointer") {
      throw new VisualArtifactError("injected_fault", "The injected fault stopped before pointer promotion.", { checkpoint: "accepted_bytes_verified" });
    }
    const pointer = {
      schemaVersion: "0.1.0",
      artifactId: compiled.contract.artifactId,
      manifestDigest: compiled.manifestDigest,
      relativePath: path.posix.join("accepted", compiled.manifestDigest),
    };
    const pointerBytes = Buffer.from(stableJson(pointer));
    pointerTempIdentity = await writeOwnedPublicationFile(
      pointerTempPath,
      pointerBytes,
      "temporary_pointer",
      { cleanupRoot: rootIdentity },
    );
    await faultInjector?.(Object.freeze({
      checkpoint: "before_pointer_rename",
      root: absolutePublicationRoot,
      acceptedParent: acceptedParentPath,
      acceptedDir,
      pointerPath,
      pointerTempPath,
    }));
    await assertPublicationDirectory(rootIdentity);
    await assertPublicationDirectory(acceptedParent);
    await assertPublicationDirectory(acceptedIdentity);
    await assertAcceptedFileIdentities(acceptedFileIdentities);
    await verifyExistingAcceptedDirectory({
      acceptedDir,
      manifest: compiled.manifest,
      manifestDigest: compiled.manifestDigest,
    });
    await assertPublicationDirectory(rootIdentity);
    await assertPublicationDirectory(acceptedParent);
    await assertPublicationDirectory(acceptedIdentity);
    await assertAcceptedFileIdentities(acceptedFileIdentities);
    await assertPublicationFileBytes(pointerTempIdentity, pointerBytes);
    await rename(pointerTempPath, pointerPath);
    pointerTempIdentity = null;
    return Object.freeze({ ...compiled, pointer });
  } catch (error) {
    await removeOwnedPublicationFile(pointerTempIdentity, rootIdentity);
    await releasePublicationReservation(reservationIdentity, acceptedParent, rootIdentity);
    await removeOwnedCandidate(candidateOwnership, rootIdentity);
    // A digest directory becomes shared immutable state as soon as its atomic
    // rename succeeds. A later invocation may verify and publish that exact
    // directory, so this invocation owns cleanup only for its candidate and
    // temporary pointer. Unreferenced digest collection is a separate policy.
    throw error;
  }
}
