/**
 * MCP over a Unix domain socket.
 *
 * This is the transport the Lucky Chrome extension uses: Chrome spawns the
 * native messaging host, which listens on `<tmp>/lucky-mcp-browser-bridge-<user>/
 * <pid>.sock`; Lucky connects to that socket as an ordinary MCP client. The
 * framing matches the native messaging protocol: a 32-bit little-endian length
 * followed by UTF-8 JSON, capped at 1 MiB.
 *
 * Keeping it as a `Transport` means the SDK `Client` and every list/call helper
 * are shared with stdio and HTTP servers.
 */
import { connect, type Socket } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
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
  McpPromptDescriptor,
  McpResourceDescriptor,
  McpToolCallResult,
  McpToolDescriptor,
  McpUnixServerConfig,
} from "./types.js";

export const MAX_FRAME_BYTES = 1024 * 1024;

/** Frame one JSON message as `[uint32 LE length][bytes]`. */
export function frameJson(message: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  if (payload.length > MAX_FRAME_BYTES) {
    throw new Error(`MCP message is ${payload.length} bytes, over the ${MAX_FRAME_BYTES} byte limit.`);
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

/** Transport that speaks framed JSON-RPC over one Unix socket. */
export class UnixClientTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private socket: Socket | undefined;
  private buffer = Buffer.alloc(0);
  private closed = false;

  constructor(private readonly path: string) {}

  async start(): Promise<void> {
    if (this.socket) throw new Error("Unix MCP transport is already started.");
    const socket = connect(this.path);
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const onConnect = () => {
        socket.off("error", onError);
        resolve();
      };
      const onError = (error: Error) => {
        socket.off("connect", onConnect);
        reject(error);
      };
      socket.once("connect", onConnect);
      socket.once("error", onError);
    });
    socket.on("data", (chunk) => this.receive(chunk));
    socket.on("error", (error) => {
      if (!this.closed) this.onerror?.(error);
    });
    socket.on("close", () => this.handleClose());
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const socket = this.socket;
    if (!socket || socket.destroyed) throw new Error("Unix MCP transport is not connected.");
    await new Promise<void>((resolve, reject) => {
      socket.write(frameJson(message), (error) => (error ? reject(error) : resolve()));
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      socket.end();
      socket.destroy();
    }
    this.onclose?.();
  }

  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (length === 0 || length > MAX_FRAME_BYTES) {
        this.onerror?.(new Error(`Invalid MCP frame length: ${length}.`));
        void this.close();
        return;
      }
      if (this.buffer.length < 4 + length) return;
      const payload = this.buffer.subarray(4, 4 + length).toString("utf8");
      this.buffer = this.buffer.subarray(4 + length);
      try {
        this.onmessage?.(JSON.parse(payload) as JSONRPCMessage);
      } catch (error) {
        this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.socket = undefined;
    this.onclose?.();
  }
}

export interface McpUnixClientOptions {
  clientName?: string;
  clientVersion?: string;
}

export class McpUnixClient implements McpClient {
  private constructor(
    private readonly client: Client,
    private readonly transport: UnixClientTransport,
  ) {}

  static async connect(
    config: McpUnixServerConfig,
    options: McpUnixClientOptions = {},
  ): Promise<McpUnixClient> {
    const transport = new UnixClientTransport(config.path);
    const client = new Client({
      name: options.clientName ?? "lucky",
      version: options.clientVersion ?? "0.0.0",
    });
    const timeout = config.timeout ?? DEFAULT_TIMEOUT_MS;
    try {
      await withTimeout(
        client.connect(transport),
        timeout,
        `Timed out connecting to Unix MCP server "${config.path}".`,
      );
      return new McpUnixClient(client, transport);
    } catch (error) {
      await transport.close().catch(() => {});
      throw error;
    }
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    return listClientTools(this.client);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
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
    await this.transport.close();
  }
}
