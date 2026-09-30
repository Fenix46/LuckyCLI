import { describe, expect, it } from "vitest";
import { appendLiveOutput, collectDiffs, messagesToItems, patchLastTool, restartRunningTool, type Item } from "./items.js";

describe("patchLastTool", () => {
  it("attaches results by call id when the same tool runs twice", () => {
    const items: Item[] = [
      { kind: "tool", id: "a", name: "read_file", input: { path: "a.ts" }, startedAt: 1000 },
      { kind: "tool", id: "b", name: "read_file", input: { path: "b.ts" }, startedAt: 1000 },
    ];
    const next = patchLastTool(items, "read_file", "A", false, undefined, "a", 1250);
    expect(next[0]).toMatchObject({ output: "A", durationMs: 250 });
    expect(next[1]).not.toHaveProperty("output");
  });

  it("falls back to the latest unfinished row of that name without an id", () => {
    const items: Item[] = [
      { kind: "tool", name: "grep", input: {} },
      { kind: "tool", name: "grep", input: {} },
    ];
    const next = patchLastTool(items, "grep", "hit", false);
    expect(next[1]).toMatchObject({ output: "hit" });
    expect(next[0]).not.toHaveProperty("output");
    expect(next[1]).not.toHaveProperty("durationMs");
  });
});

describe("messagesToItems", () => {
  it("keeps the call id on resumed tool rows", () => {
    const items = messagesToItems([
      {
        role: "assistant",
        content: [{ type: "tool_call", id: "call-1", name: "exec", arguments: { command: "ls" } }],
      },
      {
        role: "tool",
        content: [{ type: "tool_result", toolCallId: "call-1", name: "exec", content: "a\nb" }],
      },
    ]);
    expect(items).toEqual([{ kind: "tool", id: "call-1", name: "exec", input: { command: "ls" }, output: "a\nb" }]);
  });
});

describe("restartRunningTool", () => {
  it("restarts the clock of the latest running row of that tool only", () => {
    const items: Item[] = [
      { kind: "tool", id: "a", name: "exec", input: {}, output: "done", startedAt: 1 },
      { kind: "tool", id: "b", name: "exec", input: {}, startedAt: 1 },
      { kind: "tool", id: "c", name: "read_file", input: {}, startedAt: 1 },
    ];
    const next = restartRunningTool(items, "exec", 500);
    expect(next[0]).toMatchObject({ startedAt: 1 });
    expect(next[1]).toMatchObject({ startedAt: 500 });
    expect(next[2]).toMatchObject({ startedAt: 1 });
  });
});

describe("appendLiveOutput", () => {
  it("appends to the running row for the call and ignores finished rows", () => {
    const items: Item[] = [
      { kind: "tool", id: "a", name: "exec", input: {} },
      { kind: "tool", id: "b", name: "exec", input: {}, output: "done" },
    ];
    const once = appendLiveOutput(items, "a", "x\n");
    const twice = appendLiveOutput(once, "a", "y\n");
    expect(twice[0]).toMatchObject({ live: "x\ny\n" });
    expect(appendLiveOutput(items, "b", "late")).toBe(items);
  });
});

describe("collectDiffs", () => {
  it("gathers successful tool diffs since the last user message, or for the session", () => {
    const d = (path: string) => ({ path, additions: 1, deletions: 0, hunks: [] });
    const items: Item[] = [
      { kind: "user", text: "one" },
      { kind: "tool", name: "edit_file", input: {}, output: "ok", metadata: { diff: [d("old.ts")] } },
      { kind: "user", text: "two" },
      { kind: "tool", name: "edit_file", input: {}, output: "ok", metadata: { diff: [d("a.ts")] } },
      { kind: "tool", name: "edit_file", input: {}, output: "fail", error: true, metadata: { diff: [d("bad.ts")] } },
      { kind: "tool", name: "apply_patch", input: {}, output: "ok", metadata: { diff: [d("b.ts"), d("c.ts")] } },
    ];
    expect(collectDiffs(items, "turn").map((x) => x.path)).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect(collectDiffs(items, "session").map((x) => x.path)).toEqual(["old.ts", "a.ts", "b.ts", "c.ts"]);
  });
});
