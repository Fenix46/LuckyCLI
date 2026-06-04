import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { McpLocalClient } from "./local-client.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureServer = resolve(here, "__fixtures__/stdio-server.mjs");

describe("McpLocalClient", () => {
  const clients: McpLocalClient[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close().catch(() => {})));
  });

  it("connects to a local stdio MCP server and lists tools", async () => {
    const client = await McpLocalClient.connect({
      type: "local",
      command: ["node", fixtureServer],
      timeout: 5_000,
    });
    clients.push(client);

    const tools = await client.listTools();

    expect(client.pid).toBeTypeOf("number");
    expect(tools).toContainEqual({
      name: "echo",
      description: "Echoes text back to the caller.",
      inputSchema: {
        type: "object",
        properties: {
          message: {
            type: "string",
          },
        },
        required: ["message"],
        additionalProperties: false,
        $schema: "http://json-schema.org/draft-07/schema#",
      },
    });
  });

  it("calls a local MCP tool and returns text content", async () => {
    const client = await McpLocalClient.connect({
      type: "local",
      command: ["node", fixtureServer],
      timeout: 5_000,
    });
    clients.push(client);

    await client.listTools();
    await expect(client.callTool("echo", { message: "hello" })).resolves.toBe("echo:hello");
  });
});
