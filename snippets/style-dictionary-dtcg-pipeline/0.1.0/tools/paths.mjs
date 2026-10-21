import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function insidePackage(path, label = "path") {
  const resolved = resolve(path);
  if (resolved !== packageRoot && !resolved.startsWith(`${packageRoot}${sep}`)) {
    throw new Error(`${label} must remain inside the package root`);
  }
  return resolved;
}

export function parseOutputArgument(argv, fallback) {
  const index = argv.indexOf("--out");
  const value = index >= 0 ? argv[index + 1] : fallback;
  if (!value) throw new Error("--out requires a package-contained path");
  return insidePackage(resolve(packageRoot, value), "output path");
}
