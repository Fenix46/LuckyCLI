import { describe, expect, it } from "vitest";
import {
  activityDetail,
  activityTitle,
  activityVerbForTool,
  thinkingSynonym,
} from "./activity.js";

describe("activityVerbForTool", () => {
  it("maps the common tools to specific verbs", () => {
    expect(activityVerbForTool("read_file")).toBe("Reading");
    expect(activityVerbForTool("grep")).toBe("Searching");
    expect(activityVerbForTool("edit_file")).toBe("Editing");
    expect(activityVerbForTool("exec")).toBe("Running");
    expect(activityVerbForTool("verify")).toBe("Checking");
    expect(activityVerbForTool("spawn_agent")).toBe("Delegating");
  });

  it("falls back to Working for unknown tools (including MCP tools)", () => {
    expect(activityVerbForTool("some_server_some_tool")).toBe("Working");
  });
});

describe("thinkingSynonym", () => {
  it("rotates every ten seconds and starts at Thinking", () => {
    expect(thinkingSynonym(0)).toBe("Thinking");
    expect(thinkingSynonym(9)).toBe("Thinking");
    expect(thinkingSynonym(10)).toBe("Pondering");
    expect(thinkingSynonym(20)).toBe("Considering");
    expect(thinkingSynonym(50)).toBe("Thinking");
  });
});

describe("activityTitle", () => {
  it("prefers compaction, then retry, then the tool", () => {
    expect(
      activityTitle({ compacting: true, retry: { attempt: 1, maxAttempts: 3 }, toolName: "read_file", elapsedSeconds: 4 }),
    ).toBe("Summarizing");
    expect(activityTitle({ retry: { attempt: 2, maxAttempts: 3 }, toolName: "read_file", elapsedSeconds: 4 })).toBe(
      "Retrying (2/3)",
    );
    expect(activityTitle({ toolName: "read_file", elapsedSeconds: 4 })).toBe("Reading");
  });

  it("uses reasoning, streaming and the thinking fallback", () => {
    expect(activityTitle({ reasoning: true, elapsedSeconds: 4 })).toBe("Reasoning");
    expect(activityTitle({ streaming: true, elapsedSeconds: 4 })).toBe("Responding");
    expect(activityTitle({ elapsedSeconds: 0 })).toBe("Thinking");
    expect(activityTitle({ elapsedSeconds: 20 })).toBe("Considering");
  });
});

describe("activityDetail", () => {
  it("returns the tool target and nothing without a tool", () => {
    expect(activityDetail({ toolName: "read_file", toolInput: { path: "/a/b.ts" } })).toBe('"/a/b.ts"');
    expect(activityDetail({ toolName: "exec", toolInput: { command: "npm test" } })).toBe("npm test");
    expect(activityDetail({})).toBeUndefined();
    expect(activityDetail({ toolName: "read_file", toolInput: {} })).toBeUndefined();
  });
});
