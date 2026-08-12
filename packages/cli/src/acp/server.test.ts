import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  type AnyMessage,
  type Client,
  type Stream,
} from "@zed-industries/agent-client-protocol";
import {
  Agent as EngineAgent,
  GraphContextEnricher,
  SkillActivator,
  ToolRegistry,
  type IProvider,
  type ResolvedConfig,
} from "@luckycli/core";
import type { BuiltAgentRuntime } from "../runtime.js";
import {
  AUTH_GUIDANCE,
  LuckyAcpAgent,
  serveAcp,
  type LuckyAcpAgentOptions,
  type RuntimeBuilder,
} from "./server.js";

// The server persists sessions to LuckyCLI's store (~/.luckycli/sessions) on
// every turn; point HOME at a throwaway dir for the whole suite so tests never
// touch the user's real store.
let suiteHome: string;
let realHome: string | undefined;
beforeAll(() => {
  realHome = process.env.HOME;
  suiteHome = mkdtempSync(join(tmpdir(), "lucky-acp-suite-home-"));
  process.env.HOME = suiteHome;
});
afterAll(() => {
  process.env.HOME = realHome;
  rmSync(suiteHome, { recursive: true, force: true });
});

/** Two cross-wired in-memory ACP streams: [agentSide, clientSide]. */
function connectedStreams(): [Stream, Stream] {
  const agentToClient = new TransformStream<AnyMessage, AnyMessage>();
  const clientToAgent = new TransformStream<AnyMessage, AnyMessage>();
  return [
    { writable: agentToClient.writable, readable: clientToAgent.readable },
    { writable: clientToAgent.writable, readable: agentToClient.readable },
  ];
}

type PermissionHandler = Client["requestPermission"];

/** Minimal editor stub: records session updates, never grants permissions
 * unless a handler is supplied. */
function stubClient(updates: unknown[] = [], onPermission?: PermissionHandler): Client {
  return {
    async requestPermission(params) {
      if (!onPermission) throw new Error("unexpected permission request in this test");
      return onPermission(params);
    },
    async sessionUpdate(params) {
      updates.push(params);
    },
  };
}

/** A connected [server, editor] pair over in-memory streams. */
function connect(
  options: LuckyAcpAgentOptions = {},
  onPermission?: PermissionHandler,
): {
  editor: ClientSideConnection;
  updates: unknown[];
  serverAgent: () => LuckyAcpAgent;
} {
  const [agentStream, clientStream] = connectedStreams();
  let serverAgent: LuckyAcpAgent | undefined;
  serveAcp(agentStream, (conn) => {
    serverAgent = new LuckyAcpAgent(conn, options);
    return serverAgent;
  });
  const updates: unknown[] = [];
  const editor = new ClientSideConnection(() => stubClient(updates, onPermission), clientStream);
  return { editor, updates, serverAgent: () => serverAgent! };
}

/** Chunks shaped like the engine's StreamChunk (not exported from core). */
type Chunk = {
  textDelta?: string;
  toolCall?: { type: "tool_call"; id: string; name: string; arguments: Record<string, unknown> };
  finishReason?: "stop" | "tool_calls";
  usage?: { inputTokens: number; outputTokens: number };
};

/**
 * Scripted engine provider (same pattern as core's agent tests): one batch of
 * chunks per generateStream call. When `hang` is set, the stream yields its
 * batch and then stalls until the abort signal fires — for cancel tests.
 */
function scriptedProvider(script: Chunk[][], opts: { hang?: boolean } = {}): IProvider {
  let turn = 0;
  return {
    info: {
      id: "claude",
      displayName: "Scripted",
      availableModels: ["mock"],
      defaultModel: "mock",
      supportsStreaming: true,
      supportsVision: true,
      supportsTools: true,
    },
    async *generateStream(_messages, config) {
      const batch = script[turn++] ?? [{ finishReason: "stop" as const }];
      for (const chunk of batch) yield chunk;
      // Only batches without a finish reason stall: they model a stream the
      // user interrupts, while finished batches complete normally.
      if (opts.hang && !batch.some((chunk) => chunk.finishReason)) {
        await new Promise<void>((_resolve, reject) => {
          const signal = config?.abortSignal;
          if (signal?.aborted) reject(abortError());
          signal?.addEventListener("abort", () => reject(abortError()));
        });
      }
    },
    async generate() {
      return { content: [], finishReason: "stop" as const };
    },
    async countTokens() {
      return undefined;
    },
    async healthCheck() {
      return { ok: true };
    },
  } as unknown as IProvider;
}

function abortError(): Error {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

/** A real engine agent driven by a scripted provider — no network, no disk. */
function engineAgent(
  script: Chunk[][],
  opts: { hang?: boolean; tools?: ToolRegistry } = {},
): EngineAgent {
  return new EngineAgent({
    provider: scriptedProvider(script, opts),
    model: "mock",
    tools: opts.tools ?? new ToolRegistry(),
  });
}

function fakeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    provider: "claude",
    model: "claude-sonnet-4-6",
    system: "sys",
    credentials: { kind: "api-key", apiKey: "sk-test" } as ResolvedConfig["credentials"],
    mcp: {},
    permissions: {},
    needsSetup: false,
    ...overrides,
  };
}

/** A runtime around a given engine agent (or an inert stub for bookkeeping). */
function fakeRuntime(agent?: EngineAgent): BuiltAgentRuntime {
  return {
    agent: (agent ?? ({} as BuiltAgentRuntime["agent"])) as BuiltAgentRuntime["agent"],
    skillActivator: new SkillActivator(),
    graphEnricher: new GraphContextEnricher("/tmp"),
  };
}

/** A connected editor whose single session runs the given engine agent. */
async function editorWithSession(agent: EngineAgent): Promise<{
  editor: ClientSideConnection;
  updates: unknown[];
  sessionId: string;
  serverAgent: () => LuckyAcpAgent;
}> {
  const { editor, updates, serverAgent } = connect({
    config: fakeConfig(),
    buildRuntime: (async () => fakeRuntime(agent)) as RuntimeBuilder,
  });
  const { sessionId } = await editor.newSession({ cwd: "/repo", mcpServers: [] });
  return { editor, updates, sessionId, serverAgent };
}

/**
 * Like editorWithSession, but the engine agent is built inside the runtime
 * builder so the ACP approval bridge (opts.approveTool) reaches it — the
 * honest wiring for permission tests.
 */
async function editorWithApprovalSession(
  script: Chunk[][],
  tools: ToolRegistry,
  onPermission: PermissionHandler,
): Promise<{ editor: ClientSideConnection; updates: unknown[]; sessionId: string }> {
  const { editor, updates } = connect(
    {
      config: fakeConfig(),
      buildRuntime: (async (opts: Parameters<RuntimeBuilder>[0]) =>
        fakeRuntime(
          new EngineAgent({
            provider: scriptedProvider(script),
            model: "mock",
            tools,
            approveTool: opts.approveTool,
          }),
        )) as RuntimeBuilder,
    },
    onPermission,
  );
  const { sessionId } = await editor.newSession({ cwd: "/repo", mcpServers: [] });
  return { editor, updates, sessionId };
}

describe("acp server initialize", () => {
  it("negotiates protocol v1 with LuckyCLI's capabilities and no auth methods", async () => {
    const { editor } = connect();
    const response = await editor.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    });

    expect(response.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(response.authMethods).toEqual([]);
    expect(response.agentCapabilities?.loadSession).toBe(true);
    expect(response.agentCapabilities?.promptCapabilities).toEqual({
      image: true,
      audio: false,
      embeddedContext: false,
    });
  });

  it("answers an unknown protocol version with the latest it supports", async () => {
    const { editor } = connect();
    const response = await editor.initialize({
      protocolVersion: 999,
      clientCapabilities: {},
    });
    expect(response.protocolVersion).toBe(PROTOCOL_VERSION);
  });
});

describe("acp server milestone gates", () => {
  it("rejects authenticate with the out-of-band login guidance", async () => {
    const { editor } = connect();
    await expect(editor.authenticate({ methodId: "anything" })).rejects.toMatchObject({
      code: -32600,
      data: { details: AUTH_GUIDANCE },
    });
  });

  it("rejects session/new without a usable config as auth-required", async () => {
    const { editor } = connect();
    await expect(
      editor.newSession({ cwd: "/tmp", mcpServers: [] }),
    ).rejects.toMatchObject({ code: -32000, data: { details: AUTH_GUIDANCE } });
  });

  it("rejects a prompt for an unknown session with invalid-params", async () => {
    const { editor } = connect();
    await expect(
      editor.prompt({
        sessionId: "nope",
        prompt: [{ type: "text", text: "hi" }],
      }),
    ).rejects.toMatchObject({ code: -32602 });
  });

  it("swallows stray cancel notifications without crashing the connection", async () => {
    const { editor } = connect();
    await editor.cancel({ sessionId: "nope" });
    // The connection must still answer requests after the stray notification.
    const response = await editor.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    });
    expect(response.protocolVersion).toBe(PROTOCOL_VERSION);
  });
});

describe("acp server sessions", () => {
  it("builds a runtime anchored to the editor's cwd and returns a session id", async () => {
    const buildRuntime = vi.fn(async () => fakeRuntime()) as unknown as RuntimeBuilder & {
      mock: { calls: [Parameters<RuntimeBuilder>[0]][] };
    };
    const { editor } = connect({ config: fakeConfig(), buildRuntime });

    const first = await editor.newSession({ cwd: "/repo/a", mcpServers: [] });
    const second = await editor.newSession({ cwd: "/repo/b", mcpServers: [] });

    expect(first.sessionId).toBeTruthy();
    expect(second.sessionId).toBeTruthy();
    expect(first.sessionId).not.toBe(second.sessionId);
    const cwds = buildRuntime.mock.calls.map(([opts]) => opts.cwd);
    expect(cwds).toEqual(["/repo/a", "/repo/b"]);
  });

  it("merges editor MCP servers under the user's own config", async () => {
    const buildRuntime = vi.fn(async () => fakeRuntime()) as unknown as RuntimeBuilder & {
      mock: { calls: [Parameters<RuntimeBuilder>[0]][] };
    };
    const config = fakeConfig({
      mcp: { docs: { type: "local", command: ["user-pinned"] } },
    });
    const { editor } = connect({ config, buildRuntime });

    await editor.newSession({
      cwd: "/repo",
      mcpServers: [
        { name: "docs", command: "editor-supplied", args: [], env: [] },
        { name: "extra", type: "http", url: "https://mcp.example.com", headers: [] },
      ],
    });

    const opts = buildRuntime.mock.calls[0]![0];
    expect(opts.mcp).toEqual({
      docs: { type: "local", command: ["user-pinned"] },
      extra: { type: "remote", url: "https://mcp.example.com" },
    });
  });

});

describe("acp server prompt streaming", () => {
  it("streams text as agent_message_chunk updates and stops with end_turn", async () => {
    const agent = engineAgent([
      [
        { textDelta: "Hello" },
        { textDelta: " editor" },
        { finishReason: "stop", usage: { inputTokens: 5, outputTokens: 2 } },
      ],
    ]);
    const { editor, updates, sessionId } = await editorWithSession(agent);

    const response = await editor.prompt({
      sessionId,
      prompt: [{ type: "text", text: "hi" }],
    });

    expect(response.stopReason).toBe("end_turn");
    expect(response._meta).toEqual({
      "dev.luckycli/usage": { inputTokens: 5, outputTokens: 2 },
    });
    expect(updates).toEqual([
      {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Hello" },
        },
      },
      {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: " editor" },
        },
      },
    ]);
  });

  it("accepts image blocks and records them on the user turn", async () => {
    const agent = engineAgent([[{ textDelta: "seen" }, { finishReason: "stop" }]]);
    const { editor, sessionId } = await editorWithSession(agent);

    await editor.prompt({
      sessionId,
      prompt: [
        { type: "text", text: "what is this?" },
        { type: "image", data: "aGk=", mimeType: "image/png" },
      ],
    });

    expect(agent.messages[0]!.content).toEqual([
      { type: "text", text: "what is this?" },
      { type: "image", data: "aGk=", mimeType: "image/png" },
    ]);
  });

  it("rejects unsupported content blocks with invalid-params", async () => {
    const agent = engineAgent([[{ textDelta: "unused" }, { finishReason: "stop" }]]);
    const { editor, sessionId } = await editorWithSession(agent);

    await expect(
      editor.prompt({
        sessionId,
        prompt: [
          { type: "resource_link", name: "x", uri: "file:///x" },
        ],
      }),
    ).rejects.toMatchObject({ code: -32602 });
  });

  it("rejects a second prompt while one is in flight", async () => {
    const agent = engineAgent([[{ textDelta: "…" }]], { hang: true });
    const { editor, sessionId } = await editorWithSession(agent);

    const first = editor.prompt({ sessionId, prompt: [{ type: "text", text: "go" }] });
    // Give the first prompt a beat to start streaming before the second lands.
    await new Promise((r) => setTimeout(r, 20));
    await expect(
      editor.prompt({ sessionId, prompt: [{ type: "text", text: "again" }] }),
    ).rejects.toMatchObject({ code: -32600 });

    await editor.cancel({ sessionId });
    await expect(first).resolves.toMatchObject({ stopReason: "cancelled" });
  });

  it("cancels an in-flight prompt and keeps the session usable", async () => {
    const agent = engineAgent(
      [[{ textDelta: "partial" }], [{ textDelta: "recovered" }, { finishReason: "stop" }]],
      { hang: true },
    );
    const { editor, sessionId } = await editorWithSession(agent);

    const inFlight = editor.prompt({ sessionId, prompt: [{ type: "text", text: "go" }] });
    await new Promise((r) => setTimeout(r, 20));
    await editor.cancel({ sessionId });
    const cancelled = await inFlight;
    expect(cancelled.stopReason).toBe("cancelled");

    // Only the first batch (no finish reason) stalls; the second completes.
    const next = await editor.prompt({ sessionId, prompt: [{ type: "text", text: "on" }] });
    expect(next.stopReason).toBe("end_turn");
  });

  it("reports tool calls as tool_call / tool_call_update pairs with diffs", async () => {
    const { defineTool } = await import("@luckycli/core");
    const { z } = await import("zod");
    const tools = new ToolRegistry();
    tools.register(
      defineTool({
        name: "fake_edit",
        description: "pretend edit",
        schema: z.object({ path: z.string() }),
        readonly: true,
        execute: async () => ({
          content: "edited",
          metadata: {
            diff: [
              {
                path: "src/a.ts",
                additions: 1,
                deletions: 0,
                hunks: [
                  {
                    oldStart: 1,
                    oldLines: 0,
                    newStart: 1,
                    newLines: 1,
                    lines: [{ type: "add" as const, text: "hi", newLine: 1 }],
                  },
                ],
              },
            ],
          },
        }),
      }),
    );
    const agent = engineAgent(
      [
        [
          {
            toolCall: {
              type: "tool_call",
              id: "call-1",
              name: "fake_edit",
              arguments: { path: "src/a.ts" },
            },
            finishReason: "tool_calls",
          },
        ],
        [{ textDelta: "done" }, { finishReason: "stop" }],
      ],
      { tools },
    );
    const { editor, updates, sessionId } = await editorWithSession(agent);

    const response = await editor.prompt({
      sessionId,
      prompt: [{ type: "text", text: "edit it" }],
    });
    expect(response.stopReason).toBe("end_turn");

    const kinds = updates.map((u) => (u as { update: { sessionUpdate: string } }).update.sessionUpdate);
    expect(kinds).toEqual(["tool_call", "tool_call_update", "agent_message_chunk"]);
    const start = (updates[0] as { update: Record<string, unknown> }).update;
    expect(start).toMatchObject({
      toolCallId: "call-1",
      title: "fake_edit src/a.ts",
      status: "in_progress",
      locations: [{ path: "/repo/src/a.ts" }],
    });
    const end = (updates[1] as { update: Record<string, unknown> }).update;
    expect(end).toMatchObject({ toolCallId: "call-1", status: "completed" });
    expect((end.content as unknown[])[1]).toMatchObject({
      type: "diff",
      path: "/repo/src/a.ts",
      newText: "hi",
    });
  });

  it("hides task_* and ask_user tool calls from the editor", async () => {
    const { defineTool } = await import("@luckycli/core");
    const { z } = await import("zod");
    const tools = new ToolRegistry();
    tools.register(
      defineTool({
        name: "task_create",
        description: "hidden",
        schema: z.object({}),
        readonly: true,
        execute: async () => ({ content: "ok" }),
      }),
    );
    const agent = engineAgent(
      [
        [
          {
            toolCall: { type: "tool_call", id: "c1", name: "task_create", arguments: {} },
            finishReason: "tool_calls",
          },
        ],
        [{ textDelta: "done" }, { finishReason: "stop" }],
      ],
      { tools },
    );
    const { editor, updates, sessionId } = await editorWithSession(agent);
    await editor.prompt({ sessionId, prompt: [{ type: "text", text: "go" }] });
    const kinds = updates.map((u) => (u as { update: { sessionUpdate: string } }).update.sessionUpdate);
    expect(kinds).toEqual(["agent_message_chunk"]);
  });

  it("aborts every in-flight prompt on abortAll (editor disconnected)", async () => {
    const agent = engineAgent([[{ textDelta: "…" }]], { hang: true });
    const { editor, sessionId, serverAgent } = await editorWithSession(agent);

    const inFlight = editor.prompt({ sessionId, prompt: [{ type: "text", text: "go" }] });
    await new Promise((r) => setTimeout(r, 20));
    serverAgent().abortAll();
    await expect(inFlight).resolves.toMatchObject({ stopReason: "cancelled" });
  });
});

describe("acp server permissions and modes", () => {
  /** A non-readonly tool (permission "ask") plus a two-turn script around it. */
  async function askToolSetup() {
    const { defineTool } = await import("@luckycli/core");
    const { z } = await import("zod");
    const tools = new ToolRegistry();
    tools.register(
      defineTool({
        name: "write_file",
        description: "fake write",
        schema: z.object({ path: z.string() }),
        readonly: false,
        execute: async () => ({ content: "written" }),
      }),
    );
    const turn = (id: string): Chunk[] => [
      {
        toolCall: { type: "tool_call", id, name: "write_file", arguments: { path: "a.ts" } },
        finishReason: "tool_calls",
      },
    ];
    const done: Chunk[] = [{ textDelta: "ok" }, { finishReason: "stop" }];
    return { tools, turn, done };
  }

  it("asks the editor and honors allow_once (asking again next time)", async () => {
    const { tools, turn, done } = await askToolSetup();
    const permissions: unknown[] = [];
    const { editor, updates, sessionId } = await editorWithApprovalSession(
      [turn("c1"), turn("c2"), done],
      tools,
      async (params) => {
        permissions.push(params);
        return { outcome: { outcome: "selected", optionId: "allow_once" } };
      },
    );

    await editor.prompt({ sessionId, prompt: [{ type: "text", text: "write twice" }] });
    expect(permissions).toHaveLength(2);
    expect(permissions[0]).toMatchObject({
      sessionId,
      toolCall: { toolCallId: "c1", title: "write_file a.ts", kind: "edit" },
      options: [
        { optionId: "allow_once", kind: "allow_once", name: "Allow once" },
        { optionId: "allow_always", kind: "allow_always", name: "Allow always" },
        { optionId: "reject_once", kind: "reject_once", name: "Reject" },
      ],
    });
    const ends = updates.filter(
      (u) => (u as { update: { sessionUpdate: string } }).update.sessionUpdate === "tool_call_update",
    );
    expect(ends).toHaveLength(2);
    expect(ends.every((u) => (u as { update: { status: string } }).update.status === "completed")).toBe(true);
  });

  it("remembers allow_always and stops asking", async () => {
    const { tools, turn, done } = await askToolSetup();
    let asked = 0;
    const { editor, sessionId } = await editorWithApprovalSession(
      [turn("c1"), turn("c2"), done],
      tools,
      async () => {
        asked += 1;
        return { outcome: { outcome: "selected", optionId: "allow_always" } };
      },
    );
    await editor.prompt({ sessionId, prompt: [{ type: "text", text: "write twice" }] });
    expect(asked).toBe(1);
  });

  it("treats reject and cancelled outcomes as denials", async () => {
    const { tools, turn, done } = await askToolSetup();
    const outcomes: Array<{ outcome: "selected"; optionId: string } | { outcome: "cancelled" }> = [
      { outcome: "selected", optionId: "reject_once" },
      { outcome: "cancelled" },
    ];
    const { editor, updates, sessionId } = await editorWithApprovalSession(
      [turn("c1"), turn("c2"), done],
      tools,
      async () => ({ outcome: outcomes.shift()! }),
    );
    await editor.prompt({ sessionId, prompt: [{ type: "text", text: "write twice" }] });
    const ends = updates.filter(
      (u) => (u as { update: { sessionUpdate: string } }).update.sessionUpdate === "tool_call_update",
    );
    expect(ends).toHaveLength(2);
    expect(ends.every((u) => (u as { update: { status: string } }).update.status === "failed")).toBe(true);
  });

  it("accept-edits mode auto-approves edit tools without a round trip", async () => {
    const { tools, turn, done } = await askToolSetup();
    const { editor, updates, sessionId } = await editorWithApprovalSession(
      [turn("c1"), done],
      tools,
      async () => {
        throw new Error("must not ask in accept-edits mode");
      },
    );
    await editor.setSessionMode({ sessionId, modeId: "accept-edits" });
    await editor.prompt({ sessionId, prompt: [{ type: "text", text: "write" }] });
    const end = updates.find(
      (u) => (u as { update: { sessionUpdate: string } }).update.sessionUpdate === "tool_call_update",
    );
    expect((end as { update: { status: string } }).update.status).toBe("completed");
  });

  it("rejects an unknown session mode", async () => {
    const agent = engineAgent([[{ textDelta: "hi" }, { finishReason: "stop" }]]);
    const { editor, sessionId } = await editorWithSession(agent);
    await expect(
      editor.setSessionMode({ sessionId, modeId: "yolo" }),
    ).rejects.toMatchObject({ code: -32602 });
  });

  it("presents a plan as plan+body updates and maps the decision", async () => {
    const outcomes: Array<{ outcome: "selected"; optionId: string } | { outcome: "cancelled" }> = [
      { outcome: "selected", optionId: "accept" },
      { outcome: "selected", optionId: "reject" },
      { outcome: "cancelled" },
    ];
    let presentPlan: ((plan: unknown) => Promise<unknown>) | undefined;
    const { editor, updates } = connect(
      {
        config: fakeConfig(),
        buildRuntime: (async (opts: Parameters<RuntimeBuilder>[0]) => {
          presentPlan = opts.presentPlan as typeof presentPlan;
          return fakeRuntime();
        }) as RuntimeBuilder,
      },
      async () => ({ outcome: outcomes.shift()! }),
    );
    await editor.newSession({ cwd: "/repo", mcpServers: [] });

    const plan = {
      title: "Refactor",
      markdown: "1. a\n2. b",
      tasks: [{ subject: "Do a", description: "" }],
    };
    expect(await presentPlan!(plan)).toEqual({ action: "accept" });
    expect(await presentPlan!(plan)).toEqual({ action: "reject" });
    expect(await presentPlan!(plan)).toEqual({ action: "reject" }); // cancelled

    const kinds = updates.map((u) => (u as { update: { sessionUpdate: string } }).update.sessionUpdate);
    expect(kinds.slice(0, 2)).toEqual(["plan", "agent_message_chunk"]);
  });

  it("serves ask_user options through the permission surface and degrades free text", async () => {
    const { ASK_USER_FALLBACK } = await import("./server.js");
    const outcomes: Array<{ outcome: "selected"; optionId: string } | { outcome: "cancelled" }> = [
      { outcome: "selected", optionId: "option-1" },
      { outcome: "cancelled" },
    ];
    let askUser: ((req: unknown) => Promise<string>) | undefined;
    const { editor } = connect(
      {
        config: fakeConfig(),
        buildRuntime: (async (opts: Parameters<RuntimeBuilder>[0]) => {
          askUser = opts.askUser as typeof askUser;
          return fakeRuntime();
        }) as RuntimeBuilder,
      },
      async () => ({ outcome: outcomes.shift()! }),
    );
    await editor.newSession({ cwd: "/repo", mcpServers: [] });

    // A selected option resolves to its text.
    await expect(
      askUser!({ question: "Which db?", options: ["sqlite", "postgres"], allowFreeText: true }),
    ).resolves.toBe("postgres");
    // A cancelled picker falls back to the instruction error.
    await expect(
      askUser!({ question: "Which db?", options: ["sqlite", "postgres"], allowFreeText: true }),
    ).rejects.toThrow(ASK_USER_FALLBACK);
    // Free text has no ACP channel at all.
    await expect(
      askUser!({ question: "Name the branch", allowFreeText: true }),
    ).rejects.toThrow(ASK_USER_FALLBACK);
  });

  it("advertises the mode roster on session/new", async () => {
    const agent = engineAgent([[{ textDelta: "hi" }, { finishReason: "stop" }]]);
    const { editor } = connect({
      config: fakeConfig(),
      buildRuntime: (async () => fakeRuntime(agent)) as RuntimeBuilder,
    });
    const response = await editor.newSession({ cwd: "/repo", mcpServers: [] });
    expect(response.modes).toMatchObject({
      currentModeId: "default",
      availableModes: [
        { id: "default" },
        { id: "accept-edits" },
        { id: "bypass-permissions" },
      ],
    });
  });
});

describe("acp server session load and persistence", () => {
  it("persists a session after a turn and reloads it with a text replay", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const fakeHome = await mkdtemp(join(tmpdir(), "lucky-acp-home-"));
    const previousHome = process.env.HOME;
    process.env.HOME = fakeHome;
    try {
      // Turn 1: run a prompt so the server persists the session to the store.
      const agent = engineAgent([[{ textDelta: "the answer" }, { finishReason: "stop" }]]);
      const { editor, sessionId } = await editorWithSession(agent);
      await editor.prompt({ sessionId, prompt: [{ type: "text", text: "the question" }] });

      // A fresh connection (new process, conceptually) loads it back.
      const resumed = engineAgent([[{ textDelta: "again" }, { finishReason: "stop" }]]);
      const { editor: editor2, updates } = connect({
        config: fakeConfig(),
        buildRuntime: (async (opts: Parameters<RuntimeBuilder>[0]) => {
          expect(opts.messages).toHaveLength(2); // user + assistant restored
          return fakeRuntime(resumed);
        }) as RuntimeBuilder,
      });
      const response = await editor2.loadSession({
        sessionId,
        cwd: "/repo",
        mcpServers: [],
      });
      expect(response.modes).toMatchObject({ currentModeId: "default" });
      expect(updates).toEqual([
        {
          sessionId,
          update: {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: "the question" },
          },
        },
        {
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "the answer" },
          },
        },
      ]);

      // The loaded session accepts new prompts under the same id.
      const next = await editor2.prompt({
        sessionId,
        prompt: [{ type: "text", text: "more" }],
      });
      expect(next.stopReason).toBe("end_turn");
    } finally {
      process.env.HOME = previousHome;
      await rm(fakeHome, { recursive: true, force: true });
    }
  });

  it("rejects loading an unknown session id", async () => {
    const { editor } = connect({ config: fakeConfig() });
    await expect(
      editor.loadSession({ sessionId: "ses_missing_x", cwd: "/repo", mcpServers: [] }),
    ).rejects.toMatchObject({ code: -32602 });
  });
});

describe("acp server misc", () => {
  it("keeps answering after a cancel for an unknown session", async () => {
    const { editor } = connect();
    await editor.cancel({ sessionId: "nope" });
    // The connection must still answer requests after the stray notification.
    const response = await editor.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    });
    expect(response.protocolVersion).toBe(PROTOCOL_VERSION);
  });
});
