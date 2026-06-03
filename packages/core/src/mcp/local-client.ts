import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { McpLocalServerConfig, McpToolDescriptor } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;

export interface McpLocalClientOptions {
  cwd?: string;
  clientName?: string;
  clientVersion?: string;
}

export class McpLocalClient {
  private constructor(
    private readonly client: Client,
    private readonly transport: StdioClientTransport,
  ) {}

  static async connect(
    config: McpLocalServerConfig,
    options: McpLocalClientOptions = {},
  ): Promise<McpLocalClient> {
    const [command, ...args] = config.command;
    if (!command) throw new Error("Local MCP server command is empty.");

    const transport = new StdioClientTransport({
      command,
      args,
      cwd: options.cwd,
      env: {
        ...inheritDefinedEnv(process.env),
        ...config.environment,
      },
      stderr: "pipe",
    });

    const client = new Client({
      name: options.clientName ?? "lucky",
      version: options.clientVersion ?? "0.0.0",
    });

    const timeout = config.timeout ?? DEFAULT_TIMEOUT_MS;
    try {
      await withTimeout(client.connect(transport), timeout, `Timed out connecting to local MCP server "${command}".`);
      return new McpLocalClient(client, transport);
    } catch (error) {
      await transport.close().catch(() => {});
      throw error;
    }
  }

  get pid(): number | null {
    return this.transport.pid;
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const result = await withTimeout(
      this.client.listTools(),
      DEFAULT_TIMEOUT_MS,
      "Timed out listing MCP tools.",
    );
    return result.tools.map((tool) => ({
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      ...(tool.inputSchema ? { inputSchema: tool.inputSchema as Record<string, unknown> } : {}),
    }));
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const result = await withTimeout(
      this.client.callTool({ name, arguments: args }, CallToolResultSchema),
      DEFAULT_TIMEOUT_MS,
      `Timed out calling MCP tool "${name}".`,
    );
    const content = Array.isArray(result.content) ? result.content : [];
    return content
      .map((part: { type?: string; text?: string }) => {
        if (part.type === "text") return part.text;
        return `[${part.type}]`;
      })
      .join("\n");
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

function inheritDefinedEnv(
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
