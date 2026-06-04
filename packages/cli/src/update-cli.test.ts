import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoredConfig } from "@luckycli/core";
import { runUpdateCommand } from "./update-cli.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function collect() {
  const lines: string[] = [];
  return { sink: (l: string) => lines.push(l), lines };
}

/** In-memory config store so tests never touch ~/.luckycli/config.json. */
function fakeStore(initial: StoredConfig = {}) {
  let cfg = initial;
  return {
    loadConfig: () => cfg,
    saveConfig: (next: StoredConfig) => {
      cfg = next;
    },
    get current() {
      return cfg;
    },
  };
}

describe("lucky update --auto", () => {
  it("persists a valid policy and reports it", async () => {
    const store = fakeStore();
    const { sink, lines } = collect();
    const code = await runUpdateCommand(["--auto", "notify"], {
      out: sink,
      err: sink,
      loadConfig: store.loadConfig,
      saveConfig: store.saveConfig,
    });
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain('set to "notify"');
    expect(store.current.update?.autoUpdate).toBe("notify");
  });

  it("rejects an invalid policy", async () => {
    const { sink, lines } = collect();
    const code = await runUpdateCommand(["--auto", "sometimes"], { out: sink, err: sink });
    expect(code).toBe(1);
    expect(lines.join("\n")).toMatch(/off\|notify\|auto/);
  });
});

describe("lucky update (check)", () => {
  it("prints status rows including the current version and policy", async () => {
    // Stub the GitHub API so no real network is hit and no update is available.
    const fetchImpl = vi.fn(
      async () => ({ ok: true, json: async () => ({ tag_name: "v0.0.1", html_url: "u" }) }) as Response,
    ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchImpl);

    const store = fakeStore();
    const { sink, lines } = collect();
    const code = await runUpdateCommand([], {
      out: sink,
      err: sink,
      currentVersion: "9.9.9",
      loadConfig: store.loadConfig,
      saveConfig: store.saveConfig,
    });

    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("current");
    expect(text).toContain("up to date");
    expect(text).toMatch(/policy\s+auto/); // default policy when unset
  });
});
