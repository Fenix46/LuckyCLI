import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  DEFAULT_TIMEOUT_MS,
  callClientTool,
  listClientTools,
  withTimeout,
  type McpClient,
} from "./client.js";
import type { McpRemoteServerConfig, McpToolDescriptor } from "./types.js";

export interface McpRemoteClientOptions {
  clientName?: string;
  clientVersion?: string;
}

export class McpRemoteClient implements McpClient {
  private constructor(
    private readonly client: Client,
    private readonly transport: Transport,
  ) {}

  /**
   * Connect to a remote MCP server. Streamable HTTP is the current spec
   * transport, so we try it first and fall back to the (deprecated) SSE
   * transport for servers that haven't migrated. Custom headers are applied to
   * both so auth tokens / API keys reach the server on every request.
   */
  static async connect(
    config: McpRemoteServerConfig,
    options: McpRemoteClientOptions = {},
  ): Promise<McpRemoteClient> {
    const url = new URL(config.url);
    const timeout = config.timeout ?? DEFAULT_TIMEOUT_MS;
    const headers = config.headers;

    try {
      const transport = new StreamableHTTPClientTransport(
        url,
        headers ? { requestInit: { headers } } : {},
      );
      return await McpRemoteClient.open(transport, options, timeout, config.url);
    } catch (httpError) {
      try {
        const transport = new SSEClientTransport(url, sseOptions(headers));
        return await McpRemoteClient.open(transport, options, timeout, config.url);
      } catch {
        // Surface the streamable-HTTP error: it's the primary transport and its
        // failure is the more informative one (the SSE fallback is best-effort).
        throw new Error(
          `Failed to connect to remote MCP server "${config.url}": ${
            httpError instanceof Error ? httpError.message : String(httpError)
          }`,
        );
      }
    }
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    return listClientTools(this.client);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    return callClientTool(this.client, name, args);
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  private static async open(
    transport: Transport,
    options: McpRemoteClientOptions,
    timeoutMs: number,
    label: string,
  ): Promise<McpRemoteClient> {
    const client = new Client({
      name: options.clientName ?? "lucky",
      version: options.clientVersion ?? "0.0.0",
    });
    try {
      await withTimeout(
        client.connect(transport),
        timeoutMs,
        `Timed out connecting to remote MCP server "${label}".`,
      );
      return new McpRemoteClient(client, transport);
    } catch (error) {
      await transport.close().catch(() => {});
      throw error;
    }
  }
}

/**
 * SSE custom-header support. The transport only auto-attaches headers to its
 * POST requests (`requestInit`); the initial GET that opens the stream goes
 * through `eventSourceInit`, so we override its fetch to inject the same headers.
 */
function sseOptions(headers: Record<string, string> | undefined) {
  if (!headers) return {};
  return {
    requestInit: { headers },
    eventSourceInit: {
      fetch: (input: string | URL | Request, init?: RequestInit) =>
        fetch(input, { ...init, headers: { ...init?.headers, ...headers } }),
    },
  };
}
