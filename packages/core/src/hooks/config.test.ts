import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeHookConfig, loadHookConfig } from "./config.js";

describe("loadHookConfig", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lucky-hookconfig-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("loads .lucky/hooks.json and accepts a wrapped hooks object", async () => {
    await mkdir(join(root, ".lucky"), { recursive: true });
    await writeFile(
      join(root, ".lucky", "hooks.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "exec", hooks: [{ type: "command", command: "true" }] },
          ],
          SessionStart: [{ hooks: [{ type: "prompt", prompt: "hello" }] }],
        },
      }),
      "utf8",
    );
    const loaded = loadHookConfig(root, {});
    expect(loaded.errors).toEqual([]);
    expect(loaded.sources).toHaveLength(1);
    expect(loaded.config.PreToolUse?.[0]?.matcher).toBe("exec");
    expect(describeHookConfig(loaded.config)).toEqual([
      { event: "PreToolUse", matchers: ["exec"], handlers: 1 },
      { event: "SessionStart", matchers: ["*"], handlers: 1 },
    ]);
  });

  it("merges global and project hooks", async () => {
    await mkdir(join(root, ".lucky"), { recursive: true });
    await writeFile(
      join(root, ".lucky", "hooks.json"),
      JSON.stringify({ Stop: [{ hooks: [{ type: "prompt", prompt: "project" }] }] }),
      "utf8",
    );
    const loaded = loadHookConfig(root, {}, {
      Stop: [{ hooks: [{ type: "prompt", prompt: "global" }] }],
    });
    expect(loaded.config.Stop).toHaveLength(2);
    expect(loaded.sources.map((source) => source.path)).toEqual([
      "~/.luckycli/config.json",
      join(root, ".lucky", "hooks.json"),
    ]);
  });

  it("reports unknown events and malformed handlers without dropping the rest", async () => {
    await mkdir(join(root, ".lucky"), { recursive: true });
    await writeFile(
      join(root, ".lucky", "hooks.json"),
      JSON.stringify({
        MadeUpEvent: [{ hooks: [{ type: "command", command: "true" }] }],
        PreToolUse: [
          { hooks: [{ type: "command" }] },
          { hooks: [{ type: "prompt", prompt: "ok" }] },
        ],
      }),
      "utf8",
    );
    const loaded = loadHookConfig(root, {});
    expect(loaded.errors.join("\n")).toMatch(/unknown hook event "MadeUpEvent"/);
    expect(loaded.errors.join("\n")).toMatch(/command: expected a non-empty string/);
    expect(loaded.config.PreToolUse).toHaveLength(1);
  });

  it("reports a broken JSON file and honors the disable flag", async () => {
    await mkdir(join(root, ".lucky"), { recursive: true });
    await writeFile(join(root, ".lucky", "hooks.json"), "{ nope", "utf8");
    const loaded = loadHookConfig(root, { LUCKY_DISABLE_HOOKS: "1" });
    expect(loaded.disabled).toBe(true);
    expect(loaded.errors[0]).toMatch(/hooks\.json/);
  });

  it("uses LUCKY_HOOKS_FILE instead of .lucky/hooks.json", async () => {
    const file = join(root, "team-hooks.json");
    await writeFile(
      file,
      JSON.stringify({ Stop: [{ hooks: [{ type: "prompt", prompt: "team" }] }] }),
      "utf8",
    );
    const loaded = loadHookConfig(root, { LUCKY_HOOKS_FILE: file });
    expect(loaded.config.Stop).toHaveLength(1);
    expect(loaded.sources[0]?.path).toBe(file);
  });
});
