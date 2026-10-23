import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Match direct execution by filesystem identity, including symbolic links. */
export function isDirectNodeInvocation(moduleUrl, argvEntry = process.argv[1]) {
  if (!argvEntry) return false;
  try {
    return realpathSync(resolve(argvEntry)) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
