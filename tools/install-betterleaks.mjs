import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_RELEASE_ASSET_BYTES = 128 * 1024 * 1024;
const RELEASE_DOWNLOAD_TIMEOUT_MS = 60_000;
const TOOL_ENVIRONMENT_KEYS = [
  "COMSPEC",
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "PATH",
  "PATHEXT",
  "PSModulePath",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WINDIR",
];

export const BETTERLEAKS_RELEASE = Object.freeze({
  tool: "betterleaks",
  version: "1.8.1",
  releaseUrl: "https://github.com/betterleaks/betterleaks/releases/tag/v1.8.1",
  owner: "gist-registry:betterleaks-installer",
  receiptFormat: 1,
  assets: Object.freeze({
    "darwin-arm64": Object.freeze({
      name: "betterleaks_1.8.1_darwin_arm64.tar.gz",
      sha256: "8e80f33b5f2a7426b390347b9fd466033723cb94b6bdffa7572632e2eaec964e",
      binarySha256: "a4808e33f9e9a405198dd7196496a5777023ae1f03eac59ecf24b3e787e344d2",
      archive: "tar.gz",
    }),
    "darwin-x64": Object.freeze({
      name: "betterleaks_1.8.1_darwin_x64.tar.gz",
      sha256: "6abc37df76f881cffae406aa2cec72bea6e6ae64b4e771b3ed21b4aac472ed10",
      binarySha256: "d0aa388e456ca3eec1bc2d136fe1ac61e29d0a672dffca9f5dcd0e354fd8b959",
      archive: "tar.gz",
    }),
    "linux-arm64": Object.freeze({
      name: "betterleaks_1.8.1_linux_arm64.tar.gz",
      sha256: "bbb578b12a2f65d7082ab436abf37724232bc71d8a078e3c41336574420f1b48",
      binarySha256: "1d5e40e7ea9070393744a34f0334c435edda1a230989974734fda96fe987001b",
      archive: "tar.gz",
    }),
    "linux-x64": Object.freeze({
      name: "betterleaks_1.8.1_linux_x64.tar.gz",
      sha256: "efa407244e1ea8e35f582b8a42becdeac08bdead04f68eb752adda722d583c2a",
      binarySha256: "380a770d9ea9215e7d3b964246a72d8698b2975496addef2627d0e82b174a1f8",
      archive: "tar.gz",
    }),
    "win32-arm64": Object.freeze({
      name: "betterleaks_1.8.1_windows_arm64.zip",
      sha256: "aa12beb9ce1f6a911da91e1d0d8a72d7e68daf56a52a53f930038fd81f10f0ba",
      binarySha256: "b4b4d88ab5cc3942a10fe85f27c9443a3c6319c2963670d2afb438e36ff915fc",
      archive: "zip",
    }),
    "win32-x64": Object.freeze({
      name: "betterleaks_1.8.1_windows_x64.zip",
      sha256: "94310d028285a1bcce7f160bc19eb62f87de6460c95bfd4319151ef5b501ed3f",
      binarySha256: "727820f1a9f9264319cc50458b99f01acbb93e93df7a39b8eaa2715a7b1aaed5",
      archive: "zip",
    }),
  }),
});

export class BetterleaksInstallError extends Error {
  constructor(code, message, options) {
    super(`${code}: ${message}`, options);
    this.name = "BetterleaksInstallError";
    this.code = code;
  }
}

export function releaseAsset(platform = process.platform, arch = process.arch) {
  const key = `${platform}-${arch}`;
  const asset = BETTERLEAKS_RELEASE.assets[key];
  if (!asset) {
    throw new BetterleaksInstallError(
      "SECRET_SCANNER_PLATFORM_UNSUPPORTED",
      `Betterleaks ${BETTERLEAKS_RELEASE.version} has no pinned asset for ${key}`,
    );
  }
  return { ...asset, key };
}

export function betterleaksInstallDirectory({
  platform = process.platform,
  arch = process.arch,
  repositoryRoot = REPOSITORY_ROOT,
} = {}) {
  return join(
    repositoryRoot,
    ".tools",
    "betterleaks",
    `${BETTERLEAKS_RELEASE.version}-${platform}-${arch}`,
  );
}

export function betterleaksBinaryPath(options = {}) {
  const platform = options.platform ?? process.platform;
  return join(
    betterleaksInstallDirectory({ ...options, platform }),
    platform === "win32" ? "betterleaks.exe" : "betterleaks",
  );
}

export async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function lstatIfPresent(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function assertDirectory(path, { create = false } = {}) {
  let state = await lstatIfPresent(path);
  if (!state && create) {
    try {
      await mkdir(path);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    state = await lstatIfPresent(path);
  }
  if (state && (!state.isDirectory() || state.isSymbolicLink())) {
    throw new BetterleaksInstallError(
      "SECRET_SCANNER_INSTALL_OWNERSHIP",
      "the Betterleaks tool path crosses a non-directory or symbolic-link component",
    );
  }
  return state;
}

async function assertToolParent(repositoryRoot, { create = false } = {}) {
  const repositoryState = await assertDirectory(repositoryRoot);
  if (!repositoryState) {
    throw new BetterleaksInstallError(
      "SECRET_SCANNER_INSTALL_OWNERSHIP",
      "the repository root is unavailable",
    );
  }
  const toolsDirectory = join(repositoryRoot, ".tools");
  const toolsState = await assertDirectory(toolsDirectory, { create });
  if (!toolsState) return null;
  const toolParent = join(toolsDirectory, "betterleaks");
  const parentState = await assertDirectory(toolParent, { create });
  return parentState ? toolParent : null;
}

function toolProcessEnvironment() {
  const environment = { NO_COLOR: "1" };
  for (const key of TOOL_ENVIRONMENT_KEYS) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  return environment;
}

function runVersion(binaryPath) {
  const result = spawnSync(binaryPath, ["version"], {
    encoding: "utf8",
    env: toolProcessEnvironment(),
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}

export async function verifyBetterleaksInstall({
  platform = process.platform,
  arch = process.arch,
  repositoryRoot = REPOSITORY_ROOT,
  versionRunner = runVersion,
  binaryDigestReader = sha256File,
} = {}) {
  const asset = releaseAsset(platform, arch);
  const installDirectory = betterleaksInstallDirectory({
    platform,
    arch,
    repositoryRoot,
  });
  const binaryPath = betterleaksBinaryPath({ platform, arch, repositoryRoot });
  const receiptPath = join(installDirectory, ".install-receipt.json");
  await assertToolParent(repositoryRoot);
  const installState = await lstatIfPresent(installDirectory);

  if (!installState) {
    throw new BetterleaksInstallError(
      "SECRET_SCANNER_NOT_INSTALLED",
      "run `npm run security:secrets:install` before scanning",
    );
  }
  if (!installState.isDirectory() || installState.isSymbolicLink()) {
    throw new BetterleaksInstallError(
      "SECRET_SCANNER_INSTALL_OWNERSHIP",
      "the Betterleaks install path is not a regular tool-owned directory",
    );
  }

  const receiptState = await lstatIfPresent(receiptPath);
  if (!receiptState?.isFile() || receiptState.isSymbolicLink()) {
    throw new BetterleaksInstallError(
      "SECRET_SCANNER_INSTALL_RECEIPT",
      "the Betterleaks install receipt is unavailable or has an unexpected filesystem type",
    );
  }

  let receipt;
  try {
    receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  } catch (error) {
    throw new BetterleaksInstallError(
      "SECRET_SCANNER_INSTALL_RECEIPT",
      "the Betterleaks install receipt is unavailable or invalid",
      { cause: error },
    );
  }

  const expectedReceipt =
    receipt?.format === BETTERLEAKS_RELEASE.receiptFormat &&
    receipt?.owner === BETTERLEAKS_RELEASE.owner &&
    receipt?.tool === BETTERLEAKS_RELEASE.tool &&
    receipt?.version === BETTERLEAKS_RELEASE.version &&
    receipt?.platform === platform &&
    receipt?.arch === arch &&
    receipt?.asset === asset.name &&
    receipt?.archiveSha256 === asset.sha256 &&
    receipt?.binarySha256 === asset.binarySha256;

  if (!expectedReceipt) {
    throw new BetterleaksInstallError(
      "SECRET_SCANNER_INSTALL_RECEIPT",
      "the Betterleaks install receipt does not match the pinned release",
    );
  }

  const binaryState = await lstatIfPresent(binaryPath);
  if (!binaryState?.isFile() || binaryState.isSymbolicLink()) {
    throw new BetterleaksInstallError(
      "SECRET_SCANNER_INSTALL_BINARY",
      "the pinned Betterleaks executable is unavailable",
    );
  }
  if ((await binaryDigestReader(binaryPath)) !== asset.binarySha256) {
    throw new BetterleaksInstallError(
      "SECRET_SCANNER_INSTALL_INTEGRITY",
      "the installed Betterleaks executable differs from the pinned release evidence",
    );
  }
  if (versionRunner(binaryPath) !== BETTERLEAKS_RELEASE.version) {
    throw new BetterleaksInstallError(
      "SECRET_SCANNER_INSTALL_VERSION",
      "the installed Betterleaks executable does not report the pinned version",
    );
  }

  return {
    asset,
    binaryPath,
    binarySha256: asset.binarySha256,
    installDirectory,
    receiptPath,
    version: BETTERLEAKS_RELEASE.version,
  };
}

export async function downloadAsset(
  url,
  destination,
  {
    fetchImpl = fetch,
    maxBytes = MAX_RELEASE_ASSET_BYTES,
    timeoutMs = RELEASE_DOWNLOAD_TIMEOUT_MS,
  } = {},
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      redirect: "follow",
      headers: { "user-agent": "gist-registry-secret-boundary-installer" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new BetterleaksInstallError(
        "SECRET_SCANNER_DOWNLOAD",
        `the pinned release asset returned HTTP ${response.status}`,
      );
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new BetterleaksInstallError(
        "SECRET_SCANNER_DOWNLOAD_SIZE",
        "the pinned release asset exceeds the download boundary",
      );
    }
    if (!response.body) {
      throw new BetterleaksInstallError(
        "SECRET_SCANNER_DOWNLOAD",
        "the pinned release asset returned no response body",
      );
    }

    const file = await open(destination, "wx");
    let received = 0;
    try {
      for await (const chunk of response.body) {
        const buffer = Buffer.from(chunk);
        received += buffer.length;
        if (received > maxBytes) {
          throw new BetterleaksInstallError(
            "SECRET_SCANNER_DOWNLOAD_SIZE",
            "the pinned release asset exceeds the download boundary",
          );
        }
        await file.write(buffer);
      }
    } finally {
      await file.close();
    }
  } catch (error) {
    if (error instanceof BetterleaksInstallError) throw error;
    if (controller.signal.aborted) {
      throw new BetterleaksInstallError(
        "SECRET_SCANNER_DOWNLOAD_TIMEOUT",
        "the pinned release asset did not arrive within the download boundary",
        { cause: error },
      );
    }
    throw new BetterleaksInstallError(
      "SECRET_SCANNER_DOWNLOAD",
      "the pinned release asset could not be downloaded and retained for verification",
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function extractArchive({ archivePath, asset, destination, platform }) {
  let command = "tar";
  let args = ["-xzf", archivePath, "-C", destination];
  if (asset.archive === "zip") {
    const scriptPath = join(dirname(archivePath), "expand-betterleaks.ps1");
    await writeFile(
      scriptPath,
      `param(\n  [Parameter(Mandatory = $true)][string]$ArchivePath,\n  [Parameter(Mandatory = $true)][string]$DestinationPath\n)\n$ErrorActionPreference = "Stop"\nExpand-Archive -LiteralPath $ArchivePath -DestinationPath $DestinationPath -Force\n`,
      "utf8",
    );
    command = "powershell.exe";
    args = [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-File",
      scriptPath,
      "-ArchivePath",
      archivePath,
      "-DestinationPath",
      destination,
    ];
  }

  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: toolProcessEnvironment(),
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new BetterleaksInstallError(
      "SECRET_SCANNER_EXTRACT",
      `the verified ${platform} release asset could not be extracted`,
      { cause: result.error },
    );
  }
}

async function assertArchiveLayout(directory, executableName) {
  const expected = new Set(["LICENSE", "README.md", executableName]);
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length !== expected.size) {
    throw new BetterleaksInstallError(
      "SECRET_SCANNER_ARCHIVE_LAYOUT",
      "the verified release archive contains an unexpected file set",
    );
  }
  for (const entry of entries) {
    if (!expected.has(entry.name) || !entry.isFile() || entry.isSymbolicLink()) {
      throw new BetterleaksInstallError(
        "SECRET_SCANNER_ARCHIVE_LAYOUT",
        "the verified release archive contains an unexpected entry",
      );
    }
  }
}

export async function installBetterleaks({
  platform = process.platform,
  arch = process.arch,
  repositoryRoot = REPOSITORY_ROOT,
  downloader = downloadAsset,
} = {}) {
  try {
    return { ...(await verifyBetterleaksInstall({ platform, arch, repositoryRoot })), reused: true };
  } catch (error) {
    if (error?.code !== "SECRET_SCANNER_NOT_INSTALLED") throw error;
  }

  const asset = releaseAsset(platform, arch);
  const installDirectory = betterleaksInstallDirectory({
    platform,
    arch,
    repositoryRoot,
  });
  const toolParent = await assertToolParent(repositoryRoot, { create: true });

  const stagingDirectory = await mkdtemp(
    join(toolParent, ".betterleaks-install-"),
  );
  const archivePath = join(stagingDirectory, asset.name);
  const extractionDirectory = join(stagingDirectory, "extracted");
  const releaseUrl = `https://github.com/betterleaks/betterleaks/releases/download/v${BETTERLEAKS_RELEASE.version}/${asset.name}`;

  try {
    await mkdir(extractionDirectory);
    await downloader(releaseUrl, archivePath);
    if ((await sha256File(archivePath)) !== asset.sha256) {
      throw new BetterleaksInstallError(
        "SECRET_SCANNER_ARCHIVE_INTEGRITY",
        "the downloaded Betterleaks archive does not match the pinned SHA-256",
      );
    }

    await extractArchive({
      archivePath,
      asset,
      destination: extractionDirectory,
      platform,
    });

    const executableName = platform === "win32" ? "betterleaks.exe" : "betterleaks";
    await assertArchiveLayout(extractionDirectory, executableName);
    const stagedBinary = join(extractionDirectory, executableName);
    const binaryState = await lstatIfPresent(stagedBinary);
    if (!binaryState?.isFile() || binaryState.isSymbolicLink()) {
      throw new BetterleaksInstallError(
        "SECRET_SCANNER_ARCHIVE_LAYOUT",
        "the verified release archive did not contain the expected executable",
      );
    }
    if (platform !== "win32") await chmod(stagedBinary, 0o755);
    const stagedBinarySha256 = await sha256File(stagedBinary);
    if (stagedBinarySha256 !== asset.binarySha256) {
      throw new BetterleaksInstallError(
        "SECRET_SCANNER_ARCHIVE_INTEGRITY",
        "the extracted Betterleaks executable does not match the pinned SHA-256",
      );
    }
    if (runVersion(stagedBinary) !== BETTERLEAKS_RELEASE.version) {
      throw new BetterleaksInstallError(
        "SECRET_SCANNER_ARCHIVE_VERSION",
        "the verified release executable did not report the pinned version",
      );
    }

    const receipt = {
      format: BETTERLEAKS_RELEASE.receiptFormat,
      owner: BETTERLEAKS_RELEASE.owner,
      tool: BETTERLEAKS_RELEASE.tool,
      version: BETTERLEAKS_RELEASE.version,
      platform,
      arch,
      asset: asset.name,
      archiveSha256: asset.sha256,
      binarySha256: asset.binarySha256,
    };
    await writeFile(
      join(extractionDirectory, ".install-receipt.json"),
      `${JSON.stringify(receipt, null, 2)}\n`,
      "utf8",
    );

    try {
      await rename(extractionDirectory, installDirectory);
    } catch (error) {
      if (error?.code === "EEXIST" || error?.code === "ENOTEMPTY") {
        return {
          ...(await verifyBetterleaksInstall({ platform, arch, repositoryRoot })),
          reused: true,
        };
      }
      throw error;
    }
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }

  return {
    ...(await verifyBetterleaksInstall({ platform, arch, repositoryRoot })),
    reused: false,
  };
}

async function main() {
  const result = await installBetterleaks();
  const posture = result.reused ? "already verified" : "installed and verified";
  process.stdout.write(
    `Betterleaks ${result.version} ${posture} for ${process.platform}-${process.arch}.\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message =
      error instanceof BetterleaksInstallError
        ? error.message
        : "SECRET_SCANNER_INSTALL_FAILED: Betterleaks could not be installed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
