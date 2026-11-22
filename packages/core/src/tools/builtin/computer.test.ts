import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runComputerAction, type ComputerDeps } from "./computer.js";

describe("computer use", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "lucky-computer-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  function deps(overrides: Partial<ComputerDeps> = {}): ComputerDeps {
    return {
      platform: "darwin",
      cwd,
      runAppleScript: vi.fn(async () => "Safari, Terminal"),
      screenshot: vi.fn(async () => {}),
      ...overrides,
    };
  }

  it("lists apps and windows through System Events", async () => {
    const run = vi.fn(async () => "Safari, Terminal");
    const d = deps({ runAppleScript: run });
    expect(await runComputerAction({ action: "list_apps" }, d)).toBe("Safari, Terminal");
    expect(run.mock.calls[0]?.[0]).toContain('every process whose background only is false');

    run.mockResolvedValueOnce("Main");
    expect(await runComputerAction({ action: "list_windows", app: 'My "App"' }, d)).toBe("Main");
    expect(run.mock.calls[1]?.[0]).toContain('process "My \\"App\\""');
  });

  it("reads a text UI tree with a bounded script", async () => {
    const run = vi.fn(async () => '[{"role":"AXButton","name":"Reload"}]');
    const out = await runComputerAction({ action: "ui_tree", app: "Safari" }, deps({ runAppleScript: run }));
    expect(out).toContain("Reload");
    const script = run.mock.calls[0]?.[0] as string;
    expect(script).toContain('processes.byName("Safari")');
    expect(script).toContain("out.length >= 250");
  });

  it("types escaped text and presses named or single-character keys", async () => {
    const run = vi.fn(async () => "");
    const d = deps({ runAppleScript: run });
    await runComputerAction({ action: "type", text: 'a"b\\c', modifiers: ["command"] }, d);
    expect(run.mock.calls[0]?.[0]).toContain('keystroke "a\\"b\\\\c" using {command down}');

    await runComputerAction({ action: "key", key: "return" }, d);
    expect(run.mock.calls[1]?.[0]).toContain("key code 36");

    await runComputerAction({ action: "key", key: "c", modifiers: ["command", "shift"] }, d);
    expect(run.mock.calls[2]?.[0]).toContain('keystroke "c" using {command down, shift down}');

    await expect(runComputerAction({ action: "key", key: "not-a-key" }, d)).rejects.toThrow(
      /Unknown key/,
    );
  });

  it("clicks coordinates and saves a screenshot under .lucky", async () => {
    const screenshot = vi.fn(async () => {});
    const out = await runComputerAction(
      { action: "screenshot" },
      deps({ screenshot }),
    );
    expect(out).toMatch(/Screenshot saved to \.lucky\/screenshots\//);
    expect(screenshot).toHaveBeenCalledWith(expect.stringContaining(join(".lucky", "screenshots")));

    const run = vi.fn(async () => "");
    const clicked = await runComputerAction(
      { action: "click", x: 10.4, y: 20.6 },
      deps({ runAppleScript: run }),
    );
    expect(clicked).toBe("Clicked at 10, 21.");
    expect(run.mock.calls[0]?.[0]).toContain("click at {10, 21}");
  });

  it("refuses non-macOS hosts", async () => {
    await expect(
      runComputerAction({ action: "list_apps" }, deps({ platform: "linux" })),
    ).rejects.toThrow(/macOS only/);
  });
});
