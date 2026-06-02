import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getProjectRecord,
  isProjectTrusted,
  needsTrustPrompt,
  projectKey,
  withGraphBuilt,
  withProjectTrust,
} from "./project-trust.js";
import type { StoredConfig } from "./store.js";

describe("project trust (pure helpers)", () => {
  it("treats an unseen folder as needing a trust prompt", () => {
    const cfg: StoredConfig = {};
    expect(needsTrustPrompt(cfg, "/repo")).toBe(true);
    expect(getProjectRecord(cfg, "/repo")).toBeUndefined();
    expect(isProjectTrusted(cfg, "/repo")).toBe(false);
  });

  it("stops prompting once a decision is recorded — even a 'no'", () => {
    const trusted = withProjectTrust({}, "/repo", true, "2026-06-02T00:00:00.000Z");
    expect(needsTrustPrompt(trusted, "/repo")).toBe(false);
    expect(isProjectTrusted(trusted, "/repo")).toBe(true);

    const declined = withProjectTrust({}, "/repo", false);
    expect(needsTrustPrompt(declined, "/repo")).toBe(false); // known now
    expect(isProjectTrusted(declined, "/repo")).toBe(false);
  });

  it("keys on the absolute path", () => {
    expect(projectKey("/repo")).toBe(resolve("/repo"));
    const cfg = withProjectTrust({}, "/repo", true);
    expect(getProjectRecord(cfg, "/repo")).toBeDefined();
  });

  it("preserves firstOpenedAt across updates", () => {
    const first = withProjectTrust({}, "/repo", true, "2026-01-01T00:00:00.000Z");
    const later = withProjectTrust(first, "/repo", false, "2026-02-02T00:00:00.000Z");
    expect(getProjectRecord(later, "/repo")?.firstOpenedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(getProjectRecord(later, "/repo")?.trusted).toBe(false);
  });

  it("stamps graph build time without dropping trust", () => {
    const trusted = withProjectTrust({}, "/repo", true, "2026-01-01T00:00:00.000Z");
    const built = withGraphBuilt(trusted, "/repo", "2026-03-03T00:00:00.000Z");
    expect(getProjectRecord(built, "/repo")?.graphBuiltAt).toBe("2026-03-03T00:00:00.000Z");
    expect(getProjectRecord(built, "/repo")?.trusted).toBe(true);
    expect(getProjectRecord(built, "/repo")?.firstOpenedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("does not mutate the input config", () => {
    const cfg: StoredConfig = {};
    withProjectTrust(cfg, "/repo", true);
    expect(cfg.projects).toBeUndefined();
  });
});
