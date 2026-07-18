import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// store.ts reads homedir() once at module load to compute CONFIG_DIR, so the
// mock must be in place before the module under test is imported.
let fakeHome: string;
let writeFileSyncShouldThrow = false;
let writeFileSyncPaths: string[] = [];

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => fakeHome };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    writeFileSync: (path: string, ...rest: unknown[]) => {
      writeFileSyncPaths.push(path);
      if (writeFileSyncShouldThrow) throw new Error("simulated crash mid-write");
      return (actual.writeFileSync as (...a: unknown[]) => void)(path, ...rest);
    },
  };
});

describe("config store atomic writes", () => {
  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "lucky-config-store-"));
    writeFileSyncShouldThrow = false;
    writeFileSyncPaths = [];
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("writes via a temp file that is renamed into place, never leaving a stray tmp file behind", async () => {
    const { saveStoredConfig, configFilePath } = await import("./store.js");

    saveStoredConfig({ provider: "claude", credentials: { claude: { type: "claude", authMethod: "api-key", apiKey: "sk-test" } } });

    const dir = join(fakeHome, ".luckycli");
    const entries = readdirSync(dir);
    expect(entries).toContain("config.json");
    expect(entries.some((e) => e.includes(".tmp"))).toBe(false);

    const saved = JSON.parse(readFileSync(configFilePath(), "utf8"));
    expect(saved.provider).toBe("claude");
  });

  it("round-trips through loadStoredConfig", async () => {
    const { saveStoredConfig, loadStoredConfig } = await import("./store.js");

    saveStoredConfig({ provider: "openai", model: "gpt-5.4" });
    const loaded = loadStoredConfig();

    expect(loaded).toEqual({ provider: "openai", model: "gpt-5.4" });
  });

  it("never calls writeFileSync directly on the final config path (the actual atomicity guarantee)", async () => {
    const { saveStoredConfig, configFilePath } = await import("./store.js");

    saveStoredConfig({ provider: "gemini" });

    // The old implementation called writeFileSync(CONFIG_FILE, ...) directly,
    // so a real crash mid-write (not just a synchronous throw, which a mock
    // can't fully emulate) could leave config.json truncated. Writing only to
    // a distinct tmp path and renaming it into place is what actually
    // prevents that: the final path must never appear as a writeFileSync
    // target.
    expect(writeFileSyncPaths).not.toContain(configFilePath());
    expect(writeFileSyncPaths.some((p) => p.includes(".tmp"))).toBe(true);
  });

  it("a save that fails mid-write does not corrupt the previously saved config", async () => {
    const { saveStoredConfig, loadStoredConfig } = await import("./store.js");

    saveStoredConfig({ provider: "claude", model: "claude-opus-4-8" });

    // Simulate a crash during the *next* save: the tmp-file write throws
    // before renameSync is ever reached, so the previously-saved config.json
    // must be left completely untouched.
    writeFileSyncShouldThrow = true;
    expect(() => saveStoredConfig({ provider: "openai", model: "gpt-5.4" })).toThrow(/simulated crash/);
    writeFileSyncShouldThrow = false;

    expect(loadStoredConfig()).toEqual({ provider: "claude", model: "claude-opus-4-8" });
  });
});
