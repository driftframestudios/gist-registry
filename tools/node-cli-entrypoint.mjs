import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Match an executable module by filesystem identity so a symbolic-link route
 * executes the same owned work as its canonical path.
 */
export function isDirectNodeInvocation(moduleUrl, argvEntry = process.argv[1]) {
  if (!argvEntry) return false;
  try {
    return realpathSync(resolve(argvEntry)) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
