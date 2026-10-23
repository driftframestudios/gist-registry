export const NODE_RUNTIME_POLICY = Object.freeze({
  engineRange: ">=22.23.4 <23 || >=24.22.1 <25 || >=26.12.1 <27",
  localDefault: "24.22.1",
  floors: Object.freeze(
    new Map([
      [22, Object.freeze([22, 23, 4])],
      [24, Object.freeze([24, 22, 1])],
      [26, Object.freeze([26, 12, 1])],
    ]),
  ),
});

export const NODE_RUNTIME_DEV_ENGINE = Object.freeze({
  name: "node",
  version: NODE_RUNTIME_POLICY.engineRange,
  onFail: "error",
});

const remediation =
  "Select Node.js 22.23.4+, 24.22.1+, or 26.12.1+ within its major line; " +
  `the reviewed local default is ${NODE_RUNTIME_POLICY.localDefault} via .nvmrc.`;

function compareTriples(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function parseNodeVersion(version) {
  const coordinate = parseNodeCoordinate(version);
  if (!coordinate || coordinate.prerelease) return null;
  return coordinate.version;
}

export function parseNodeCoordinate(version) {
  const match =
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u.exec(
      version,
    );
  if (!match) return null;
  return {
    version: match.slice(1, 4).map(Number),
    prerelease: match[4] ?? null,
    build: match[5] ?? null,
  };
}

export function assessNodeVersion(version) {
  const coordinate = parseNodeCoordinate(version);

  if (!coordinate) {
    return {
      accepted: false,
      code: "NODE_VERSION_FORMAT",
      reason: `The active version value ${JSON.stringify(version)} needs a stable major.minor.patch coordinate.`,
      remediation,
    };
  }

  if (coordinate.prerelease) {
    return {
      accepted: false,
      code: "NODE_PRERELEASE_OUTSIDE_POLICY",
      reason: `Node.js ${version} is a prerelease coordinate; production admission uses a stable release at or above the accepted floor.`,
      remediation,
    };
  }

  const parsed = coordinate.version;
  const floor = NODE_RUNTIME_POLICY.floors.get(parsed[0]);
  if (!floor) {
    return {
      accepted: false,
      code: "NODE_MAJOR_OUTSIDE_POLICY",
      reason: `Node.js ${parsed.join(".")} sits outside the supported 22, 24, and 26 release lines.`,
      remediation,
    };
  }

  if (compareTriples(parsed, floor) < 0) {
    return {
      accepted: false,
      code: "NODE_SECURITY_FLOOR",
      reason: `Node.js ${parsed.join(".")} precedes the accepted ${floor.join(".")} security floor for this release line.`,
      remediation,
    };
  }

  return {
    accepted: true,
    code: "NODE_RUNTIME_ACCEPTED",
    reason: `Node.js ${parsed.join(".")} satisfies the accepted ${floor.join(".")} security floor for this release line.`,
  };
}

export class NodeRuntimeAdmissionError extends Error {
  constructor(version, assessment) {
    super(`${assessment.code}: ${assessment.reason} Remediation: ${assessment.remediation}`);
    this.name = "NodeRuntimeAdmissionError";
    this.code = assessment.code;
    this.version = version;
    this.remediation = assessment.remediation;
  }
}

export function assertNodeRuntime({ version = process.version } = {}) {
  const assessment = assessNodeVersion(version);
  if (!assessment.accepted) throw new NodeRuntimeAdmissionError(version, assessment);
  return assessment;
}
