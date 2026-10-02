import { describe, expect, it } from "vitest";
import type { StoredConfig } from "../config/store.js";
import { getAutoUpdatePolicy, withAutoUpdatePolicy, withInstalledUpdate } from "./policy.js";

describe("auto-update policy (pure helpers)", () => {
  it("defaults to auto when unset", () => {
    expect(getAutoUpdatePolicy({})).toBe("auto");
    expect(getAutoUpdatePolicy({ update: {} })).toBe("auto");
  });

  it("reads an explicit policy", () => {
    expect(getAutoUpdatePolicy({ update: { autoUpdate: "off" } })).toBe("off");
    expect(getAutoUpdatePolicy({ update: { autoUpdate: "notify" } })).toBe("notify");
  });

  it("sets the policy without mutating the input or losing siblings", () => {
    const cfg: StoredConfig = { provider: "claude", update: { lastCheckedAt: 5 } };
    const next = withAutoUpdatePolicy(cfg, "notify");
    expect(next.update).toEqual({ lastCheckedAt: 5, autoUpdate: "notify" });
    expect(cfg.update).toEqual({ lastCheckedAt: 5 }); // unchanged
    expect(next.provider).toBe("claude");
  });

  it("records the installed release without touching the policy", () => {
    const cfg: StoredConfig = { update: { autoUpdate: "auto", lastCheckedAt: 9 } };
    const next = withInstalledUpdate(cfg, { version: "v0.8.0", path: "/bin/lucky" });
    expect(next.update).toEqual({
      autoUpdate: "auto",
      lastCheckedAt: 9,
      installed: { version: "v0.8.0", path: "/bin/lucky" },
    });
    expect(cfg.update?.installed).toBeUndefined();
  });
});
