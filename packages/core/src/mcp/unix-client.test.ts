import { createServer, type Server, type Socket } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_FRAME_BYTES, McpUnixClient } from "./unix-client.js";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function frame(message: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

async function fakeServer(
  handler: (message: { id?: number; method?: string; params?: unknown }) => unknown,
  options: { split?: boolean } = {},
): Promise<{ path: string; server: Server }> {
  const dir = mkdtempSync(join(tmpdir(), "lucky-unix-"));
  const path = join(dir, "bridge.sock");
  const server = createServer((socket: Socket) => {
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const length = buffer.readUInt32LE(0);
        if (buffer.length < 4 + length) return;
        const message = JSON.parse(buffer.subarray(4, 4 + length).toString("utf8")) as {
          id?: number;
          method?: string;
          params?: unknown;
        };
        buffer = buffer.subarray(4 + length);
        if (message.id === undefined) continue; // notification
        const response = frame(handler(message));
        if (options.split && response.length > 3) {
          socket.write(response.subarray(0, 3));
          socket.write(response.subarray(3));
        } else {
          socket.write(response);
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  cleanups.push(
    async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    },
  );
  return { path, server };
}

function protocolHandler(message: { id?: number; method?: string; params?: unknown }): unknown {
  if (message.method === "initialize") {
    const params = message.params as { protocolVersion?: string } | undefined;
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "fake", version: "0.0.0" },
      },
    };
  }
  if (message.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [
          {
            name: "echo",
            description: "Echo text",
            inputSchema: { type: "object", properties: { text: { type: "string" } } },
          },
        ],
      },
    };
  }
  if (message.method === "tools/call") {
    const params = message.params as { arguments?: { text?: string } } | undefined;
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [{ type: "text", text: `echo:${params?.arguments?.text ?? ""}` }],
        isError: false,
      },
    };
  }
  return {
    jsonrpc: "2.0",
    id: message.id,
    error: { code: -32601, message: `unknown method ${message.method}` },
  };
}

describe("McpUnixClient", () => {
  it("initializes, lists tools and calls one", async () => {
    const { path } = await fakeServer(protocolHandler);
    const client = await McpUnixClient.connect({ type: "unix", path });
    cleanups.push(() => client.close());

    expect(await client.listTools()).toEqual([
      {
        name: "echo",
        description: "Echo text",
        inputSchema: { type: "object", properties: { text: { type: "string" } } },
      },
    ]);
    expect(await client.callTool("echo", { text: "hi" })).toEqual({
      content: "echo:hi",
      isError: false,
    });
  });

  it("reassembles frames split across chunks", async () => {
    const { path } = await fakeServer(protocolHandler, { split: true });
    const client = await McpUnixClient.connect({ type: "unix", path });
    cleanups.push(() => client.close());
    expect((await client.listTools()).map((tool) => tool.name)).toEqual(["echo"]);
  });

  it("rejects a missing socket", async () => {
    await expect(
      McpUnixClient.connect({ type: "unix", path: join(tmpdir(), "lucky-missing-bridge.sock"), timeout: 500 }),
    ).rejects.toThrow(/timed out|ENOENT|connect/i);
  });

  it("rejects an oversized frame", async () => {
    // A raw server that sends a bogus length before any handshake.
    const dir = mkdtempSync(join(tmpdir(), "lucky-unix-bad-"));
    const badPath = join(dir, "bad.sock");
    const sockets = new Set<Socket>();
    const bad = createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      const header = Buffer.alloc(4);
      header.writeUInt32LE(MAX_FRAME_BYTES + 1, 0);
      socket.write(header);
    });
    await new Promise<void>((resolve) => bad.listen(badPath, resolve));
    cleanups.push(async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => bad.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    });

    await expect(McpUnixClient.connect({ type: "unix", path: badPath, timeout: 500 })).rejects.toThrow();
  });
});
