/**
 * Self-replace machinery: download the right release asset, verify it, and swap
 * it in for the running binary — safely, on macOS/Linux/Windows.
 *
 * The dangerous part is replacing a file the OS is currently executing. On Unix
 * a `rename` over the target works because the running process keeps the old
 * inode open; on Windows you can't overwrite a running `.exe`, so we move it
 * aside (`<target>.old`) first and clean it up on the next launch. Every swap is
 * gated on a mandatory SHA-256 check — we never run an unverified binary.
 *
 * Pure helpers (asset naming, URL building, checksum parsing, capability
 * detection) are separated from the I/O so they can be unit-tested without a
 * network or real binaries.
 */
import { createHash } from "node:crypto";
import {
  accessSync,
  chmodSync,
  constants as fsConstants,
  existsSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const REPO = "Fenix46/LuckyCLI";

export type LuckyOs = "darwin" | "linux" | "windows";
export type LuckyArch = "x64" | "arm64";

/**
 * Release asset name for a platform. Mirrors install.sh / scripts/build.ts.
 * Windows ships only an x64 build, so arch is ignored there.
 */
export function assetName(os: LuckyOs, arch: LuckyArch): string {
  if (os === "windows") return "lucky-windows-x64.exe";
  return `lucky-${os}-${arch}`;
}

/** Map Node's `process.platform`/`process.arch` onto our supported matrix. */
export function resolvePlatform(
  platform: NodeJS.Platform,
  arch: string,
): { os: LuckyOs; arch: LuckyArch } {
  let os: LuckyOs;
  switch (platform) {
    case "darwin":
      os = "darwin";
      break;
    case "linux":
      os = "linux";
      break;
    case "win32":
      os = "windows";
      break;
    default:
      throw new Error(`Unsupported operating system: ${platform}`);
  }

  let resolvedArch: LuckyArch;
  switch (arch) {
    case "x64":
      resolvedArch = "x64";
      break;
    case "arm64":
      // No Windows arm64 asset exists; the x64 build runs under emulation.
      resolvedArch = os === "windows" ? "x64" : "arm64";
      break;
    default:
      throw new Error(`Unsupported architecture: ${arch}`);
  }

  return { os, arch: resolvedArch };
}

export interface AssetUrls {
  asset: string;
  assetUrl: string;
  checksumsUrl: string;
}

/**
 * Release URLs for this host's asset. `"latest"` uses the rolling latest
 * release; a pinned `vX.Y.Z` (the `LUCKY_VERSION` convention) targets that tag.
 */
export function buildAssetUrls(
  version: string | "latest",
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): AssetUrls {
  const { os, arch: a } = resolvePlatform(platform, arch);
  const asset = assetName(os, a);
  const base =
    version === "latest"
      ? `https://github.com/${REPO}/releases/latest/download`
      : `https://github.com/${REPO}/releases/download/${version}`;
  return {
    asset,
    assetUrl: `${base}/${asset}`,
    checksumsUrl: `${base}/SHA256SUMS`,
  };
}

/**
 * The hex SHA-256 for `asset` from a `SHA256SUMS` body, or undefined if absent.
 * Lines look like `<hex>  lucky-darwin-x64`.
 */
export function parseSha256Sums(body: string, asset: string): string | undefined {
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    const hex = parts[0];
    if (parts.length >= 2 && hex && parts[parts.length - 1] === asset) {
      return hex.toLowerCase();
    }
  }
  return undefined;
}

/**
 * Whether this process is the compiled standalone `lucky` binary (Bun single
 * file), as opposed to `node`/`bun`/`tsx` running from source in dev. A wrong
 * `true` here would let a self-update clobber the user's node/bun, so we require
 * both the Bun runtime marker and a `lucky` executable basename, and refuse on
 * any doubt.
 */
export function isCompiledBinary(env?: {
  execPath?: string;
  bunVersion?: string;
}): boolean {
  const execPath = env?.execPath ?? process.execPath;
  const bunVersion = env?.bunVersion ?? process.versions.bun;
  if (!bunVersion) return false;
  // Handle both separators ourselves: a Windows execPath may reach this code on
  // any host (and node:path.basename is platform-specific about backslashes).
  const name = (execPath.split(/[\\/]/).pop() ?? "").toLowerCase();
  return name === "lucky" || name === "lucky.exe" || name.startsWith("lucky-");
}

export interface SelfUpdateCapability {
  ok: boolean;
  reason?: "dev-runtime" | "not-writable" | "unknown-path";
  targetPath?: string;
  targetDir?: string;
}

/**
 * Whether this process can replace its own binary. Takes injected probes so it
 * is testable without touching the real filesystem.
 */
export function canSelfUpdate(probe: {
  execPath: string;
  isCompiledBinary: boolean;
  isDirWritable: (dir: string) => boolean;
}): SelfUpdateCapability {
  if (!probe.execPath) return { ok: false, reason: "unknown-path" };
  if (!probe.isCompiledBinary) {
    return { ok: false, reason: "dev-runtime", targetPath: probe.execPath };
  }
  const targetDir = dirname(probe.execPath);
  if (!probe.isDirWritable(targetDir)) {
    return { ok: false, reason: "not-writable", targetPath: probe.execPath, targetDir };
  }
  return { ok: true, targetPath: probe.execPath, targetDir };
}

/** Convenience wrapper around {@link canSelfUpdate} that probes the real host. */
export function detectSelfUpdate(execPath: string = process.execPath): SelfUpdateCapability {
  return canSelfUpdate({
    execPath,
    isCompiledBinary: isCompiledBinary({ execPath }),
    isDirWritable,
  });
}

/** Best-effort write check for a directory. */
export function isDirWritable(dir: string): boolean {
  try {
    accessSync(dir, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export interface DownloadDeps {
  fetchImpl?: typeof fetch;
}

/**
 * Download `url` into `targetDir`, verify its SHA-256, and return the temp path.
 * The temp file lives in `targetDir` (not the OS temp dir) so the later
 * `rename` onto the binary stays on the same filesystem and therefore atomic.
 * A mismatch (or empty download) unlinks the temp file and throws — a partial or
 * tampered download never becomes the live binary.
 */
export async function downloadVerified(
  url: string,
  expectedSha256: string,
  targetDir: string,
  deps: DownloadDeps = {},
): Promise<string> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`Download failed (${res.status}) for ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("Downloaded file is empty.");

  const tmp = join(targetDir, `.lucky.download-${process.pid}-${Date.now()}`);
  writeFileSync(tmp, buf);

  const actual = createHash("sha256").update(buf).digest("hex").toLowerCase();
  const expected = expectedSha256.toLowerCase();
  if (actual !== expected) {
    try {
      unlinkSync(tmp);
    } catch {
      // best-effort cleanup
    }
    throw new Error(`Checksum mismatch.\n  expected ${expected}\n  got      ${actual}`);
  }
  return tmp;
}

/**
 * Atomically replace the running binary at `targetPath` with the verified
 * `tmpPath`. Splits on platform so each path is testable in isolation.
 */
export function swapInPlace(
  tmpPath: string,
  targetPath: string,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === "win32") {
    swapInPlaceWindows(tmpPath, targetPath);
  } else {
    swapInPlaceUnix(tmpPath, targetPath);
  }
}

/** Unix: make executable, then rename over the target (atomic; inode-safe). */
export function swapInPlaceUnix(tmpPath: string, targetPath: string): void {
  chmodSync(tmpPath, 0o755);
  renameSync(tmpPath, targetPath);
}

/**
 * Windows: a running `.exe` can't be overwritten, so move it aside first, then
 * rename the new binary in. If the second rename fails, roll the old one back.
 * The leftover `<target>.old` is removed on the next launch.
 */
export function swapInPlaceWindows(tmpPath: string, targetPath: string): void {
  const old = `${targetPath}.old`;
  if (existsSync(old)) {
    try {
      unlinkSync(old);
    } catch {
      // may still be mapped; cleanupStaleBinary retries next launch
    }
  }
  renameSync(targetPath, old);
  try {
    renameSync(tmpPath, targetPath);
  } catch (err) {
    // Roll back so the user is never left without a working binary.
    try {
      renameSync(old, targetPath);
    } catch {
      // both moves failed; surface the original error
    }
    throw err;
  }
}

/**
 * Remove a leftover `<target>.old` from a prior Windows swap. Best-effort: the
 * file may still be briefly locked (EPERM/EBUSY), in which case we leave it for
 * a later launch.
 */
export function cleanupStaleBinary(targetPath: string): void {
  const old = `${targetPath}.old`;
  if (!existsSync(old)) return;
  try {
    unlinkSync(old);
  } catch {
    // still locked; try again next time
  }
}
