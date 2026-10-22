import "./node-runtime-admission.mjs";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { projectRoutePatch } from "./dist/typed-absence.js";

const fixturePath = resolve(import.meta.dirname, "fixtures/presence-cases.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const projected = projectRoutePatch(fixture);

process.stdout.write(`${JSON.stringify(projected, null, 2)}\n`);
