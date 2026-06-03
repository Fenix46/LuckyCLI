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

const transport = new StdioServerTransport();
await server.connect(transport);
