import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { adaptMcpTool } from "./tool-adapter.js";
import type { McpClient } from "./client.js";
import { McpLocalClient, type McpLocalClientOptions } from "./local-client.js";
import { McpRemoteClient } from "./remote-client.js";
import type {
  McpConnectionStatus,
  McpPromptDescriptor,
  McpRemoteServerConfig,
  McpResourceDescriptor,
  McpServerConfig,
  McpToolDescriptor,
} from "./types.js";
import type { Tool } from "../tools/types.js";

export interface McpManagerOptions extends McpLocalClientOptions {
  /**
   * Supplies an OAuth provider for a remote server, e.g. one backed by stored
   * tokens. Returning undefined connects without auth.
   */
  authProviderFor?: (
    name: string,
    config: McpRemoteServerConfig,
  ) => OAuthClientProvider | undefined;
}

interface ConnectedServer {
  config: McpServerConfig;
  client: McpClient;
  tools: McpToolDescriptor[];
}

export class McpManager {
  private readonly statuses = new Map<string, McpConnectionStatus>();
  private readonly servers = new Map<string, ConnectedServer>();
  private closed = false;

  constructor(private readonly options: McpManagerOptions = {}) {}

  async connectAll(
    configs: Record<string, McpServerConfig>,
  ): Promise<Record<string, McpConnectionStatus>> {
    await Promise.all(
      Object.entries(configs).map(([name, config]) => this.connectServer(name, config)),
    );
    return this.status();
  }

  /**
   * Connect (or reconnect) a single server. This is the one place that writes
   * connection status, so every path — disabled, connected, failed — is recorded
   * consistently. Any prior connection for the same name is torn down first.
   */
  async connectServer(
    name: string,
    config: McpServerConfig,
  ): Promise<McpConnectionStatus> {
    if (config.enabled === false) {
      await this.teardown(name);
      return this.setStatus(name, { status: "disabled" });
    }

    try {
      const client =
        config.type === "local"
          ? await McpLocalClient.connect(config, this.options)
          : await McpRemoteClient.connect(config, {
              ...(this.options.clientName ? { clientName: this.options.clientName } : {}),
              ...(this.options.clientVersion ? { clientVersion: this.options.clientVersion } : {}),
              ...(this.options.authProviderFor?.(name, config)
                ? { authProvider: this.options.authProviderFor(name, config)! }
                : {}),
            });
      const tools = await client.listTools();
      // The manager may have been closed while this connect was in flight (it
      // runs in the background during startup). Don't store or leak the client.
      if (this.closed) {
        await client.close().catch(() => {});
        return this.setStatus(name, { status: "disconnected" });
      }
      await this.teardown(name);
      this.servers.set(name, { config, client, tools });
      return this.setStatus(name, { status: "connected" });
    } catch (error) {
      await this.teardown(name);
      return this.setStatus(name, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Reconnect a single server, applying a fresh config. Alias of connectServer. */
  async reconnect(name: string, config: McpServerConfig): Promise<McpConnectionStatus> {
    return this.connectServer(name, config);
  }

  status(): Record<string, McpConnectionStatus> {
    return Object.fromEntries(this.statuses);
  }

  /** Number of tools currently exposed by a connected server. */
  toolCount(name: string): number {
    return this.servers.get(name)?.tools.length ?? 0;
  }

  /** List prompts offered by a connected server. */
  async listPrompts(server: string): Promise<McpPromptDescriptor[]> {
    return this.requireClient(server).listPrompts();
  }

  /** Fetch a prompt from a connected server, flattened to text. */
  async getPrompt(
    server: string,
    name: string,
    args?: Record<string, string>,
  ): Promise<string> {
    return this.requireClient(server).getPrompt(name, args);
  }

  /** List resources offered by a connected server. */
  async listResources(server: string): Promise<McpResourceDescriptor[]> {
    return this.requireClient(server).listResources();
  }

  /** Read a resource from a connected server, flattened to text. */
  async readResource(server: string, uri: string): Promise<string> {
    return this.requireClient(server).readResource(uri);
  }

  private requireClient(server: string): McpClient {
    const connected = this.servers.get(server);
    if (!connected) throw new Error(`MCP server "${server}" is not connected.`);
    return connected.client;
  }

  private setStatus(name: string, status: McpConnectionStatus): McpConnectionStatus {
    this.statuses.set(name, status);
    return status;
  }

  tools(): Tool[] {
    return [...this.servers.entries()].flatMap(([name, server]) =>
      server.tools.map((tool) =>
        adaptMcpTool(name, tool, (invocation, _ctx) =>
          server.client.callTool(invocation.tool, invocation.arguments).then((content) => ({ content })),
        ),
      ),
    );
  }

  /** Disconnect a single server and record it as disconnected. */
  async disconnect(name: string): Promise<void> {
    await this.teardown(name);
    this.setStatus(name, { status: "disconnected" });
  }

  async close(): Promise<void> {
    this.closed = true;
    const pending = [...this.servers.keys()].map((name) => this.teardown(name));
    await Promise.all(pending);
  }

  /** Close and forget a server's client without touching its recorded status. */
  private async teardown(name: string): Promise<void> {
    const existing = this.servers.get(name);
    this.servers.delete(name);
    if (existing) await existing.client.close().catch(() => {});
  }
}
