import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import { McpRemoteClient } from "./remote-client.js";

/**
 * Spin up a real, in-process Streamable HTTP MCP server exposing a single echo
 * tool, so the remote client is exercised over an actual HTTP transport.
 */
async function startHttpMcpServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = new McpServer({ name: "fixture-http-server", version: "1.0.0" });
  server.registerTool(
    "echo",
    {
      description: "Echoes text back to the caller.",
      inputSchema: { message: z.string() },
    },
    async ({ message }) => ({ content: [{ type: "text", text: `echo:${message}` }] }),
  );

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await server.connect(transport);

  const http: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString();
      const body = raw ? JSON.parse(raw) : undefined;
      void transport.handleRequest(req, res, body);
    });
  });

  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const { port } = http.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: async () => {
      await transport.close().catch(() => {});
      await server.close().catch(() => {});
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

describe("McpRemoteClient", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((fn) => fn().catch(() => {})));
  });

  it("connects over streamable HTTP, lists tools, and calls a tool", async () => {
    const fixture = await startHttpMcpServer();
    cleanups.push(fixture.close);

    const client = await McpRemoteClient.connect({
      type: "remote",
      url: fixture.url,
      timeout: 5_000,
    });
    cleanups.push(() => client.close());

    const tools = await client.listTools();
    expect(tools.map((tool) => tool.name)).toContain("echo");

    await expect(client.callTool("echo", { message: "hi" })).resolves.toBe("echo:hi");
  });

  it("surfaces a clear error when the remote server is unreachable", async () => {
    await expect(
      McpRemoteClient.connect({ type: "remote", url: "http://127.0.0.1:1/mcp", timeout: 2_000 }),
    ).rejects.toThrow(/remote MCP server/i);
  });
});
