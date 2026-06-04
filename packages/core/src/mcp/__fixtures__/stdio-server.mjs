import { writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
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

// A filesystem-mutating tool: writes a file relative to MCP_FIXTURE_ROOT.
// Used to exercise graph upkeep after an opaque external edit.
server.registerTool(
  "write_file",
  {
    description: "Writes content to a file under the fixture root.",
    inputSchema: {
      path: z.string(),
      content: z.string(),
    },
  },
  async ({ path, content }) => {
    const root = process.env.MCP_FIXTURE_ROOT ?? process.cwd();
    const target = isAbsolute(path) ? path : join(root, path);
    writeFileSync(target, content, "utf8");
    return { content: [{ type: "text", text: `wrote:${path}` }] };
  },
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
