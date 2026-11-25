import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentSideConnection } from "@zed-industries/agent-client-protocol";
import type { ResolvedConfig } from "@luckycli/core";
import { BrowserChat, chatEventFromUpdate, composePrompt } from "./chat.js";
import { readBrowserChatCwd, writeBrowserChatCwd } from "./chat-cwd.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "lucky-browser-chat-"));
  temps.push(dir);
  return dir;
}

describe("browser chat cwd", () => {
  it("round-trips the project directory", async () => {
    const home = temp();
    await writeBrowserChatCwd("/repo/project", home);
    expect(readBrowserChatCwd(home)).toBe("/repo/project");
  });

  it("falls back to the home directory", () => {
    expect(readBrowserChatCwd(temp())).toContain("/");
  });
});

describe("chatEventFromUpdate", () => {
  it("maps text, reasoning, tool and plan updates", () => {
    expect(
      chatEventFromUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } }),
    ).toEqual({ kind: "text", text: "hi" });
    expect(
      chatEventFromUpdate({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hm" } }),
    ).toEqual({ kind: "reasoning", text: "hm" });
    expect(chatEventFromUpdate({ sessionUpdate: "tool_call", title: "Read file", status: "pending" })).toEqual({
      kind: "tool",
      title: "Read file",
      status: "pending",
    });
    expect(chatEventFromUpdate({ sessionUpdate: "plan", entries: [] })).toMatchObject({ kind: "plan" });
  });

  it("carries the tool call id, kind, input and output for the panel row", () => {
    expect(
      chatEventFromUpdate({
        sessionUpdate: "tool_call_update",
        toolCallId: "t9",
        title: "read_page",
        status: "completed",
        kind: "fetch",
        rawInput: { tabId: 3 },
        content: [{ type: "content", content: { type: "text", text: "tree" } }],
      }),
    ).toEqual({
      kind: "tool",
      title: "read_page",
      status: "completed",
      id: "t9",
      toolKind: "fetch",
      input: '{"tabId":3}',
      output: "tree",
    });
  });

  it("ignores bookkeeping updates and non-text chunks", () => {
    expect(chatEventFromUpdate({ sessionUpdate: "available_commands_update" })).toBeUndefined();
    expect(chatEventFromUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "image" } })).toBeUndefined();
    expect(chatEventFromUpdate(null)).toBeUndefined();
  });
});

describe("composePrompt", () => {
  it("adds the browser preamble only on the first turn and the tab on every turn", () => {
    const tab = { tab: { title: "Example", url: "https://example.com/" } };
    const first = composePrompt("summarize", tab, true);
    expect(first).toContain("<browser-chat>");
    expect(first).toContain('url="https://example.com/"');
    expect(first.endsWith("summarize")).toBe(true);
    const later = composePrompt("and now?", tab, false);
    expect(later).not.toContain("<browser-chat>");
    expect(later).toContain("<current-tab");
    expect(composePrompt("hi", undefined, false)).toBe("hi");
  });
});

describe("BrowserChat", () => {
  it("streams a prompt through the ACP session", async () => {
    const sent: Array<Record<string, unknown>> = [];
    let conn: AgentSideConnection | undefined;
    const fake = {
      initialize: async () => ({ protocolVersion: "1", agentCapabilities: {} }),
      newSession: async () => ({ sessionId: "s1" }),
      prompt: async () => {
        await conn!.sessionUpdate({
          sessionId: "s1",
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } },
        });
        return { stopReason: "end_turn" };
      },
      cancel: async () => {},
      abortAll: () => {},
    };
    const chat = new BrowserChat({
      sink: { send: (message) => sent.push(message) },
      cwd: "/repo",
      createAgent: (connection) => {
        conn = connection;
        return fake as never;
      },
      resolveConfig: () => ({ ok: true, config: {} as ResolvedConfig }),
    });

    await chat.send("hi");
    expect(sent.map((message) => message.type)).toEqual(["chat_start", "chat_event", "chat_done"]);
    expect(sent[1]?.event).toEqual({ kind: "text", text: "hello" });
  });

  it("asks the panel for approval and resumes with its choice", async () => {
    const sent: Array<Record<string, unknown>> = [];
    let conn: AgentSideConnection | undefined;
    let chosen: string | undefined;
    const fake = {
      initialize: async () => ({ protocolVersion: "1", agentCapabilities: {} }),
      newSession: async () => ({ sessionId: "s1" }),
      prompt: async () => {
        const response = await conn!.requestPermission({
          sessionId: "s1",
          toolCall: { toolCallId: "t1", title: "Edit main.ts" },
          options: [
            { optionId: "allow", name: "Allow", kind: "allow_once" },
            { optionId: "deny", name: "Deny", kind: "reject_once" },
          ],
        });
        chosen = response.outcome.outcome === "selected" ? response.outcome.optionId : undefined;
        return { stopReason: "end_turn" };
      },
      cancel: async () => {},
      abortAll: () => {},
    };
    const chat = new BrowserChat({
      sink: { send: (message) => sent.push(message) },
      cwd: "/repo",
      createAgent: (connection) => {
        conn = connection;
        return fake as never;
      },
      resolveConfig: () => ({ ok: true, config: {} as ResolvedConfig }),
    });

    const running = chat.send("fix it");
    for (let i = 0; i < 50 && !sent.some((message) => message.type === "approval_request"); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const request = sent.find((message) => message.type === "approval_request")!;
    expect(request.title).toBe("Edit main.ts");
    expect(chat.resolveApproval(String(request.id), "allow")).toBe(true);
    await running;
    expect(chosen).toBe("allow");
  });
});
