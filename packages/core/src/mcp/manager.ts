import { adaptMcpTool } from "./tool-adapter.js";
import { McpLocalClient, type McpLocalClientOptions } from "./local-client.js";
import type {
  McpConnectionStatus,
  McpLocalServerConfig,
  McpServerConfig,
  McpToolDescriptor,
} from "./types.js";
import type { Tool } from "../tools/types.js";

interface ConnectedServer {
  config: McpLocalServerConfig;
  client: McpLocalClient;
  tools: McpToolDescriptor[];
}

export class McpManager {
  private readonly statuses = new Map<string, McpConnectionStatus>();
  private readonly servers = new Map<string, ConnectedServer>();

  constructor(private readonly options: McpLocalClientOptions = {}) {}

  async connectAll(
    configs: Record<string, McpServerConfig>,
  ): Promise<Record<string, McpConnectionStatus>> {
    await Promise.all(
      Object.entries(configs).map(async ([name, config]) => {
        this.statuses.set(name, await this.connectServer(name, config));
      }),
    );
    return this.status();
  }

  async connectServer(
    name: string,
    config: McpServerConfig,
  ): Promise<McpConnectionStatus> {
    if (config.enabled === false) {
      await this.disconnect(name);
      return { status: "disabled" };
    }

    if (config.type !== "local") {
      await this.disconnect(name);
      return { status: "failed", error: `Remote MCP server "${name}" is not supported yet.` };
    }

    try {
      const client = await McpLocalClient.connect(config, this.options);
      const tools = await client.listTools();
      await this.disconnect(name);
      this.servers.set(name, { config, client, tools });
      const next: McpConnectionStatus = { status: "connected" };
      this.statuses.set(name, next);
      return next;
    } catch (error) {
      await this.disconnect(name);
      const next: McpConnectionStatus = {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
      this.statuses.set(name, next);
      return next;
    }
  }

  status(): Record<string, McpConnectionStatus> {
    return Object.fromEntries(this.statuses);
  }

  tools(): Tool[] {
    return [...this.servers.entries()].flatMap(([name, server]) =>
      server.tools.map((tool) =>
        adaptMcpTool(name, tool, (invocation) =>
          server.client.callTool(invocation.tool, invocation.arguments).then((content) => ({ content })),
        ),
      ),
    );
  }

  async disconnect(name: string): Promise<void> {
    const existing = this.servers.get(name);
    this.servers.delete(name);
    if (existing) await existing.client.close().catch(() => {});
  }

  async close(): Promise<void> {
    const pending = [...this.servers.keys()].map((name) => this.disconnect(name));
    await Promise.all(pending);
  }
}
