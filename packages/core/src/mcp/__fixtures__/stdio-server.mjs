import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "fixture-stdio-server",
  version: "1.0.0",
});

server.registerTool(
  "echo",
  {
    description: "Echoes text back to the caller.",
    inputSchema: {
      message: z.string(),
    },
  },
  async ({ message }) => ({
    content: [{ type: "text", text: `echo:${message}` }],
  }),
);

server.registerPrompt(
  "greet",
  {
    description: "Greets the named person.",
    argsSchema: { name: z.string() },
  },
  ({ name }) => ({
    messages: [{ role: "user", content: { type: "text", text: `Hello, ${name}!` } }],
  }),
);

server.registerResource(
  "greeting",
  "test://greeting",
  { description: "A static greeting.", mimeType: "text/plain" },
  async (uri) => ({
    contents: [{ uri: uri.href, text: "hello resource" }],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
