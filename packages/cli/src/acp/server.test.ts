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

/**
 * A connected [server, editor] pair over in-memory streams.
 *
 * `updates` omits `available_commands_update`: every session emits the command
 * roster on creation, and it is session setup rather than turn traffic, so
 * assertions about what a prompt produced would otherwise all have to skip it.
 * Tests that care about the roster read `allUpdates`.
 */
function connect(
  options: LuckyAcpAgentOptions = {},
  onPermission?: PermissionHandler,
): {
  editor: ClientSideConnection;
  updates: unknown[];
  allUpdates: unknown[];
  serverAgent: () => LuckyAcpAgent;
} {
  const [agentStream, clientStream] = connectedStreams();
  let serverAgent: LuckyAcpAgent | undefined;
  serveAcp(agentStream, (conn) => {
    serverAgent = new LuckyAcpAgent(conn, options);
    return serverAgent;
  });
  const allUpdates: unknown[] = [];
  const updates = turnUpdates(allUpdates);
  const editor = new ClientSideConnection(
    () => stubClient(allUpdates, onPermission),
    clientStream,
  );
  return { editor, updates, allUpdates, serverAgent: () => serverAgent! };
}

/**
 * A live view of `source` with the command roster filtered out. Backed by a
 * Proxy so it stays in sync as updates arrive after the array is handed out.
 */
function turnUpdates(source: unknown[]): unknown[] {
  const visible = (): unknown[] =>
    source.filter(
      (u) =>
        (u as { update?: { sessionUpdate?: string } }).update?.sessionUpdate !==
        "available_commands_update",
    );
  return new Proxy([] as unknown[], {
    get(_target, prop, receiver) {
      const current = visible();
      const value = Reflect.get(current, prop, receiver);
      return typeof value === "function" ? value.bind(current) : value;
    },
    has: (_target, prop) => Reflect.has(visible(), prop),
    ownKeys: () => Reflect.ownKeys(visible()),
    getOwnPropertyDescriptor: (_target, prop) =>
      Reflect.getOwnPropertyDescriptor(visible(), prop),
  });
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

/**
 * The tool_call_updates that close a call. Write tools also emit a `pending`
 * update carrying the pre-approval diff, which is not what these assertions
 * are about.
 */
function terminalToolUpdates(updates: unknown[]): unknown[] {
  return updates.filter((u) => {
    const update = (u as { update: { sessionUpdate: string; status?: string } }).update;
    return update.sessionUpdate === "tool_call_update" && update.status !== "pending";
  });
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
    expect(response._meta).toMatchObject({
      "dev.luckycli/usage": { inputTokens: 5, outputTokens: 2 },
      // The turn also reports where the context window stands.
      "dev.luckycli/context": { model: "mock", usedTokens: 5, tokenCounter: "provider" },
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
    const ends = terminalToolUpdates(updates);
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
    const ends = terminalToolUpdates(updates);
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

describe("acp server model selection", () => {
  /**
   * An in-memory stand-in for ~/.luckycli/config.json, injected into the agent
   * so these tests never read or write the user's real config — its path is
   * resolved from the OS home at import time and cannot be redirected with
   * $HOME.
   */
  function memoryStore(initial: Record<string, unknown>): NonNullable<
    LuckyAcpAgentOptions["store"]
  > & { current: () => Record<string, unknown> } {
    let config = initial;
    return {
      load: () => config as never,
      save: (next) => {
        config = next as Record<string, unknown>;
      },
      current: () => config,
    };
  }

  /**
   * Invoke `session/set_model` on the agent.
   *
   * Not routed through `editor.setSessionModel`: in SDK 0.4.5 that client
   * helper sends the `session/set_mode` method name (acp.js:434) while the
   * agent side correctly dispatches on `session/set_model` (acp.js:65), so the
   * SDK cannot call its own agent method. Real editors implement their own
   * client, so the agent handler is the surface worth testing; calling it
   * directly keeps these tests honest about what we actually ship.
   */
  function setModel(
    agent: LuckyAcpAgent,
    params: { sessionId: string; modelId: string },
  ): Promise<unknown> {
    return (agent as unknown as {
      setSessionModel: (p: { sessionId: string; modelId: string }) => Promise<unknown>;
    }).setSessionModel(params);
  }

  /** Two providers with credentials; gemini and the rest have none. */
  const twoProviders = () => ({
    provider: "claude",
    model: "claude-sonnet-5",
    credentials: {
      claude: { kind: "api-key", apiKey: "sk-a" },
      openai: { kind: "api-key", apiKey: "sk-b" },
    },
  });

  it("advertises the unified roster on session/new, active provider first", async () => {
    const agent = engineAgent([[{ textDelta: "hi" }, { finishReason: "stop" }]]);
    const { editor, serverAgent } = connect({
      config: fakeConfig(),
      buildRuntime: (async () => fakeRuntime(agent)) as RuntimeBuilder,
      store: memoryStore(twoProviders()),
    });
    const response = await editor.newSession({ cwd: "/repo", mcpServers: [] });

    // fakeConfig runs a model the static catalog doesn't list; it is still the
    // current selection, and leads its provider's entries.
    expect(response.models?.currentModelId).toBe("claude/claude-sonnet-4-6");
    const ids = response.models!.availableModels.map((m) => m.modelId);
    expect(ids[0]).toBe("claude/claude-sonnet-4-6");
    // Both catalogs are present, and every id is provider-qualified.
    expect(ids).toContain("claude/claude-sonnet-5");
    expect(ids).toContain("openai/gpt-4.1");
    // A provider with no credentials is not offered.
    expect(ids.some((id) => id.startsWith("gemini/"))).toBe(false);
    // Every openai entry follows every claude one (active provider first).
    const providers = ids.map((id) => id.split("/")[0]);
    expect(providers.indexOf("openai")).toBeGreaterThan(providers.lastIndexOf("claude"));
  });

  it("names roster entries so a flat picker still reads as provider + model", async () => {
    const agent = engineAgent([[{ textDelta: "hi" }, { finishReason: "stop" }]]);
    const { editor, serverAgent } = connect({
      config: fakeConfig(),
      buildRuntime: (async () => fakeRuntime(agent)) as RuntimeBuilder,
      store: memoryStore(twoProviders()),
    });
    const response = await editor.newSession({ cwd: "/repo", mcpServers: [] });
    const openai = response.models!.availableModels.find((m) => m.modelId === "openai/gpt-4.1");
    expect(openai?.name).toBe("OpenAI · gpt-4.1");
  });

  it("switches provider mid-session, carrying the conversation", async () => {
    const built: Parameters<RuntimeBuilder>[0][] = [];
    const agent = engineAgent([
      [{ textDelta: "first" }, { finishReason: "stop" }],
      [{ textDelta: "second" }, { finishReason: "stop" }],
    ]);
    const { editor, serverAgent } = connect({
      config: fakeConfig(),
      buildRuntime: (async (o: Parameters<RuntimeBuilder>[0]) => {
        built.push(o);
        return fakeRuntime(agent);
      }) as RuntimeBuilder,
      store: memoryStore(twoProviders()),
    });
    const { sessionId } = await editor.newSession({ cwd: "/repo", mcpServers: [] });
    await editor.prompt({ sessionId, prompt: [{ type: "text", text: "hello" }] });

    await setModel(serverAgent(), { sessionId, modelId: "openai/gpt-4.1" });

    // The rebuild used the new provider with its own credentials, and carried
    // the turn that already happened.
    expect(built).toHaveLength(2);
    expect(built[0]).toMatchObject({ provider: "claude", model: "claude-sonnet-4-6" });
    expect(built[1]).toMatchObject({ provider: "openai", model: "gpt-4.1" });
    expect(built[1]!.credentials).toMatchObject({ apiKey: "sk-b" });
    expect(built[1]!.messages).toHaveLength(2); // user + assistant
    // The session keeps its cwd and its bridges across the switch.
    expect(built[1]!.cwd).toBe("/repo");
    expect(built[1]!.approveTool).toBeTypeOf("function");
  });

  it("drops provider-specific knobs when switching away from their provider", async () => {
    const built: Parameters<RuntimeBuilder>[0][] = [];
    const agent = engineAgent([[{ textDelta: "hi" }, { finishReason: "stop" }]]);
    const { editor, serverAgent } = connect({
      // Reasoning effort resolved for claude must not follow the session to
      // openai, which knows nothing about it.
      config: fakeConfig({ reasoningEffort: "high" }),
      buildRuntime: (async (o: Parameters<RuntimeBuilder>[0]) => {
        built.push(o);
        return fakeRuntime(agent);
      }) as RuntimeBuilder,
      store: memoryStore(twoProviders()),
    });
    const { sessionId } = await editor.newSession({ cwd: "/repo", mcpServers: [] });
    await setModel(serverAgent(), { sessionId, modelId: "openai/gpt-4.1" });

    expect(built[0]!.reasoningEffort).toBe("high");
    expect(built[1]!.reasoningEffort).toBeUndefined();
  });

  it("persists the switch so the TUI and the editor agree", async () => {
    const agent = engineAgent([[{ textDelta: "hi" }, { finishReason: "stop" }]]);
    const store = memoryStore(twoProviders());
    const { editor, serverAgent } = connect({
      config: fakeConfig(),
      buildRuntime: (async () => fakeRuntime(agent)) as RuntimeBuilder,
      store,
    });
    const { sessionId } = await editor.newSession({ cwd: "/repo", mcpServers: [] });
    await setModel(serverAgent(), { sessionId, modelId: "openai/gpt-4.1" });

    expect(store.current()).toMatchObject({ provider: "openai", model: "gpt-4.1" });
    // The credentials block survives the rewrite — this is the user's whole
    // config file, not just the two keys we changed.
    expect(store.current().credentials).toMatchObject({ claude: { apiKey: "sk-a" } });
  });

  it("reports the switched pair as the session's current model", async () => {
    const agent = engineAgent([[{ textDelta: "hi" }, { finishReason: "stop" }]]);
    const store = memoryStore(twoProviders());
    const { editor, serverAgent } = connect({
      config: fakeConfig(),
      buildRuntime: (async () => fakeRuntime(agent)) as RuntimeBuilder,
      store,
    });
    const { sessionId } = await editor.newSession({ cwd: "/repo", mcpServers: [] });
    await setModel(serverAgent(), { sessionId, modelId: "openai/gpt-4.1" });

    // A session/load of the same conversation reports the new selection.
    await editor.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] });
    const reloaded = await serverAgent().loadSession({
      sessionId,
      cwd: "/repo",
      mcpServers: [],
    });
    expect(reloaded.models?.currentModelId).toBe("openai/gpt-4.1");
  });

  it("rejects an unknown or unusable model id", async () => {
    const agent = engineAgent([[{ textDelta: "hi" }, { finishReason: "stop" }]]);
    const { editor, serverAgent } = connect({
      config: fakeConfig(),
      buildRuntime: (async () => fakeRuntime(agent)) as RuntimeBuilder,
      store: memoryStore(twoProviders()),
    });
    const { sessionId } = await editor.newSession({ cwd: "/repo", mcpServers: [] });

    // Not provider-qualified at all.
    await expect(
      setModel(serverAgent(), { sessionId, modelId: "gpt-4.1" }),
    ).rejects.toMatchObject({ code: -32602 });
    // A model the provider's catalog doesn't have.
    await expect(
      setModel(serverAgent(), { sessionId, modelId: "claude/not-a-model" }),
    ).rejects.toMatchObject({ code: -32602 });
    // A provider with no credentials configured.
    await expect(
      setModel(serverAgent(), { sessionId, modelId: "gemini/gemini-2.5-pro" }),
    ).rejects.toMatchObject({ code: -32602 });
  });

  it("refuses to switch while a prompt is in flight", async () => {
    const agent = engineAgent([[{ textDelta: "streaming" }]], { hang: true });
    const { editor, serverAgent } = connect({
      config: fakeConfig(),
      buildRuntime: (async () => fakeRuntime(agent)) as RuntimeBuilder,
      store: memoryStore(twoProviders()),
    });
    const { sessionId } = await editor.newSession({ cwd: "/repo", mcpServers: [] });
    const running = editor.prompt({ sessionId, prompt: [{ type: "text", text: "go" }] });
    await new Promise((r) => setTimeout(r, 20));

    await expect(
      setModel(serverAgent(), { sessionId, modelId: "openai/gpt-4.1" }),
    ).rejects.toMatchObject({ code: -32600 });

    await editor.cancel({ sessionId });
    await running;
  });

  it("rejects set_model for an unknown session", async () => {
    const { serverAgent } = connect({ config: fakeConfig() });
    await expect(
      setModel(serverAgent(), { sessionId: "nope", modelId: "claude/claude-sonnet-5" }),
    ).rejects.toMatchObject({ code: -32602 });
  });

  it("keeps the old runtime when the new provider fails to build", async () => {
    const agent = engineAgent([[{ textDelta: "hi" }, { finishReason: "stop" }]]);
    const store = memoryStore(twoProviders());
    let calls = 0;
    const { editor, serverAgent } = connect({
      config: fakeConfig(),
      buildRuntime: (async () => {
        calls += 1;
        if (calls > 1) throw new Error("provider exploded");
        return fakeRuntime(agent);
      }) as RuntimeBuilder,
      store,
    });
    const { sessionId } = await editor.newSession({ cwd: "/repo", mcpServers: [] });

    await expect(
      setModel(serverAgent(), { sessionId, modelId: "openai/gpt-4.1" }),
    ).rejects.toMatchObject({ code: -32603 });

    // The session is still usable on its original runtime, and the failed
    // switch was not persisted.
    const response = await editor.prompt({
      sessionId,
      prompt: [{ type: "text", text: "still there?" }],
    });
    expect(response.stopReason).toBe("end_turn");
    expect(store.current()).toMatchObject({ provider: "claude", model: "claude-sonnet-5" });
  });
});


describe("acp server slash commands", () => {
  /** The text of every agent_message_chunk the editor received. */
  function replies(updates: unknown[]): string[] {
    return updates
      .filter(
        (u) =>
          (u as { update: { sessionUpdate: string } }).update.sessionUpdate ===
          "agent_message_chunk",
      )
      .map((u) => (u as { update: { content: { text: string } } }).update.content.text);
  }

  it("advertises the command roster when a session is created", async () => {
    const agent = engineAgent([[{ textDelta: "hi" }, { finishReason: "stop" }]]);
    const { editor, allUpdates } = connect({
      config: fakeConfig(),
      buildRuntime: (async () => fakeRuntime(agent)) as RuntimeBuilder,
    });
    await editor.newSession({ cwd: "/repo", mcpServers: [] });

    const roster = allUpdates.find(
      (u) =>
        (u as { update: { sessionUpdate: string } }).update.sessionUpdate ===
        "available_commands_update",
    ) as { update: { availableCommands: { name: string; input?: { hint: string } }[] } };
    expect(roster).toBeDefined();
    const names = roster.update.availableCommands.map((c) => c.name);
    expect(names).toContain("graph");
    expect(names).toContain("status");
    expect(names).toContain("compact");
    expect(names).toContain("thinking");
    // Commands taking arguments advertise a hint for the editor's input.
    expect(roster.update.availableCommands.find((c) => c.name === "graph")?.input).toEqual({
      hint: "build|rebuild",
    });
  });

  it("runs a command inside the turn without consulting the model", async () => {
    let generated = 0;
    const agent = new EngineAgent({
      provider: {
        ...scriptedProvider([[{ textDelta: "model spoke" }, { finishReason: "stop" }]]),
        async *generateStream() {
          generated += 1;
          yield { finishReason: "stop" as const };
        },
      } as unknown as IProvider,
      model: "mock",
      tools: new ToolRegistry(),
    });
    const { editor, updates } = connect({
      config: fakeConfig(),
      buildRuntime: (async () => fakeRuntime(agent)) as RuntimeBuilder,
    });
    const { sessionId } = await editor.newSession({ cwd: "/repo", mcpServers: [] });

    const response = await editor.prompt({
      sessionId,
      prompt: [{ type: "text", text: "/status" }],
    });

    expect(response.stopReason).toBe("end_turn");
    expect(generated).toBe(0); // the model was never called
    expect(replies(updates).join("")).toContain("claude-sonnet-4-6");
  });

  it("builds the graph in the session cwd on /graph", async () => {
    const buildGraph = vi.fn(async () => ({
      fileCount: 7,
      nodeCount: 40,
      edgeCount: 55,
      droppedEdges: 0,
      path: "/repo/.luckycli/graph.json",
    }));
    const recordGraphBuilt = vi.fn();
    const agent = engineAgent([[{ textDelta: "hi" }, { finishReason: "stop" }]]);
    const { editor, updates } = connect({
      config: fakeConfig(),
      buildRuntime: (async () => fakeRuntime(agent)) as RuntimeBuilder,
      buildGraph: buildGraph as unknown as LuckyAcpAgentOptions["buildGraph"],
      recordGraphBuilt,
    });
    const { sessionId } = await editor.newSession({ cwd: "/workspace", mcpServers: [] });

    const response = await editor.prompt({
      sessionId,
      prompt: [{ type: "text", text: "/graph" }],
    });

    expect(response.stopReason).toBe("end_turn");
    expect(buildGraph).toHaveBeenCalledWith("/workspace");
    expect(recordGraphBuilt).toHaveBeenCalledWith("/workspace");
    expect(replies(updates).join("")).toContain("files: 7");
  });

  it("answers an unknown command with the roster instead of prompting the model", async () => {
    const agent = engineAgent([[{ textDelta: "model spoke" }, { finishReason: "stop" }]]);
    const { editor, updates } = connect({
      config: fakeConfig(),
      buildRuntime: (async () => fakeRuntime(agent)) as RuntimeBuilder,
    });
    const { sessionId } = await editor.newSession({ cwd: "/repo", mcpServers: [] });

    const response = await editor.prompt({
      sessionId,
      prompt: [{ type: "text", text: "/nonsense" }],
    });

    expect(response.stopReason).toBe("end_turn");
    const text = replies(updates).join("");
    expect(text).toContain("/nonsense");
    expect(text).toContain("/graph");
    expect(text).not.toContain("model spoke");
  });

  it("leaves an ordinary prompt alone", async () => {
    const agent = engineAgent([[{ textDelta: "model spoke" }, { finishReason: "stop" }]]);
    const { editor, updates } = connect({
      config: fakeConfig(),
      buildRuntime: (async () => fakeRuntime(agent)) as RuntimeBuilder,
    });
    const { sessionId } = await editor.newSession({ cwd: "/repo", mcpServers: [] });

    await editor.prompt({
      sessionId,
      // Mentions a slash, but not as the leading token.
      prompt: [{ type: "text", text: "fix src/a.ts please" }],
    });

    expect(replies(updates).join("")).toBe("model spoke");
  });

  it("keeps the session usable for a normal prompt after a command", async () => {
    const agent = engineAgent([[{ textDelta: "after" }, { finishReason: "stop" }]]);
    const { editor, updates } = connect({
      config: fakeConfig(),
      buildRuntime: (async () => fakeRuntime(agent)) as RuntimeBuilder,
    });
    const { sessionId } = await editor.newSession({ cwd: "/repo", mcpServers: [] });

    await editor.prompt({ sessionId, prompt: [{ type: "text", text: "/status" }] });
    const response = await editor.prompt({
      sessionId,
      prompt: [{ type: "text", text: "now do the work" }],
    });

    expect(response.stopReason).toBe("end_turn");
    expect(replies(updates).join("")).toContain("after");
  });

  it("rejects a command while a prompt is already running", async () => {
    const agent = engineAgent([[{ textDelta: "streaming" }]], { hang: true });
    const { editor } = connect({
      config: fakeConfig(),
      buildRuntime: (async () => fakeRuntime(agent)) as RuntimeBuilder,
    });
    const { sessionId } = await editor.newSession({ cwd: "/repo", mcpServers: [] });
    const running = editor.prompt({ sessionId, prompt: [{ type: "text", text: "go" }] });
    await new Promise((r) => setTimeout(r, 20));

    await expect(
      editor.prompt({ sessionId, prompt: [{ type: "text", text: "/status" }] }),
    ).rejects.toMatchObject({ code: -32600 });

    await editor.cancel({ sessionId });
    await running;
  });

  it("ends the turn cleanly when a command throws", async () => {
    const agent = engineAgent([[{ textDelta: "hi" }, { finishReason: "stop" }]]);
    const { editor, updates } = connect({
      config: fakeConfig(),
      buildRuntime: (async () => fakeRuntime(agent)) as RuntimeBuilder,
      buildGraph: (async () => {
        throw new Error("disk on fire");
      }) as unknown as LuckyAcpAgentOptions["buildGraph"],
    });
    const { sessionId } = await editor.newSession({ cwd: "/repo", mcpServers: [] });

    const response = await editor.prompt({
      sessionId,
      prompt: [{ type: "text", text: "/graph" }],
    });

    expect(response.stopReason).toBe("end_turn");
    expect(replies(updates).join("")).toContain("disk on fire");
  });
});

describe("acp server context usage", () => {
  /** The _meta of every update that carried one, in order. */
  function metas(updates: unknown[]): Record<string, unknown>[] {
    return updates
      .map((u) => (u as { update: { _meta?: Record<string, unknown> } }).update._meta)
      .filter((meta): meta is Record<string, unknown> => meta !== undefined);
  }

  it("publishes only the fields it committed to, never raw ContextStatus", async () => {
    const agent = engineAgent([
      [{ textDelta: "hi" }, { finishReason: "stop", usage: { inputTokens: 5, outputTokens: 2 } }],
    ]);
    const { editor } = connect({
      config: fakeConfig(),
      buildRuntime: (async () => fakeRuntime(agent)) as RuntimeBuilder,
    });
    const { sessionId } = await editor.newSession({ cwd: "/repo", mcpServers: [] });
    const response = await editor.prompt({
      sessionId,
      prompt: [{ type: "text", text: "hi" }],
    });

    const context = (response._meta as Record<string, Record<string, unknown>>)[
      "dev.luckycli/context"
    ]!;
    expect(context.model).toBe("mock");
    expect(context.tokenCounter).toBeDefined();
    // Internal bookkeeping fields stay internal — the published shape is a
    // contract for custom clients, not a dump of the engine's state.
    expect(context).not.toHaveProperty("ratio");
    expect(context).not.toHaveProperty("source");
    expect(context).not.toHaveProperty("maxInputTokens");
  });

  it("reports the turn's reading on the response, which is where it lands", async () => {
    const agent = engineAgent([
      [{ textDelta: "hi" }, { finishReason: "stop", usage: { inputTokens: 5, outputTokens: 2 } }],
    ]);
    const { editor, updates } = connect({
      config: fakeConfig(),
      buildRuntime: (async () => fakeRuntime(agent)) as RuntimeBuilder,
    });
    const { sessionId } = await editor.newSession({ cwd: "/repo", mcpServers: [] });
    const response = await editor.prompt({
      sessionId,
      prompt: [{ type: "text", text: "hi" }],
    });

    // The engine emits its context reading immediately before turn_end, so no
    // notification is left to carry it…
    expect(metas(updates)).toEqual([]);
    // …and the response is where the editor finds it.
    expect(
      (response._meta as Record<string, { usedTokens: number }>)["dev.luckycli/context"],
    ).toMatchObject({ model: "mock", usedTokens: 5 });
  });

  it("does not attach _meta to updates when there is no reading to report", async () => {
    // No usage in the script → the engine reports no context event.
    const agent = engineAgent([[{ textDelta: "plain" }, { finishReason: "stop" }]]);
    const { editor, updates } = connect({
      config: fakeConfig(),
      buildRuntime: (async () => fakeRuntime(agent)) as RuntimeBuilder,
    });
    const { sessionId } = await editor.newSession({ cwd: "/repo", mcpServers: [] });
    const response = await editor.prompt({
      sessionId,
      prompt: [{ type: "text", text: "hi" }],
    });

    expect(metas(updates)).toEqual([]);
    expect(response._meta).toBeUndefined();
  });

  it("reports the same figures through /context as through _meta", async () => {
    const agent = engineAgent([
      [{ textDelta: "hi" }, { finishReason: "stop", usage: { inputTokens: 12, outputTokens: 3 } }],
    ]);
    const { editor, updates } = connect({
      config: fakeConfig(),
      buildRuntime: (async () => fakeRuntime(agent)) as RuntimeBuilder,
    });
    const { sessionId } = await editor.newSession({ cwd: "/repo", mcpServers: [] });
    const response = await editor.prompt({
      sessionId,
      prompt: [{ type: "text", text: "hi" }],
    });
    const fromMeta = (response._meta as Record<string, { usedTokens: number }>)[
      "dev.luckycli/context"
    ]!;

    await editor.prompt({ sessionId, prompt: [{ type: "text", text: "/context" }] });
    const text = updates
      .filter(
        (u) =>
          (u as { update: { sessionUpdate: string } }).update.sessionUpdate ===
          "agent_message_chunk",
      )
      .map((u) => (u as { update: { content: { text: string } } }).update.content.text)
      .join("");

    // The command is the portable path to the numbers _meta carries.
    expect(text).toContain(String(fromMeta.usedTokens));
  });
});

describe("acp server pre-approval diffs", () => {
  /**
   * A session anchored to a real temp dir running the real file tools, so the
   * preview reads and diffs actual files. Returns everything a test needs to
   * assert on the ordered traffic the editor saw.
   */
  async function diffSession(
    files: Record<string, string>,
    call: { name: string; arguments: Record<string, unknown> },
    opts: {
      fsCapable?: boolean;
      /** Unsaved editor buffers, keyed by absolute path under this run's root. */
      bufferFor?: (root: string) => Record<string, string>;
      extraTools?: Parameters<ToolRegistry["register"]>[0][];
    } = {},
  ): Promise<{
    root: string;
    updates: unknown[];
    permissions: unknown[];
    cleanup: () => Promise<void>;
  }> {
    const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { applyPatchTool, editFileTool, writeFileTool } = await import("@luckycli/core");

    const root = await mkdtemp(join(tmpdir(), "lucky-acp-diff-"));
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(root, name), content, "utf8");
    }

    const tools = new ToolRegistry()
      .register(editFileTool)
      .register(writeFileTool)
      .register(applyPatchTool);
    for (const tool of opts.extraTools ?? []) tools.register(tool);
    const script: Chunk[][] = [
      [{ toolCall: { type: "tool_call", id: "c1", ...call }, finishReason: "tool_calls" }],
      [{ textDelta: "done" }, { finishReason: "stop" }],
    ];

    const permissions: unknown[] = [];
    const allUpdates: unknown[] = [];
    const updates = turnUpdates(allUpdates);
    const [agentStream, clientStream] = connectedStreams();
    serveAcp(agentStream, (conn) =>
      new LuckyAcpAgent(conn, {
        config: fakeConfig(),
        buildRuntime: (async (o: Parameters<RuntimeBuilder>[0]) =>
          fakeRuntime(
            new EngineAgent({
              provider: scriptedProvider(script),
              model: "mock",
              tools,
              approveTool: o.approveTool,
              cwd: o.cwd,
              ...(o.readTextFile ? { readTextFile: o.readTextFile } : {}),
            } as ConstructorParameters<typeof EngineAgent>[0]),
          )) as RuntimeBuilder,
      }),
    );
    const editor = new ClientSideConnection(
      () => ({
        async requestPermission(params) {
          permissions.push(params);
          return { outcome: { outcome: "selected" as const, optionId: "reject_once" } };
        },
        async sessionUpdate(params) {
          allUpdates.push(params);
        },
        async readTextFile({ path }) {
          const buffered = opts.bufferFor?.(root)[path];
          // No buffer for this file: the editor genuinely cannot serve it, and
          // the server must fall back to disk rather than give up.
          if (buffered === undefined) throw new Error(`no buffer for ${path}`);
          return { content: buffered };
        },
      }) as Client,
      clientStream,
    );

    await editor.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: opts.fsCapable ? { fs: { readTextFile: true } } : {},
    });
    const { sessionId } = await editor.newSession({ cwd: root, mcpServers: [] });
    await editor.prompt({ sessionId, prompt: [{ type: "text", text: "go" }] });

    return {
      root,
      updates,
      permissions,
      cleanup: () => rm(root, { recursive: true, force: true }),
    };
  }

  /** The sessionUpdate kinds the editor saw, in order. */
  function kinds(updates: unknown[]): string[] {
    return updates.map((u) => (u as { update: { sessionUpdate: string } }).update.sessionUpdate);
  }

  function updateAt(updates: unknown[], index: number): Record<string, unknown> {
    return (updates[index] as { update: Record<string, unknown> }).update;
  }

  it("sends a pending diff update, then the same diff in the permission request", async () => {
    const { root, updates, permissions, cleanup } = await diffSession(
      { "a.txt": "one\ntwo\nthree\n" },
      { name: "edit_file", arguments: { path: "a.txt", oldString: "two", newString: "TWO" } },
    );
    const { join } = await import("node:path");
    try {
      // tool_call (in_progress) → tool_call_update (pending, with the diff) →
      // request_permission → tool_call_update (the rejection).
      expect(kinds(updates).slice(0, 2)).toEqual(["tool_call", "tool_call_update"]);
      expect(updateAt(updates, 0)).toMatchObject({ status: "in_progress" });

      const expectedDiff = {
        type: "diff",
        path: join(root, "a.txt"),
        oldText: "one\ntwo\nthree",
        newText: "one\nTWO\nthree",
      };
      expect(updateAt(updates, 1)).toMatchObject({
        toolCallId: "c1",
        status: "pending",
        content: [expectedDiff],
        locations: [{ path: join(root, "a.txt") }],
      });
      // The permission request carries the same diff, for clients that render
      // only the request rather than the row.
      expect(permissions[0]).toMatchObject({
        toolCall: { toolCallId: "c1", content: [expectedDiff] },
      });
    } finally {
      await cleanup();
    }
  });

  it("shows the diff before the tool runs, and a rejection leaves the file untouched", async () => {
    const { root, updates, cleanup } = await diffSession(
      { "a.txt": "one\ntwo\nthree\n" },
      { name: "edit_file", arguments: { path: "a.txt", oldString: "two", newString: "TWO" } },
    );
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    try {
      expect(await readFile(join(root, "a.txt"), "utf8")).toBe("one\ntwo\nthree\n");
      // The pending diff arrived before the call's terminal update.
      expect(updateAt(updates, 1).status).toBe("pending");
      const ends = terminalToolUpdates(updates);
      expect(ends).toHaveLength(1);
      expect((ends[0] as { update: { status: string } }).update.status).toBe("failed");
    } finally {
      await cleanup();
    }
  });

  it("previews a write_file creation as a new file", async () => {
    const { root, updates, cleanup } = await diffSession(
      {},
      { name: "write_file", arguments: { path: "new.txt", content: "hello\n" } },
    );
    const { join } = await import("node:path");
    try {
      expect(updateAt(updates, 1)).toMatchObject({
        status: "pending",
        // A creation carries no oldText at all.
        content: [{ type: "diff", path: join(root, "new.txt"), newText: "hello" }],
      });
      expect(
        (updateAt(updates, 1).content as { oldText?: string }[])[0]!.oldText,
      ).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it("previews an apply_patch without applying it", async () => {
    const patch = [
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1,3 +1,3 @@",
      " one",
      "-two",
      "+TWO",
      " three",
    ].join("\n");
    const { root, updates, cleanup } = await diffSession(
      { "a.txt": "one\ntwo\nthree\n" },
      { name: "apply_patch", arguments: { patch } },
    );
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    try {
      expect(updateAt(updates, 1)).toMatchObject({
        status: "pending",
        content: [{ type: "diff", oldText: "one\ntwo\nthree", newText: "one\nTWO\nthree" }],
      });
      expect(await readFile(join(root, "a.txt"), "utf8")).toBe("one\ntwo\nthree\n");
    } finally {
      await cleanup();
    }
  });

  it("previews the editor's unsaved buffer rather than the file on disk", async () => {
    const call = {
      name: "edit_file",
      arguments: { path: "a.txt", oldString: "two", newString: "TWO" },
    };
    // The editor holds a modified buffer for a.txt; the disk copy lacks the
    // extra first line. `bufferFor` keys it by this run's own temp path.
    const withBuffer = await diffSession({ "a.txt": "one\ntwo\nthree\n" }, call, {
      fsCapable: true,
      bufferFor: (root) => ({ [`${root}/a.txt`]: "unsaved\none\ntwo\nthree\n" }),
    });
    // Same session shape, but the editor knows nothing about the file.
    const withoutBuffer = await diffSession({ "a.txt": "one\ntwo\nthree\n" }, call, {
      fsCapable: true,
    });
    try {
      const buffered = updateAt(withBuffer.updates, 1).content as { oldText: string }[];
      expect(buffered[0]!.oldText).toBe("unsaved\none\ntwo\nthree");
      // With no buffer to serve, the preview falls back to the disk contents.
      const fromDisk = updateAt(withoutBuffer.updates, 1).content as { oldText: string }[];
      expect(fromDisk[0]!.oldText).toBe("one\ntwo\nthree");
    } finally {
      await withBuffer.cleanup();
      await withoutBuffer.cleanup();
    }
  });

  it("asks without a diff when the preview cannot be computed", async () => {
    const { updates, permissions, cleanup } = await diffSession(
      { "a.txt": "one\ntwo\n" },
      {
        name: "apply_patch",
        arguments: { patch: "--- a/a.txt\n+++ b/a.txt\n@@ -1,1 +1,1 @@\n-absent\n+x\n" },
      },
    );
    try {
      // No pending update at all, and the request goes out diff-free.
      expect(kinds(updates).filter((k) => k === "tool_call_update")).toHaveLength(1);
      expect(updateAt(updates, 1).status).toBe("failed");
      expect((permissions[0] as { toolCall: { content?: unknown } }).toolCall.content).toBeUndefined();
      expect(permissions).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });

  it("does not preview non-write tools", async () => {
    const { updates, permissions, cleanup } = await diffSession(
      {},
      { name: "exec", arguments: { command: "echo hi" } },
      { extraTools: [(await import("@luckycli/core")).execTool] },
    );
    try {
      // exec still asks for permission — it just carries no diff, and no
      // pending preview update precedes it.
      expect(permissions).toHaveLength(1);
      expect((permissions[0] as { toolCall: { content?: unknown } }).toolCall.content).toBeUndefined();
      expect(kinds(updates).filter((k) => k === "tool_call_update")).toHaveLength(1);
      expect(updateAt(updates, 1).status).toBe("failed");
    } finally {
      await cleanup();
    }
  });
});

describe("acp server editor filesystem", () => {
  it("wires editor-backed file access only when the client advertises fs capabilities", async () => {
    const buffers = new Map<string, string>([["/repo/dirty.ts", "buffer text"]]);
    let opts: Parameters<RuntimeBuilder>[0] | undefined;
    const [agentStream, clientStream] = connectedStreams();
    serveAcp(agentStream, (conn) =>
      new LuckyAcpAgent(conn, {
        config: fakeConfig(),
        buildRuntime: (async (o: Parameters<RuntimeBuilder>[0]) => {
          opts = o;
          return fakeRuntime();
        }) as RuntimeBuilder,
      }),
    );
    const client: Client = {
      async requestPermission() {
        throw new Error("unexpected");
      },
      async sessionUpdate() {},
      async readTextFile(params) {
        const content = buffers.get(params.path);
        if (content === undefined) throw new Error("not open");
        return { content };
      },
      async writeTextFile(params) {
        buffers.set(params.path, params.content);
        return {};
      },
    };
    const editor = new ClientSideConnection(() => client, clientStream);
    await editor.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    });
    const { sessionId } = await editor.newSession({ cwd: "/repo", mcpServers: [] });

    // The overrides exist and round-trip through the connection.
    expect(opts?.readTextFile).toBeDefined();
    expect(opts?.writeTextFile).toBeDefined();
    await expect(opts!.readTextFile!("/repo/dirty.ts")).resolves.toBe("buffer text");
    // A file the editor has no view of resolves null → disk fallback in core.
    await expect(opts!.readTextFile!("/repo/unknown.ts")).resolves.toBeNull();
    await opts!.writeTextFile!("/repo/new.ts", "written");
    expect(buffers.get("/repo/new.ts")).toBe("written");
    expect(sessionId).toBeTruthy();
  });

  it("omits the overrides when the client has no fs capabilities", async () => {
    let opts: Parameters<RuntimeBuilder>[0] | undefined;
    const { editor } = connect({
      config: fakeConfig(),
      buildRuntime: (async (o: Parameters<RuntimeBuilder>[0]) => {
        opts = o;
        return fakeRuntime();
      }) as RuntimeBuilder,
    });
    await editor.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
    await editor.newSession({ cwd: "/repo", mcpServers: [] });
    expect(opts?.readTextFile).toBeUndefined();
    expect(opts?.writeTextFile).toBeUndefined();
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
