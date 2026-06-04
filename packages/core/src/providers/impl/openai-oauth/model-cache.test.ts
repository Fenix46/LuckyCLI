import { describe, expect, it, vi } from "vitest";
import { CodexModelCache, defaultEffortFor, effortLevelsFor } from "./model-cache.js";
import type { CodexModel } from "./models.js";

const MODELS: CodexModel[] = [
  {
    slug: "gpt-5.5",
    displayName: "GPT-5.5",
    defaultReasoningLevel: "xhigh",
    supportedReasoningLevels: [
      { effort: "low" },
      { effort: "medium" },
      { effort: "high" },
      { effort: "xhigh" },
    ],
  },
  { slug: "gpt-5.4-mini", displayName: "mini", supportedReasoningLevels: [] },
];

describe("CodexModelCache", () => {
  it("fetches once and memoizes for the session", async () => {
    const load = vi.fn(async () => MODELS);
    const cache = new CodexModelCache(load);

    expect(await cache.get()).toBe(MODELS);
    await cache.get();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("re-fetches when refresh is requested", async () => {
    const load = vi.fn(async () => MODELS);
    const cache = new CodexModelCache(load);
    await cache.get();
    await cache.get({ refresh: true });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not memoize a failed fetch", async () => {
    const load = vi
      .fn<() => Promise<CodexModel[]>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(MODELS);
    const cache = new CodexModelCache(load);

    await expect(cache.get()).rejects.toThrow("boom");
    expect(await cache.get()).toBe(MODELS); // retried
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("effort helpers", () => {
  it("lists a model's effort levels in order", () => {
    expect(effortLevelsFor(MODELS, "gpt-5.5")).toEqual(["low", "medium", "high", "xhigh"]);
    expect(effortLevelsFor(MODELS, "gpt-5.4-mini")).toEqual([]);
    expect(effortLevelsFor(MODELS, "unknown")).toEqual([]);
  });

  it("reads the default effort level", () => {
    expect(defaultEffortFor(MODELS, "gpt-5.5")).toBe("xhigh");
    expect(defaultEffortFor(MODELS, "gpt-5.4-mini")).toBeUndefined();
  });
});
