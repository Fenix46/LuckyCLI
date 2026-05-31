import { describe, expect, it } from "vitest";
import { buildInstallCommand, compareVersions, updateRows } from "./update.js";

describe("update helpers", () => {
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
});
