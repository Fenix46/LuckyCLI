import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  alreadyInstalled,
  applyUpdateNow,
  buildInstallCommand,
  checkForUpdate,
  compareVersions,
  updateRows,
} from "./update.js";

const { loadStoredConfigMock, saveStoredConfigMock, detectSelfUpdateMock, downloadVerifiedMock, swapInPlaceMock } =
  vi.hoisted(() => ({
    loadStoredConfigMock: vi.fn(() => ({}) as Record<string, unknown>),
    saveStoredConfigMock: vi.fn(),
    detectSelfUpdateMock: vi.fn(),
    downloadVerifiedMock: vi.fn(),
    swapInPlaceMock: vi.fn(),
  }));

vi.mock("@luckycli/core", async () => {
  const actual = await vi.importActual<typeof import("@luckycli/core")>("@luckycli/core");
  return {
    ...actual,
    loadStoredConfig: loadStoredConfigMock,
    saveStoredConfig: saveStoredConfigMock,
    detectSelfUpdate: detectSelfUpdateMock,
    downloadVerified: downloadVerifiedMock,
    swapInPlace: swapInPlaceMock,
  };
});

/** A fetch stub answering by URL; unmatched URLs reject like a network error. */
function routes(table: Record<string, () => Partial<Response>>): typeof fetch {
  return vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    for (const [prefix, respond] of Object.entries(table)) {
      if (url.startsWith(prefix)) return respond() as Response;
    }
    throw new Error(`network error: ${url}`);
  }) as unknown as typeof fetch;
}

const API = "https://api.github.com/repos/Fenix46/LuckyCLI/releases/latest";
const PAGE = "https://github.com/Fenix46/LuckyCLI/releases/latest";

describe("update helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    loadStoredConfigMock.mockReset();
    loadStoredConfigMock.mockReturnValue({});
    saveStoredConfigMock.mockReset();
    detectSelfUpdateMock.mockReset();
    downloadVerifiedMock.mockReset();
    swapInPlaceMock.mockReset();
  });

  it("compares release versions with or without v prefix", () => {
    expect(compareVersions("v0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("0.1.0", "v0.1.0")).toBe(0);
    expect(compareVersions("v0.1.0", "v0.2.0")).toBeLessThan(0);
  });

  it("ranks a release above its own pre-releases", () => {
    expect(compareVersions("0.7.0", "0.7.0-beta.1")).toBeGreaterThan(0);
    expect(compareVersions("0.7.0-rc.2", "0.7.0")).toBeLessThan(0);
    expect(compareVersions("0.7.0-rc.10", "0.7.0-rc.2")).toBeGreaterThan(0);
    expect(compareVersions("0.7.0-beta", "0.7.0-alpha")).toBeGreaterThan(0);
    expect(compareVersions("0.7.0-alpha.1", "0.7.0-alpha")).toBeGreaterThan(0);
    expect(compareVersions("0.7.1-beta.1", "0.7.0")).toBeGreaterThan(0);
  });

  it("builds an installer command pinned to the release tag", () => {
    expect(buildInstallCommand("0.2.0")).toContain("LUCKY_VERSION=v0.2.0");
  });

  it("shows update command rows when an update is available", () => {
    const rows = updateRows({
      currentVersion: "0.1.0",
      latestVersion: "v0.2.0",
      releaseUrl: "https://github.com/Fenix46/LuckyCLI/releases/tag/v0.2.0",
      updateAvailable: true,
      installCommand: "install",
      checkedAt: 1,
      source: "network",
    });

    expect(rows).toContainEqual({ label: "status", value: "update available" });
    expect(rows).toContainEqual({ label: "command", value: "install" });
  });

  it("preserves the autoUpdate policy and installed record across a network check", async () => {
    const installed = { version: "v0.3.5", path: "/bin/lucky" };
    loadStoredConfigMock.mockReturnValue({
      update: { autoUpdate: "off", installed, lastCheckedAt: 0 },
    });
    const fetchImpl = routes({
      [API]: () => ({ ok: true, json: async () => ({ tag_name: "v0.4.0", html_url: "https://example/release" }) }),
    });

    const info = await checkForUpdate("0.3.5", { fetchImpl });

    expect(info.updateAvailable).toBe(true);
    const savedCfg = saveStoredConfigMock.mock.calls.at(-1)?.[0] as {
      update?: { autoUpdate?: string; installed?: unknown; latestVersion?: string };
    };
    expect(savedCfg.update?.autoUpdate).toBe("off");
    expect(savedCfg.update?.installed).toEqual(installed);
    expect(savedCfg.update?.latestVersion).toBe("v0.4.0");
  });

  it("always asks the network, even right after a check", async () => {
    loadStoredConfigMock.mockReturnValue({
      update: { lastCheckedAt: Date.now(), latestVersion: "v0.3.5" },
    });
    const fetchImpl = routes({
      [API]: () => ({ ok: true, json: async () => ({ tag_name: "v0.4.0" }) }),
    });

    const info = await checkForUpdate("0.3.5", { fetchImpl });

    expect(info.source).toBe("network");
    expect(info.latestVersion).toBe("v0.4.0");
  });

  it("falls back to the releases/latest redirect when the API fails", async () => {
    const fetchImpl = routes({
      [API]: () => ({ ok: false, status: 403, statusText: "rate limit exceeded" }),
      [PAGE]: () => ({
        ok: false,
        status: 302,
        headers: new Headers({ location: "https://github.com/Fenix46/LuckyCLI/releases/tag/v0.9.0" }),
      }),
    });

    const info = await checkForUpdate("0.3.5", { fetchImpl });

    expect(info.latestVersion).toBe("v0.9.0");
    expect(info.updateAvailable).toBe(true);
  });

  it("answers from the cache when offline only if asked to", async () => {
    loadStoredConfigMock.mockReturnValue({ update: { lastCheckedAt: 1, latestVersion: "v0.9.0" } });
    const offline = routes({});

    const cached = await checkForUpdate("0.3.5", { fetchImpl: offline, fallbackToCache: true });
    expect(cached).toMatchObject({ source: "cache", latestVersion: "v0.9.0", updateAvailable: true });

    await expect(checkForUpdate("0.3.5", { fetchImpl: offline })).rejects.toThrow(/network error/);
  });
});

describe("applyUpdateNow", () => {
  afterEach(() => {
    loadStoredConfigMock.mockReset();
    loadStoredConfigMock.mockReturnValue({});
    saveStoredConfigMock.mockReset();
    detectSelfUpdateMock.mockReset();
    downloadVerifiedMock.mockReset();
    swapInPlaceMock.mockReset();
  });

  const sums = "abc123  lucky-darwin-arm64\nabc123  lucky-darwin-x64\nabc123  lucky-linux-x64\nabc123  lucky-linux-arm64\nabc123  lucky-windows-x64.exe\n";

  function setup(): { dir: string; tmp: string; fetchImpl: typeof fetch } {
    const dir = mkdtempSync(join(tmpdir(), "lucky-update-"));
    const tmp = join(dir, ".lucky.download-test");
    writeFileSync(tmp, "new binary");
    detectSelfUpdateMock.mockReturnValue({ ok: true, targetPath: join(dir, "lucky"), targetDir: dir });
    downloadVerifiedMock.mockResolvedValue(tmp);
    const fetchImpl = routes({
      "https://github.com/Fenix46/LuckyCLI/releases/download/v0.9.0/SHA256SUMS": () => ({
        ok: true,
        text: async () => sums,
      }),
    });
    return { dir, tmp, fetchImpl };
  }

  it("installs the requested tag and records it", async () => {
    const { dir, fetchImpl } = setup();

    const result = await applyUpdateNow("0.9.0", { fetchImpl });

    expect(result.applied).toBe(true);
    expect(swapInPlaceMock).toHaveBeenCalledOnce();
    const saved = saveStoredConfigMock.mock.calls.at(-1)?.[0] as { update?: { installed?: unknown } };
    expect(saved.update?.installed).toEqual({ version: "v0.9.0", path: join(dir, "lucky") });
  });

  it("removes the verified download when the swap fails", async () => {
    const { tmp, fetchImpl } = setup();
    swapInPlaceMock.mockImplementation(() => {
      throw new Error("EACCES");
    });

    await expect(applyUpdateNow("v0.9.0", { fetchImpl })).rejects.toThrow("EACCES");
    expect(existsSync(tmp)).toBe(false);
    expect(saveStoredConfigMock).not.toHaveBeenCalled();
  });

  it("retries a failed download before giving up", async () => {
    const { tmp, fetchImpl } = setup();
    downloadVerifiedMock.mockRejectedValueOnce(new Error("socket hang up")).mockResolvedValueOnce(tmp);

    const result = await applyUpdateNow("v0.9.0", { fetchImpl });

    expect(result.applied).toBe(true);
    expect(downloadVerifiedMock).toHaveBeenCalledTimes(2);
  });

  it("knows a release it already installed at this path", () => {
    loadStoredConfigMock.mockReturnValue({ update: { installed: { version: "v0.9.0", path: "/bin/lucky" } } });
    expect(alreadyInstalled("0.9.0", "/bin/lucky")).toBe(true);
    expect(alreadyInstalled("0.9.0", "/other/lucky")).toBe(false);
    expect(alreadyInstalled("0.9.1", "/bin/lucky")).toBe(false);
  });
});
