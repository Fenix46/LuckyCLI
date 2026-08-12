import { describe, expect, it, vi } from "vitest";
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  type AnyMessage,
  type Client,
  type Stream,
} from "@zed-industries/agent-client-protocol";
import { GraphContextEnricher, SkillActivator, type ResolvedConfig } from "@luckycli/core";
import type { BuiltAgentRuntime } from "../runtime.js";
import {
  AUTH_GUIDANCE,
  LuckyAcpAgent,
  serveAcp,
  type LuckyAcpAgentOptions,
  type RuntimeBuilder,
} from "./server.js";

/** Two cross-wired in-memory ACP streams: [agentSide, clientSide]. */
function connectedStreams(): [Stream, Stream] {
  const agentToClient = new TransformStream<AnyMessage, AnyMessage>();
  const clientToAgent = new TransformStream<AnyMessage, AnyMessage>();
  return [
    { writable: agentToClient.writable, readable: clientToAgent.readable },
    { writable: clientToAgent.writable, readable: agentToClient.readable },
  ];
}

/** Minimal editor stub: records session updates, never grants permissions. */
function stubClient(): Client {
  return {
    async requestPermission() {
      throw new Error("unexpected permission request in this test");
    },
    async sessionUpdate() {},
  };
}

/** A connected [server, editor] pair over in-memory streams. */
function connect(options: LuckyAcpAgentOptions = {}): { editor: ClientSideConnection } {
  const [agentStream, clientStream] = connectedStreams();
  serveAcp(agentStream, (conn) => new LuckyAcpAgent(conn, options));
  const editor = new ClientSideConnection(() => stubClient(), clientStream);
  return { editor };
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

/** A runtime whose agent is an inert stub — enough for session bookkeeping. */
function fakeRuntime(): BuiltAgentRuntime {
  return {
    agent: {} as BuiltAgentRuntime["agent"],
    skillActivator: new SkillActivator(),
    graphEnricher: new GraphContextEnricher("/tmp"),
  };
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
    expect(response.agentCapabilities?.loadSession).toBe(false);
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

  it("rejects session methods not yet implemented with method-not-found", async () => {
    const { editor } = connect();
    await expect(
      editor.prompt({
        sessionId: "nope",
        prompt: [{ type: "text", text: "hi" }],
      }),
    ).rejects.toMatchObject({ code: -32601 });
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

  it("denies ask-level tools through the milestone-4 approval stub", async () => {
    const buildRuntime = vi.fn(async () => fakeRuntime()) as unknown as RuntimeBuilder & {
      mock: { calls: [Parameters<RuntimeBuilder>[0]][] };
    };
    const { editor } = connect({ config: fakeConfig(), buildRuntime });
    await editor.newSession({ cwd: "/repo", mcpServers: [] });
    const opts = buildRuntime.mock.calls[0]![0];
    expect(await opts.approveTool?.("write_file", {})).toBe("deny");
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
