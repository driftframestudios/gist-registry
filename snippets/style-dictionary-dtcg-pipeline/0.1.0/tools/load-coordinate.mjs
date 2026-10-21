import { resolve } from "node:path";
import { mergeTokenLayers, readJson, validateTokenGraph } from "../src/contract.mjs";
import { packageRoot } from "./paths.mjs";

const basePaths = [
  "tokens/primitives.tokens.json",
  "tokens/semantics.tokens.json",
  "tokens/components.tokens.json",
];

export async function loadCoordinate({ brand, mode }) {
  const paths = [...basePaths, `tokens/variants/${brand}/${mode}.tokens.json`].map(path => resolve(packageRoot, path));
  const documents = await Promise.all(paths.map(path => readJson(path)));
  const layers = documents.map((document, index) => ({
    document,
    name: paths[index],
    role: index === documents.length - 1 ? "variant" : "source",
  }));
  const { document } = mergeTokenLayers(layers);
  const validation = validateTokenGraph(document);
  return { document, validation, paths };
}
