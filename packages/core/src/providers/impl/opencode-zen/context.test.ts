import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("opencode Zen context windows", () => {
  it("maps zen model ids to limit.context from models.dev", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          opencode: {
            models: {
              "deepseek-v4-flash-free": { limit: { context: 200000 } },
              "claude-sonnet-4-6": { limit: { context: 1000000 } },
              "no-limit": {},
            },
          },
          other: { models: { ignored: { limit: { context: 5 } } } },
        }),
      }),
    );

    // Re-import to reset the module-level cache between tests.
    const { fetchOpencodeZenContextWindows, fetchOpencodeZenContextWindow } =
      await import("./context.js");

    expect(await fetchOpencodeZenContextWindows()).toEqual({
      "deepseek-v4-flash-free": 200000,
      "claude-sonnet-4-6": 1000000,
    });
    expect(await fetchOpencodeZenContextWindow("claude-sonnet-4-6")).toBe(1000000);
    expect(await fetchOpencodeZenContextWindow("unknown")).toBeUndefined();
  });

  it("returns {} when models.dev is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
    );
    const { fetchOpencodeZenContextWindows } = await import("./context.js");
    expect(await fetchOpencodeZenContextWindows()).toEqual({});
  });
});
