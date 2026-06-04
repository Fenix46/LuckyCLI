import { compareVersions, loadStoredConfig, saveStoredConfig, versionLabel } from "@luckycli/core";

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

