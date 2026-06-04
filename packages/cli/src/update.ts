import {
  buildAssetUrls,
  clearStagedUpdate,
  compareVersions,
  detectSelfUpdate,
  downloadVerified,
  loadStoredConfig,
  parseSha256Sums,
  saveStoredConfig,
  swapInPlace,
  versionLabel,
  withStagedUpdate,
} from "@luckycli/core";

export { compareVersions };

const REPO = "Fenix46/LuckyCLI";
const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const INSTALL_SCRIPT_URL = `https://raw.githubusercontent.com/${REPO}/main/install.sh`;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface GitHubRelease {
  tag_name?: string;
  html_url?: string;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  updateAvailable: boolean;
  installCommand?: string;
  checkedAt: number;
  source: "cache" | "network";
}

export async function checkForUpdate(
  currentVersion: string,
  options: { force?: boolean } = {},
): Promise<UpdateInfo> {
  const now = Date.now();
  const cfg = loadStoredConfig();
  const cached = cfg.update;
  if (
    !options.force &&
    cached?.lastCheckedAt &&
    now - cached.lastCheckedAt < CHECK_INTERVAL_MS
  ) {
    return updateInfo({
      currentVersion,
      latestVersion: cached.latestVersion,
      releaseUrl: cached.releaseUrl,
      checkedAt: cached.lastCheckedAt,
      source: "cache",
    });
  }

  const release = await fetchLatestRelease();
  const latestVersion = release.tag_name;
  const releaseUrl = release.html_url;
  saveStoredConfig({
    ...cfg,
    update: {
      lastCheckedAt: now,
      ...(latestVersion ? { latestVersion } : {}),
      ...(releaseUrl ? { releaseUrl } : {}),
    },
  });

  return updateInfo({
    currentVersion,
    latestVersion,
    releaseUrl,
    checkedAt: now,
    source: "network",
  });
}

export function updateRows(info: UpdateInfo): Array<{ label: string; value: string }> {
  return [
    { label: "current", value: versionLabel(info.currentVersion) },
    { label: "latest", value: info.latestVersion ? versionLabel(info.latestVersion) : "not available" },
    {
      label: "status",
      value: info.updateAvailable ? "update available" : "up to date",
    },
    ...(info.releaseUrl ? [{ label: "release", value: info.releaseUrl }] : []),
    ...(info.installCommand ? [{ label: "command", value: info.installCommand }] : []),
  ];
}

export function buildInstallCommand(version: string): string {
  if (process.platform === "win32") {
    return `Download lucky-windows-x64.exe from https://github.com/${REPO}/releases/tag/${versionLabel(version)}`;
  }
  return `curl -fsSL ${INSTALL_SCRIPT_URL} | LUCKY_VERSION=${versionLabel(version)} bash`;
}

async function fetchLatestRelease(): Promise<GitHubRelease> {
  const res = await fetch(LATEST_RELEASE_URL, {
    headers: {
      accept: "application/vnd.github+json",
      "User-Agent": `LuckyCLI update-check`,
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub release check failed (${res.status}): ${await res.text()}`);
  }
  return res.json() as Promise<GitHubRelease>;
}

function updateInfo({
  currentVersion,
  latestVersion,
  releaseUrl,
  checkedAt,
  source,
}: {
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  checkedAt: number;
  source: UpdateInfo["source"];
}): UpdateInfo {
  const updateAvailable = latestVersion
    ? compareVersions(latestVersion, currentVersion) > 0
    : false;
  return {
    currentVersion,
    ...(latestVersion ? { latestVersion } : {}),
    ...(releaseUrl ? { releaseUrl } : {}),
    updateAvailable,
    ...(updateAvailable && latestVersion
      ? { installCommand: buildInstallCommand(latestVersion) }
      : {}),
    checkedAt,
    source,
  };
}

// --- Applying updates --------------------------------------------------------

export interface DownloadOptions {
  /** Pin a specific release; defaults to "latest". */
  version?: string;
  /** Injected fetch, for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Download the release asset for this platform into the running binary's own
 * directory and verify it against the release SHA256SUMS. Returns the temp path
 * and resolved sha. The checksum is mandatory — if SHA256SUMS can't be fetched
 * or doesn't list the asset, we abort rather than run an unverified binary.
 */
async function fetchVerifiedBinary(
  targetDir: string,
  options: DownloadOptions = {},
): Promise<{ tmpPath: string; sha256: string; asset: string }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const { assetUrl, checksumsUrl, asset } = buildAssetUrls(options.version ?? "latest");

  const sumsRes = await fetchImpl(checksumsUrl);
  if (!sumsRes.ok) {
    throw new Error(`Could not fetch SHA256SUMS (${sumsRes.status}); refusing to update.`);
  }
  const sha256 = parseSha256Sums(await sumsRes.text(), asset);
  if (!sha256) {
    throw new Error(`No checksum for ${asset} in SHA256SUMS; refusing to update.`);
  }

  const tmpPath = await downloadVerified(assetUrl, sha256, targetDir, { fetchImpl });
  return { tmpPath, sha256, asset };
}

export interface ApplyResult {
  applied: boolean;
  /** Why an update couldn't be applied in-place, if it wasn't. */
  reason?: string;
  installCommand?: string;
}

/**
 * Download, verify, and immediately swap in a new binary, replacing the running
 * one. Falls back to returning the manual install command when this process
 * can't self-update (dev runtime, non-writable dir). Used by `lucky update
 * --apply` and the TUI's confirmed `/update`.
 */
export async function applyUpdateNow(
  version: string | undefined,
  options: DownloadOptions = {},
): Promise<ApplyResult> {
  const cap = detectSelfUpdate();
  if (!cap.ok || !cap.targetPath || !cap.targetDir) {
    return {
      applied: false,
      reason: cap.reason ?? "unknown",
      installCommand: buildInstallCommand(version ?? "latest"),
    };
  }
  const { tmpPath } = await fetchVerifiedBinary(cap.targetDir, { ...options, version });
  swapInPlace(tmpPath, cap.targetPath);
  return { applied: true };
}

/**
 * Download + verify the new binary and record it as staged in the config; the
 * next cold start applies it. Used by the "auto" policy so a running session is
 * never disturbed. No-op (returns false) when self-update isn't possible.
 */
export async function stageUpdate(
  version: string,
  options: DownloadOptions = {},
): Promise<boolean> {
  const cap = detectSelfUpdate();
  if (!cap.ok || !cap.targetDir) return false;

  const { tmpPath, sha256 } = await fetchVerifiedBinary(cap.targetDir, { ...options, version });
  const cfg = loadStoredConfig();
  saveStoredConfig(
    withStagedUpdate(cfg, {
      version: versionLabel(version),
      path: tmpPath,
      sha256,
      stagedAt: Date.now(),
    }),
  );
  return true;
}

/** Forget a staged update (e.g. after it's applied). */
export function discardStagedUpdate(): void {
  saveStoredConfig(clearStagedUpdate(loadStoredConfig()));
}

