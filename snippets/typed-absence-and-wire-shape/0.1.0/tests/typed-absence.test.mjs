import "../node-runtime-admission.mjs";

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  WireShapeError,
  projectRoutePatch,
  routePatchPresenceMeanings,
} from "../dist/typed-absence.js";

const artifactRoot = resolve(import.meta.dirname, "..");
const execFileAsync = promisify(execFile);

async function json(relativePath) {
  return JSON.parse(await readFile(resolve(artifactRoot, relativePath), "utf8"));
}

test("the composite fixture preserves every declared presence state", async () => {
  const fixture = await json("fixtures/presence-cases.json");
  const expected = await json("expected/wire-shape.json");
  const projected = projectRoutePatch(fixture);

  assert.equal(Object.hasOwn(projected, "summary"), false);
  assert.equal(Object.hasOwn(projected, "fallbackRoute"), true);
  assert.equal(Object.hasOwn(projected, "headers"), true);
  assert.equal(Object.hasOwn(projected, "retryLimit"), true);
  assert.equal(Object.hasOwn(projected, "enabled"), true);
  assert.equal(Object.hasOwn(projected, "displayLabel"), true);
  assert.deepEqual(JSON.parse(JSON.stringify(projected)), expected);
});

test("the example emits the expected bytes", async () => {
  const expected = await readFile(
    resolve(artifactRoot, "expected/wire-shape.json"),
    "utf8",
  );
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [resolve(artifactRoot, "run-example.mjs")],
    { cwd: artifactRoot, encoding: "utf8" },
  );

  assert.equal(stderr, "");
  assert.equal(stdout, expected);
});

test("the presence-meaning map is exhaustive and keeps each meaning explicit", () => {
  assert.deepEqual(routePatchPresenceMeanings, {
    summary: "omitted-retains-current",
    fallbackRoute: "null-clears-current",
    headers: "present-object-replaces-current",
    retryLimit: "zero-disables-retry",
    enabled: "false-disables-route",
    displayLabel: "empty-string-is-intentional",
  });
  assert.equal(Object.isFrozen(routePatchPresenceMeanings), true);
});

test("projection detaches and freezes the accepted wire snapshot", () => {
  const headers = { "x-review-mode": "synthetic" };
  const projected = projectRoutePatch({ headers });

  headers["x-review-mode"] = "changed-after-projection";
  assert.deepEqual(
    { ...projected.headers },
    { "x-review-mode": "synthetic" },
  );
  assert.equal(Object.isFrozen(projected), true);
  assert.equal(Object.isFrozen(projected.headers), true);
  assert.equal(Object.getPrototypeOf(projected), null);
  assert.equal(Object.getPrototypeOf(projected.headers), null);
  assert.throws(() => {
    projected.headers["x-added-after-projection"] = "value";
  }, TypeError);
});

test("present undefined receives an error that names its field", () => {
  for (const field of Object.keys(routePatchPresenceMeanings)) {
    assert.throws(
      () => projectRoutePatch({ [field]: undefined }),
      error =>
        error instanceof WireShapeError &&
        error.field === field &&
        /JSON cannot represent/u.test(error.message),
    );
  }
});

test("non-enumerable top-level and nested properties remain outside the JSON shape", () => {
  const hiddenTopLevel = {};
  Object.defineProperty(hiddenTopLevel, "enabled", {
    enumerable: false,
    value: false,
  });
  assert.throws(
    () => projectRoutePatch(hiddenTopLevel),
    error =>
      error instanceof WireShapeError &&
      error.field === "enabled" &&
      /enumerable own data property/u.test(error.message),
  );

  const hiddenHeaders = {};
  Object.defineProperty(hiddenHeaders, "x-hidden", {
    enumerable: false,
    value: "synthetic",
  });
  assert.throws(
    () => projectRoutePatch({ headers: hiddenHeaders }),
    error =>
      error instanceof WireShapeError &&
      error.field === "headers.x-hidden" &&
      /enumerable own data property/u.test(error.message),
  );
});

test("negative zero normalizes to the JSON-stable retry meaning", () => {
  const projected = projectRoutePatch({ retryLimit: -0 });

  assert.equal(Object.is(projected.retryLimit, -0), false);
  assert.equal(projected.retryLimit, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(projected)), { retryLimit: 0 });
});

test("every admitted own property receives a wire projection", () => {
  const input = {
    summary: "synthetic route",
    fallbackRoute: null,
    headers: {},
    retryLimit: 0,
    enabled: false,
    displayLabel: "",
  };
  const projected = projectRoutePatch(input);

  assert.deepEqual(Object.keys(projected), Object.keys(input));
});

test("null belongs only to the explicit-clear field", () => {
  assert.deepEqual({ ...projectRoutePatch({ fallbackRoute: null }) }, {
    fallbackRoute: null,
  });
  for (const field of [
    "summary",
    "headers",
    "retryLimit",
    "enabled",
    "displayLabel",
  ]) {
    assert.throws(
      () => projectRoutePatch({ [field]: null }),
      error => error instanceof WireShapeError && error.field.startsWith(field),
    );
  }
});

test("unknown, symbolic, accessor, and non-record shapes are rejected", () => {
  assert.throws(() => projectRoutePatch([]), /must be a plain object/u);
  assert.throws(
    () => projectRoutePatch({ additionalField: "value" }),
    /additionalField: is not a recognized field/u,
  );
  assert.throws(
    () => projectRoutePatch({ "x-line\nsecond": "value" }),
    error =>
      error instanceof WireShapeError &&
      error.field === '["x-line\\nsecond"]' &&
      !error.message.includes("\n"),
  );
  assert.throws(
    () => projectRoutePatch({ [Symbol("field")]: "value" }),
    /is not a recognized field/u,
  );

  const accessorInput = {};
  Object.defineProperty(accessorInput, "summary", {
    enumerable: true,
    get() {
      throw new Error("the projector must not invoke this accessor");
    },
  });
  assert.throws(
    () => projectRoutePatch(accessorInput),
    /summary: must be an enumerable own data property/u,
  );
});

test("invalid field values return their exact owner", () => {
  for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => projectRoutePatch({ retryLimit: value }),
      error => error instanceof WireShapeError && error.field === "retryLimit",
    );
  }
  assert.throws(
    () => projectRoutePatch({ enabled: 0 }),
    error => error instanceof WireShapeError && error.field === "enabled",
  );
  assert.throws(
    () => projectRoutePatch({ displayLabel: false }),
    error => error instanceof WireShapeError && error.field === "displayLabel",
  );
  assert.throws(
    () => projectRoutePatch({ headers: { "x-review-mode": null } }),
    error =>
      error instanceof WireShapeError &&
      error.field === "headers.x-review-mode",
  );

  const nestedUndefined = { headers: { "x-review-mode": undefined } };
  assert.throws(
    () => projectRoutePatch(nestedUndefined),
    error =>
      error instanceof WireShapeError &&
      error.field === "headers.x-review-mode" &&
      error.path.join("/") === "headers/x-review-mode",
  );

  const accessorHeaders = {};
  Object.defineProperty(accessorHeaders, "x-review-mode", {
    enumerable: true,
    get() {
      throw new Error("the projector must not invoke this accessor");
    },
  });
  assert.throws(
    () => projectRoutePatch({ headers: accessorHeaders }),
    error =>
      error instanceof WireShapeError &&
      error.field === "headers.x-review-mode" &&
      error.path.join("/") === "headers/x-review-mode",
  );

  assert.throws(
    () => projectRoutePatch({ headers: { "x-line\nsecond": null } }),
    error =>
      error instanceof WireShapeError &&
      error.field === 'headers["x-line\\nsecond"]' &&
      !error.message.includes("\n"),
  );
});
