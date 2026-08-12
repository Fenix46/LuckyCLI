import { describe, expect, it } from "vitest";
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  type AnyMessage,
  type Client,
  type Stream,
} from "@zed-industries/agent-client-protocol";
import { AUTH_GUIDANCE, serveAcp } from "./server.js";

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
function connect(): { editor: ClientSideConnection } {
  const [agentStream, clientStream] = connectedStreams();
  serveAcp(agentStream);
  const editor = new ClientSideConnection(() => stubClient(), clientStream);
  return { editor };
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

  it("rejects session methods not yet implemented with method-not-found", async () => {
    const { editor } = connect();
    await expect(
      editor.newSession({ cwd: "/tmp", mcpServers: [] }),
    ).rejects.toMatchObject({ code: -32601 });
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
