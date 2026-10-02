import { unlinkSync } from "node:fs";
import {
  buildAssetUrls,
  compareVersions,
  detectSelfUpdate,
  downloadVerified,
  loadStoredConfig,
  parseSha256Sums,
  saveStoredConfig,
  swapInPlace,
  versionLabel,
  withInstalledUpdate,
} from "@luckycli/core";

export { compareVersions };

const REPO = "Fenix46/LuckyCLI";
const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
/** The web redirect to the latest tag: no API rate limit, used as a fallback. */
const LATEST_RELEASE_PAGE = `https://github.com/${REPO}/releases/latest`;
const INSTALL_SCRIPT_URL = `https://raw.githubusercontent.com/${REPO}/main/install.sh`;

/** The release lookup is small: fail fast rather than hang the caller. */
const CHECK_TIMEOUT_MS = 15_000;
/** SHA256SUMS is a few lines. */
const CHECKSUMS_TIMEOUT_MS = 30_000;
/** The binary is tens of MB; leave room for a slow connection. */
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
/** Transient network failures are common; retry the download a few times. */
const DOWNLOAD_ATTEMPTS = 3;

export interface UpdateInfo {
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  updateAvailable: boolean;
  installCommand?: string;
  checkedAt: number;
  source: "cache" | "network";
}

export interface CheckOptions {
  /**
   * When the network lookup fails, answer from the last successful check
   * instead of throwing. The launch check uses it so an offline start still
   * knows about a release it saw earlier; explicit commands report the error.
   */
  fallbackToCache?: boolean;
  /** Injected fetch, for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Look up the latest release. Always asks the network — a cached answer can
 * be hours behind a fresh release, which made launch-time updates miss new
 * versions — and records the result for the offline fallback.
 */
export async function checkForUpdate(
  currentVersion: string,
  options: CheckOptions = {},
): Promise<UpdateInfo> {
  const now = Date.now();
  let release: { tag?: string; url?: string };
  try {
    release = await fetchLatestRelease(options.fetchImpl ?? fetch);
  } catch (error) {
    const cached = loadStoredConfig().update;
    if (options.fallbackToCache && cached?.latestVersion) {
      return updateInfo({
        currentVersion,
        latestVersion: cached.latestVersion,
        releaseUrl: cached.releaseUrl,
        checkedAt: cached.lastCheckedAt ?? now,
        source: "cache",
      });
    }
    throw error;
  }

  // Merge into the existing update block: it also carries the autoUpdate
  // policy and the installed-release record, which a check must never wipe.
  const cfg = loadStoredConfig();
  saveStoredConfig({
    ...cfg,
    update: {
      ...cfg.update,
      lastCheckedAt: now,
      ...(release.tag ? { latestVersion: release.tag } : {}),
      ...(release.url ? { releaseUrl: release.url } : {}),
    },
  });

  return updateInfo({
    currentVersion,
    latestVersion: release.tag,
    releaseUrl: release.url,
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

/** `fetch` that aborts after `ms`, so a stalled connection can't hang us. */
function withTimeout(fetchImpl: typeof fetch, ms: number): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    fetchImpl(input, { ...init, signal: AbortSignal.timeout(ms) })) as typeof fetch;
}

/**
 * The latest release tag. The GitHub API comes first (it also gives the page
 * URL); if it fails — rate limit (60/h per IP), outage — the public
 * /releases/latest redirect still names the tag.
 */
async function fetchLatestRelease(fetchImpl: typeof fetch): Promise<{ tag?: string; url?: string }> {
  const timed = withTimeout(fetchImpl, CHECK_TIMEOUT_MS);
  let apiError: unknown;
  try {
    const res = await timed(LATEST_RELEASE_URL, {
      headers: {
        accept: "application/vnd.github+json",
        "User-Agent": "LuckyCLI update-check",
      },
    });
    if (res.ok) {
      const body = (await res.json()) as { tag_name?: string; html_url?: string };
      if (body.tag_name) return { tag: body.tag_name, url: body.html_url };
    }
    apiError = new Error(`GitHub release check failed (${res.status} ${res.statusText})`.trim());
  } catch (error) {
    apiError = error;
  }

  try {
    const res = await timed(LATEST_RELEASE_PAGE, { redirect: "manual" });
    const location = res.headers.get("location") ?? "";
    const tag = /\/releases\/tag\/([^/?#]+)/.exec(location)?.[1];
    if (tag) return { tag: decodeURIComponent(tag), url: location };
  } catch {
    // fall through to the API error, which is the more informative one
  }
  throw apiError;
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
  /** Injected fetch, for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Download the release asset for this platform into the running binary's own
 * directory and verify it against the release SHA256SUMS. Returns the temp path.
 * The checksum is mandatory — if SHA256SUMS can't be fetched or doesn't list
 * the asset, we abort rather than run an unverified binary. Transient failures
 * (network, truncated download) are retried.
 */
async function fetchVerifiedBinary(
  version: string,
  targetDir: string,
  options: DownloadOptions = {},
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const { assetUrl, checksumsUrl, asset } = buildAssetUrls(version);

  let lastError: unknown;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
    try {
      const sumsRes = await withTimeout(fetchImpl, CHECKSUMS_TIMEOUT_MS)(checksumsUrl);
      if (!sumsRes.ok) {
        throw new Error(`could not fetch SHA256SUMS for ${versionLabel(version)} (${sumsRes.status})`);
      }
      const sha256 = parseSha256Sums(await sumsRes.text(), asset);
      if (!sha256) {
        throw new Error(`no checksum for ${asset} in SHA256SUMS of ${versionLabel(version)}`);
      }
      return await downloadVerified(assetUrl, sha256, targetDir, {
        fetchImpl: withTimeout(fetchImpl, DOWNLOAD_TIMEOUT_MS),
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export interface ApplyResult {
  applied: boolean;
  /** Why an update couldn't be applied in-place, if it wasn't. */
  reason?: string;
  installCommand?: string;
}

/**
 * Download, verify, and immediately swap in release `version`, replacing the
 * binary on disk (the running process keeps its loaded image, so the user
 * restarts to use it). Falls back to returning the manual install command when
 * this process can't self-update (dev runtime, non-writable dir). Used by the
 * launch-time auto update, `lucky update --apply` and `/update apply`.
 */
export async function applyUpdateNow(
  version: string,
  options: DownloadOptions = {},
): Promise<ApplyResult> {
  const cap = detectSelfUpdate();
  if (!cap.ok || !cap.targetPath || !cap.targetDir) {
    return {
      applied: false,
      reason: cap.reason ?? "unknown",
      installCommand: buildInstallCommand(version),
    };
  }
  const tmpPath = await fetchVerifiedBinary(version, cap.targetDir, options);
  try {
    swapInPlace(tmpPath, cap.targetPath);
  } catch (error) {
    // Don't leave a stray verified download next to the binary.
    try {
      unlinkSync(tmpPath);
    } catch {
      // already gone
    }
    throw error;
  }
  saveStoredConfig(
    withInstalledUpdate(loadStoredConfig(), { version: versionLabel(version), path: cap.targetPath }),
  );
  return { applied: true };
}

/**
 * True when self-update already installed `version` at `execPath` — so if this
 * fresh launch still reports an older version, the release binary itself is
 * mislabeled and reinstalling it would just loop.
 */
export function alreadyInstalled(version: string, execPath: string = process.execPath): boolean {
  const installed = loadStoredConfig().update?.installed;
  return installed?.version === versionLabel(version) && installed.path === execPath;
}
