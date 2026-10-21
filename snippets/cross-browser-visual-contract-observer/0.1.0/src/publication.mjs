import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import {
  OBSERVER_RESOURCE_LIMITS,
  ObserverError,
  readBoundedRegularFile,
  sha256,
  stableStringify,
  validateReceipt,
} from "./contracts.mjs";
import { validateReceiptSchema } from "./receipt-schema.mjs";

function contained(root, candidate) {
  const absoluteRoot = resolve(root);
  const absoluteCandidate = resolve(root, candidate);
  if (absoluteCandidate !== absoluteRoot && !absoluteCandidate.startsWith(`${absoluteRoot}${sep}`)) {
    throw new ObserverError("PATH_ESCAPE", "Publication path must remain inside the receipt root.", { candidate, restartFrom: "candidate" });
  }
  return absoluteCandidate;
}

export function humanReceipt(receipt) {
  return `# Observation ${receipt.receiptId}\n\n- Target: ${receipt.targetId}\n- Decision: ${receipt.decisionBoundary}\n- Oracle: ${receipt.observation}\n- Result: ${receipt.result.status}\n- Source: ${receipt.source.semanticId}@${receipt.source.version} (${receipt.source.manifestKind} ${receipt.source.manifestSha256})\n- Receiver: ${receipt.receiver.semanticId}@${receipt.receiver.version} (${receipt.receiver.manifestKind} ${receipt.receiver.manifestSha256})\n- Observed subject: ${receipt.subject.path} (${receipt.subject.sha256})\n- Environment: ${receipt.environment.coordinateKind}\n- Browser: ${receipt.environment.browserName} ${receipt.environment.browserVersion} (${receipt.environment.browserRevision})\n- Standing: ${receipt.standing}\n- Restart: ${receipt.restartFrom}\n`;
}

async function walkFiles(root, directory = root) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) throw new ObserverError("ACCEPTED_INTEGRITY_MISMATCH", "Accepted receipt bytes require regular files and directories; a symbolic link was found.", { path: relative(root, path), restartFrom: "candidate" });
    if (entry.isDirectory()) paths.push(...await walkFiles(root, path));
    else if (entry.isFile()) paths.push(relative(root, path).replaceAll("\\", "/"));
    else throw new ObserverError("ACCEPTED_INTEGRITY_MISMATCH", "Accepted receipt bytes must be regular files and directories.", { path: relative(root, path), restartFrom: "candidate" });
  }
  return paths.sort();
}

async function verifyAcceptedDestination(destination, receipt) {
  const expectedInventory = ["receipt.json", "receipt.md", ...receipt.artifacts.map(artifact => artifact.path)].sort();
  let observedInventory;
  try {
    observedInventory = await walkFiles(destination);
  } catch (error) {
    if (error instanceof ObserverError) throw error;
    throw new ObserverError("ACCEPTED_INTEGRITY_MISMATCH", "Accepted receipt inventory is unreadable.", { reason: error.message, restartFrom: "candidate" });
  }
  if (stableStringify(observedInventory) !== stableStringify(expectedInventory)) {
    throw new ObserverError("ACCEPTED_INTEGRITY_MISMATCH", "Accepted receipt inventory differs from the verified candidate.", { expectedInventory, observedInventory, restartFrom: "candidate" });
  }
  const expectedFiles = new Map([
    ["receipt.json", Buffer.from(stableStringify(receipt))],
    ["receipt.md", Buffer.from(humanReceipt(receipt))],
  ]);
  for (const artifact of receipt.artifacts) expectedFiles.set(artifact.path, { sha256: artifact.sha256, bytes: artifact.bytes });
  for (const [path, expected] of expectedFiles) {
    const absolutePath = contained(destination, path);
    const entry = await lstat(absolutePath).catch(() => null);
    if (!entry?.isFile() || entry.isSymbolicLink()) throw new ObserverError("ACCEPTED_INTEGRITY_MISMATCH", "Accepted receipt entries must be regular files.", { path, restartFrom: "candidate" });
    const bytes = await readFile(absolutePath);
    const expectedDigest = Buffer.isBuffer(expected) ? sha256(expected) : expected.sha256;
    const expectedBytes = Buffer.isBuffer(expected) ? expected.byteLength : expected.bytes;
    if (bytes.byteLength !== expectedBytes || sha256(bytes) !== expectedDigest) throw new ObserverError("ACCEPTED_INTEGRITY_MISMATCH", "Accepted receipt bytes differ from the verified candidate.", { path, restartFrom: "candidate" });
  }
}

export async function publishReceipt(root, inputReceipt, { injectFault = null, artifactSources = {} } = {}) {
  validateReceipt(inputReceipt);
  const receipt = structuredClone(inputReceipt);
  validateReceiptSchema(receipt);
  const candidateRoot = contained(root, `.candidates/${receipt.receiptId}.${randomUUID()}`);
  const acceptedRoot = contained(root, "accepted");
  const candidateJson = resolve(candidateRoot, "receipt.json");
  const candidateHuman = resolve(candidateRoot, "receipt.md");
  const pointerPath = contained(root, "accepted-pointer.json");
  await mkdir(candidateRoot, { recursive: true });
  try {
    for (const artifact of receipt.artifacts) {
      const sourcePath = artifactSources[artifact.path];
      if (!sourcePath) {
        throw new ObserverError("ARTIFACT_SOURCE_REQUIRED", "Each declared artifact requires a source for byte verification.", { artifactPath: artifact.path, restartFrom: "candidate" });
      }
      const bytes = await readBoundedRegularFile(sourcePath, {
        boundary: `artifact_source.${artifact.path}`,
        maxBytes: OBSERVER_RESOURCE_LIMITS.artifactBytes,
        expectedBytes: artifact.bytes,
        restartFrom: "candidate",
      });
      if (sha256(bytes) !== artifact.sha256) {
        throw new ObserverError("ARTIFACT_DIGEST_MISMATCH", "Artifact bytes must match the declared size and digest before promotion.", { artifactPath: artifact.path, restartFrom: "candidate" });
      }
      const destination = contained(candidateRoot, artifact.path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, bytes);
    }
    await writeFile(candidateJson, stableStringify(receipt));
    await writeFile(candidateHuman, humanReceipt(receipt));
    if (injectFault === "after_candidate") throw new ObserverError("INJECTED_INTERRUPTION", "Candidate interruption requested by the test fixture.", { checkpoint: "candidate_written", restartFrom: "candidate" });
    const acceptedReceipt = { ...receipt, standing: "accepted" };
    validateReceipt(acceptedReceipt);
    validateReceiptSchema(acceptedReceipt);
    await writeFile(candidateJson, stableStringify(acceptedReceipt));
    await writeFile(candidateHuman, humanReceipt(acceptedReceipt));
    const bytes = await readFile(candidateJson);
    const receiptSha256 = sha256(bytes);
    const destination = resolve(acceptedRoot, receiptSha256);
    await mkdir(acceptedRoot, { recursive: true });
    try {
      await rename(candidateRoot, destination);
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY"].includes(error.code)) throw error;
      await rm(candidateRoot, { recursive: true, force: true });
    }
    await verifyAcceptedDestination(destination, acceptedReceipt);
    if (injectFault === "before_pointer") throw new ObserverError("INJECTED_INTERRUPTION", "Pointer interruption requested by the test fixture.", { checkpoint: "accepted_bytes_verified", restartFrom: "pointer" });
    const pointer = { schemaVersion: "0.1.0", receiptId: receipt.receiptId, receiptSha256, path: `accepted/${receiptSha256}/receipt.json` };
    const temporaryPointer = resolve(dirname(pointerPath), `.accepted-pointer.${process.pid}.${randomUUID()}.tmp`);
    await mkdir(dirname(pointerPath), { recursive: true });
    try {
      await writeFile(temporaryPointer, stableStringify(pointer));
      await rename(temporaryPointer, pointerPath);
    } finally {
      await rm(temporaryPointer, { force: true });
    }
    return pointer;
  } catch (error) {
    await rm(candidateRoot, { recursive: true, force: true });
    throw error;
  }
}
