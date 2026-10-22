const floors = new Map([
  [22, [22, 23, 4]],
  [24, [24, 22, 1]],
  [26, [26, 12, 1]],
]);

const remediation =
  "Select Node.js 22.23.4+, 24.22.1+, or 26.12.1+ within its major line.";

function compare(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function assertNodeRuntime(version = process.version) {
  const stable =
    /^v?(\d+)\.(\d+)\.(\d+)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.exec(version);
  const prerelease =
    /^v?\d+\.\d+\.\d+-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.test(
      version,
    );
  let code;
  let reason;
  if (prerelease) {
    code = "NODE_PRERELEASE_OUTSIDE_POLICY";
    reason = `Node.js ${version} is a prerelease coordinate; admission uses a stable release.`;
  } else if (!stable) {
    code = "NODE_VERSION_FORMAT";
    reason = `The active version value ${JSON.stringify(version)} needs a stable major.minor.patch coordinate.`;
  } else {
    const coordinate = stable.slice(1, 4).map(Number);
    const floor = floors.get(coordinate[0]);
    if (!floor) {
      code = "NODE_MAJOR_OUTSIDE_POLICY";
      reason = `Node.js ${coordinate.join(".")} sits outside the supported 22, 24, and 26 release lines.`;
    } else if (compare(coordinate, floor) < 0) {
      code = "NODE_SECURITY_FLOOR";
      reason = `Node.js ${coordinate.join(".")} precedes the accepted ${floor.join(".")} security floor.`;
    } else {
      return Object.freeze({
        code: "NODE_RUNTIME_ACCEPTED",
        version: coordinate.join("."),
      });
    }
  }

  const error = new Error(`${code}: ${reason} Remediation: ${remediation}`);
  error.name = "NodeRuntimeAdmissionError";
  error.code = code;
  error.remediation = remediation;
  throw error;
}

assertNodeRuntime();
