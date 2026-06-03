import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  DEFAULT_TIMEOUT_MS,
  callClientTool,
  getClientPrompt,
  listClientPrompts,
  listClientResources,
  listClientTools,
  readClientResource,
  withTimeout,
  type McpClient,
} from "./client.js";
import type {
  McpLocalServerConfig,
  McpPromptDescriptor,
  McpResourceDescriptor,
  McpToolDescriptor,
} from "./types.js";

export interface McpLocalClientOptions {
  cwd?: string;
  clientName?: string;
  clientVersion?: string;
}

export class McpLocalClient implements McpClient {
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
    return listClientTools(this.client);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    return callClientTool(this.client, name, args);
  }

  async listPrompts(): Promise<McpPromptDescriptor[]> {
    return listClientPrompts(this.client);
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<string> {
    return getClientPrompt(this.client, name, args);
  }

  async listResources(): Promise<McpResourceDescriptor[]> {
    return listClientResources(this.client);
  }

  async readResource(uri: string): Promise<string> {
    return readClientResource(this.client, uri);
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
