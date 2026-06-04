import { describe, expect, it } from "vitest";
import type { StoredConfig } from "../config/store.js";
import {
  clearStagedUpdate,
  getAutoUpdatePolicy,
  withAutoUpdatePolicy,
  withStagedUpdate,
} from "./policy.js";

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

  it("stages and clears a verified update immutably", () => {
    const staged = { version: "v0.3.0", path: "/x/.lucky.staged", sha256: "abc", stagedAt: 1 };
    const withStaged = withStagedUpdate({ update: { lastCheckedAt: 9 } }, staged);
    expect(withStaged.update?.staged).toEqual(staged);
    expect(withStaged.update?.lastCheckedAt).toBe(9);

    const cleared = clearStagedUpdate(withStaged);
    expect(cleared.update?.staged).toBeUndefined();
    expect(cleared.update?.lastCheckedAt).toBe(9);
    // original keeps its staged record
    expect(withStaged.update?.staged).toEqual(staged);
  });

  it("clearing when nothing is staged is a no-op", () => {
    const cfg: StoredConfig = { update: { autoUpdate: "auto" } };
    expect(clearStagedUpdate(cfg)).toBe(cfg);
  });
});
