import { describe, expect, it } from "vitest";
import { messagesToItems, patchLastTool, type Item } from "./items.js";

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
