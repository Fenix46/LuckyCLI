import { describe, expect, it } from "vitest";
import type { FileDiff } from "@luckycli/core";
import {
  diffContents,
  toolCallEnd,
  toolCallStart,
  toolCallTitle,
  toolKind,
} from "./tool-calls.js";

describe("toolKind", () => {
  it("maps built-ins to editor categories and unknown tools to other", () => {
    expect(toolKind("read_file")).toBe("read");
    expect(toolKind("grep")).toBe("search");
    expect(toolKind("edit_file")).toBe("edit");
    expect(toolKind("exec")).toBe("execute");
    expect(toolKind("http_fetch")).toBe("fetch");
    expect(toolKind("graph_query")).toBe("think");
    expect(toolKind("some_mcp_tool")).toBe("other");
  });
});

describe("toolCallTitle", () => {
  it("appends the salient argument when present", () => {
    expect(toolCallTitle("read_file", { path: "src/a.ts" })).toBe("read_file src/a.ts");
    expect(toolCallTitle("exec", { command: "npm test" })).toBe("exec npm test");
    expect(toolCallTitle("grep", { pattern: "TODO" })).toBe("grep TODO");
  });

  it("falls back to the bare name", () => {
    expect(toolCallTitle("graph_overview", {})).toBe("graph_overview");
    expect(toolCallTitle("exec", null)).toBe("exec");
  });
});

describe("toolCallStart", () => {
  it("announces an in-progress call with kind, title, rawInput and location", () => {
    const update = toolCallStart(
      "s1",
      { id: "t1", name: "read_file", input: { path: "src/a.ts" } },
      "/repo",
    );
    expect(update).toEqual({
      sessionId: "s1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        title: "read_file src/a.ts",
        kind: "read",
        status: "in_progress",
        rawInput: { path: "src/a.ts" },
        locations: [{ path: "/repo/src/a.ts" }],
      },
    });
  });

  it("wraps non-object input for rawInput", () => {
    const update = toolCallStart("s1", { id: "t1", name: "exec", input: "ls" }, "/repo");
    const u = update.update as { rawInput?: Record<string, unknown> };
    expect(u.rawInput).toEqual({ value: "ls" });
  });
});

describe("toolCallEnd", () => {
  it("completes with textual content", () => {
    const update = toolCallEnd(
      "s1",
      { id: "t1", name: "grep", content: "3 matches", isError: false },
      "/repo",
    );
    expect(update.update).toMatchObject({
      sessionUpdate: "tool_call_update",
      toolCallId: "t1",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "3 matches" } }],
    });
  });

  it("marks failures", () => {
    const update = toolCallEnd(
      "s1",
      { id: "t1", name: "exec", content: "boom", isError: true },
      "/repo",
    );
    expect(update.update).toMatchObject({ status: "failed" });
  });
});

describe("diffContents", () => {
  const diff: FileDiff = {
    path: "src/a.ts",
    additions: 1,
    deletions: 1,
    hunks: [
      {
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 3,
        lines: [
          { type: "context", text: "const a = 1;", oldLine: 1, newLine: 1 },
          { type: "del", text: "const b = 2;", oldLine: 2 },
          { type: "add", text: "const b = 3;", newLine: 2 },
          { type: "context", text: "export {};", oldLine: 3, newLine: 3 },
        ],
      },
    ],
  };

  it("reconstructs old/new text per hunk with an absolute path", () => {
    expect(diffContents([diff], "/repo")).toEqual([
      {
        type: "diff",
        path: "/repo/src/a.ts",
        oldText: "const a = 1;\nconst b = 2;\nexport {};",
        newText: "const a = 1;\nconst b = 3;\nexport {};",
      },
    ]);
  });

  it("omits oldText for created files", () => {
    const created: FileDiff = {
      path: "new.ts",
      additions: 1,
      deletions: 0,
      created: true,
      hunks: [
        {
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: 1,
          lines: [{ type: "add", text: "hello", newLine: 1 }],
        },
      ],
    };
    const [content] = diffContents([created], "/repo");
    expect(content).toEqual({ type: "diff", path: "/repo/new.ts", newText: "hello" });
  });

  it("attaches diffs and locations to the closing update", () => {
    const update = toolCallEnd(
      "s1",
      { id: "t1", name: "edit_file", content: "edited", isError: false, metadata: { diff: [diff] } },
      "/repo",
    );
    const u = update.update as {
      content?: unknown[];
      locations?: { path: string }[];
    };
    expect(u.content).toHaveLength(2); // text + diff
    expect(u.locations).toEqual([{ path: "/repo/src/a.ts" }]);
  });
});
