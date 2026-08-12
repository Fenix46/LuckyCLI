/**
 * End-to-end editor session flow (task 7.1): one connection driving the real
 * pieces together — initialize → session/new → a prompt that writes a real
 * file behind a permission request and survives a crashing tool → cancel on a
 * second prompt → session/load replay on a fresh connection. Only the model
 * stream is scripted; tools, permission flow, diffs, persistence and the
 * session store are the production code paths.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  defaultToolRegistry,
  defineTool,
  type IProvider,
  type ResolvedConfig,
} from "@luckycli/core";
import { z } from "zod";
import type { BuiltAgentRuntime } from "../runtime.js";
import { LuckyAcpAgent, serveAcp, type RuntimeBuilder } from "./server.js";

let suiteHome: string;
let realHome: string | undefined;
let workdir: string;
beforeAll(() => {
  realHome = process.env.HOME;
  suiteHome = mkdtempSync(join(tmpdir(), "lucky-acp-e2e-home-"));
  process.env.HOME = suiteHome;
  workdir = mkdtempSync(join(tmpdir(), "lucky-acp-e2e-work-"));
});
afterAll(() => {
  process.env.HOME = realHome;
  rmSync(suiteHome, { recursive: true, force: true });
  rmSync(workdir, { recursive: true, force: true });
});

function connectedStreams(): [Stream, Stream] {
  const agentToClient = new TransformStream<AnyMessage, AnyMessage>();
  const clientToAgent = new TransformStream<AnyMessage, AnyMessage>();
  return [
    { writable: agentToClient.writable, readable: clientToAgent.readable },
    { writable: clientToAgent.writable, readable: agentToClient.readable },
  ];
}

type Chunk = {
  textDelta?: string;
  toolCall?: { type: "tool_call"; id: string; name: string; arguments: Record<string, unknown> };
  finishReason?: "stop" | "tool_calls";
};

function scriptedProvider(script: Chunk[][]): IProvider {
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
    async *generateStream(_messages: unknown, config: { abortSignal?: AbortSignal }) {
      const batch = script[turn++] ?? [{ finishReason: "stop" as const }];
      for (const chunk of batch) yield chunk;
      if (!batch.some((chunk) => chunk.finishReason)) {
        await new Promise<void>((_resolve, reject) => {
          const fail = () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          };
          if (config?.abortSignal?.aborted) fail();
          config?.abortSignal?.addEventListener("abort", fail);
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

function config(): ResolvedConfig {
  return {
    provider: "claude",
    model: "claude-sonnet-4-6",
    system: "sys",
    credentials: { kind: "api-key", apiKey: "sk-test" } as ResolvedConfig["credentials"],
    mcp: {},
    permissions: {},
    needsSetup: false,
  };
}

describe("acp end-to-end editor session", () => {
  it("runs the full flow: init, tool turn with permission and diff, crash survival, cancel, resume", async () => {
    const script: Chunk[][] = [
      // Turn 1, step 1: write a real file (permission required)…
      [
        {
          toolCall: {
            type: "tool_call",
            id: "w1",
            name: "write_file",
            arguments: { path: "hello.txt", content: "ciao editor\n" },
          },
          finishReason: "tool_calls",
        },
      ],
      // …step 2: a tool that crashes (must become a failed result, not a crash)…
      [
        {
          toolCall: { type: "tool_call", id: "b1", name: "boom_tool", arguments: {} },
          finishReason: "tool_calls",
        },
      ],
      // …step 3: the reply.
      [{ textDelta: "written!" }, { finishReason: "stop" }],
      // Turn 2: a stream that stalls until cancelled (no finish reason).
      [{ textDelta: "thinking…" }],
    ];

    const tools = defaultToolRegistry();
    tools.register(
      defineTool({
        name: "boom_tool",
        description: "always throws",
        schema: z.object({}),
        readonly: true,
        async execute() {
          throw new Error("kaboom");
        },
      }),
    );

    const provider = scriptedProvider(script);
    const buildRuntime: RuntimeBuilder = async (opts) => ({
      agent: new EngineAgent({
        provider,
        model: "mock",
        cwd: opts.cwd ?? workdir,
        tools,
        approveTool: opts.approveTool,
      }),
      skillActivator: new SkillActivator(),
      graphEnricher: new GraphContextEnricher(opts.cwd ?? workdir),
    }) as unknown as Promise<BuiltAgentRuntime>;

    const permissionLog: string[] = [];
    const updates: { update: Record<string, unknown> & { sessionUpdate: string } }[] = [];
    const client: Client = {
      async requestPermission(params) {
        permissionLog.push((params.toolCall as { title?: string }).title ?? "?");
        return { outcome: { outcome: "selected", optionId: "allow_once" } };
      },
      async sessionUpdate(params) {
        updates.push(params as (typeof updates)[number]);
      },
    };

    const [agentStream, clientStream] = connectedStreams();
    serveAcp(agentStream, (conn) => new LuckyAcpAgent(conn, { config: config(), buildRuntime }));
    const editor = new ClientSideConnection(() => client, clientStream);

    // Handshake and session.
    const init = await editor.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    });
    expect(init.protocolVersion).toBe(PROTOCOL_VERSION);
    const { sessionId } = await editor.newSession({ cwd: workdir, mcpServers: [] });

    // Turn 1: permission → real write → crash survived → reply.
    const first = await editor.prompt({
      sessionId,
      prompt: [{ type: "text", text: "write hello.txt please" }],
    });
    expect(first.stopReason).toBe("end_turn");
    expect(permissionLog).toEqual(["write_file hello.txt"]);
    expect(await readFile(join(workdir, "hello.txt"), "utf8")).toBe("ciao editor\n");

    const byKind = (kind: string) => updates.filter((u) => u.update.sessionUpdate === kind);
    const writeUpdates = byKind("tool_call_update").filter(
      (u) => (u.update as { toolCallId?: string }).toolCallId === "w1",
    );
    // The write is reported twice: the pre-approval diff (pending, sent while
    // the permission request is open) and the result once it has run.
    expect(writeUpdates.map((u) => (u.update as { status: string }).status)).toEqual([
      "pending",
      "completed",
    ]);
    for (const update of writeUpdates) {
      expect(
        (update.update as { content?: { type: string }[] }).content?.some(
          (c) => c.type === "diff",
        ),
      ).toBe(true);
    }
    const boomEnd = byKind("tool_call_update").find(
      (u) => (u.update as { toolCallId?: string }).toolCallId === "b1",
    );
    expect(boomEnd?.update).toMatchObject({ status: "failed" });
    expect(byKind("agent_message_chunk").at(-1)?.update).toMatchObject({
      content: { type: "text", text: "written!" },
    });

    // Turn 2: cancel mid-stream; the server answers cancelled and stays alive.
    const second = editor.prompt({ sessionId, prompt: [{ type: "text", text: "more" }] });
    await new Promise((r) => setTimeout(r, 20));
    await editor.cancel({ sessionId });
    expect((await second).stopReason).toBe("cancelled");

    // Fresh connection: the persisted session loads and replays its history.
    const [agentStream2, clientStream2] = connectedStreams();
    const replay: { update: { sessionUpdate: string } }[] = [];
    serveAcp(agentStream2, (conn) =>
      new LuckyAcpAgent(conn, { config: config(), buildRuntime }),
    );
    const editor2 = new ClientSideConnection(
      () => ({
        async requestPermission() {
          throw new Error("unexpected");
        },
        async sessionUpdate(params) {
          replay.push(params as (typeof replay)[number]);
        },
      }),
      clientStream2,
    );
    await editor2.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
    await editor2.loadSession({ sessionId, cwd: workdir, mcpServers: [] });
    const replayed = replay.map((u) => u.update.sessionUpdate);
    expect(replayed[0]).toBe("user_message_chunk");
    expect(replayed).toContain("agent_message_chunk");
  });
});
