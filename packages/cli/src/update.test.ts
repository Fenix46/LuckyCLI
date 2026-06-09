import { afterEach, describe, expect, it, vi } from "vitest";
import { buildInstallCommand, checkForUpdate, compareVersions, updateRows } from "./update.js";

const { loadStoredConfigMock, saveStoredConfigMock } = vi.hoisted(() => ({
  loadStoredConfigMock: vi.fn(() => ({}) as Record<string, unknown>),
  saveStoredConfigMock: vi.fn(),
}));

vi.mock("@luckycli/core", async () => {
  const actual = await vi.importActual<typeof import("@luckycli/core")>("@luckycli/core");
  return {
    ...actual,
    loadStoredConfig: loadStoredConfigMock,
    saveStoredConfig: saveStoredConfigMock,
  };
});

describe("update helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    loadStoredConfigMock.mockReset();
    loadStoredConfigMock.mockReturnValue({});
    saveStoredConfigMock.mockReset();
  });

  it("compares release versions with or without v prefix", () => {
    expect(compareVersions("v0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("0.1.0", "v0.1.0")).toBe(0);
    expect(compareVersions("v0.1.0", "v0.2.0")).toBeLessThan(0);
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

  it("preserves the autoUpdate policy and staged record across a network check", async () => {
    const staged = { version: "v0.9.0", path: "/tmp/lucky.new", sha256: "abc", stagedAt: 1 };
    loadStoredConfigMock.mockReturnValue({
      update: { autoUpdate: "off", staged, lastCheckedAt: 0 },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ tag_name: "v0.4.0", html_url: "https://example/release" }),
      })),
    );

    const info = await checkForUpdate("0.3.5", { force: true });

    expect(info.updateAvailable).toBe(true);
    // The persisted config must keep the user's policy and the staged binary
    // record — a routine check must never clobber them.
    const savedCfg = saveStoredConfigMock.mock.calls.at(-1)?.[0] as {
      update?: { autoUpdate?: string; staged?: unknown; latestVersion?: string };
    };
    expect(savedCfg.update?.autoUpdate).toBe("off");
    expect(savedCfg.update?.staged).toEqual(staged);
    expect(savedCfg.update?.latestVersion).toBe("v0.4.0");
  });
});
