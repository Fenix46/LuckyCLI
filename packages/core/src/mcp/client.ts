/**
 * Transport-agnostic MCP client surface and shared helpers.
 *
 * Local (stdio) and remote (HTTP/SSE) clients differ only in how their transport
 * is built — the SDK `Client` and the list/call/close logic are identical. This
 * module captures the common interface and the shared request helpers so the
 * manager can hold one client type regardless of transport.
 */

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type {
  McpPromptDescriptor,
  McpResourceDescriptor,
  McpToolDescriptor,
} from "./types.js";

export const DEFAULT_TIMEOUT_MS = 30_000;

/** What every MCP client exposes to the manager, independent of transport. */
export interface McpClient {
  listTools(): Promise<McpToolDescriptor[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
  listPrompts(): Promise<McpPromptDescriptor[]>;
  getPrompt(name: string, args?: Record<string, string>): Promise<string>;
  listResources(): Promise<McpResourceDescriptor[]>;
  readResource(uri: string): Promise<string>;
  close(): Promise<void>;
}

/** Normalize the SDK's tool list into Lucky's descriptor shape. */
export function toToolDescriptors(
  tools: Array<{ name: string; description?: string; inputSchema?: unknown }>,
): McpToolDescriptor[] {
  return tools.map((tool) => ({
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    ...(tool.inputSchema ? { inputSchema: tool.inputSchema as Record<string, unknown> } : {}),
  }));
}

/** Flatten an MCP tool result's content array into a single text payload. */
export function toToolResultText(content: unknown): string {
  const parts = Array.isArray(content) ? content : [];
  return parts
    .map((part: { type?: string; text?: string }) => {
      if (part.type === "text") return part.text;
      return `[${part.type}]`;
    })
    .join("\n");
}

/** List tools via the SDK client, with a timeout. Shared by all transports. */
export async function listClientTools(
  client: Client,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<McpToolDescriptor[]> {
  const result = await withTimeout(
    client.listTools(),
    timeoutMs,
    "Timed out listing MCP tools.",
  );
  return toToolDescriptors(result.tools);
}

/** Call a tool via the SDK client, with a timeout. Shared by all transports. */
export async function callClientTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  const result = await withTimeout(
    client.callTool({ name, arguments: args }, CallToolResultSchema),
    timeoutMs,
    `Timed out calling MCP tool "${name}".`,
  );
  return toToolResultText(result.content);
}

/** List prompts via the SDK client, normalized to Lucky descriptors. */
export async function listClientPrompts(
  client: Client,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<McpPromptDescriptor[]> {
  const result = await withTimeout(client.listPrompts(), timeoutMs, "Timed out listing MCP prompts.");
  return result.prompts.map((prompt) => ({
    name: prompt.name,
    ...(prompt.description ? { description: prompt.description } : {}),
    ...(prompt.arguments ? { arguments: prompt.arguments } : {}),
  }));
}

/** Fetch a prompt and flatten its messages into text. */
export async function getClientPrompt(
  client: Client,
  name: string,
  args: Record<string, string> = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  const result = await withTimeout(
    client.getPrompt({ name, arguments: args }),
    timeoutMs,
    `Timed out fetching MCP prompt "${name}".`,
  );
  return result.messages
    .map((message) => {
      const content = message.content;
      return content.type === "text" ? content.text : `[${content.type}]`;
    })
    .join("\n");
}

/** List resources via the SDK client, normalized to Lucky descriptors. */
export async function listClientResources(
  client: Client,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<McpResourceDescriptor[]> {
  const result = await withTimeout(
    client.listResources(),
    timeoutMs,
    "Timed out listing MCP resources.",
  );
  return result.resources.map((resource) => ({
    name: resource.name ?? resource.uri,
    uri: resource.uri,
    ...(resource.description ? { description: resource.description } : {}),
    ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
  }));
}

/** Read a resource and flatten its text contents. */
export async function readClientResource(
  client: Client,
  uri: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  const result = await withTimeout(
    client.readResource({ uri }),
    timeoutMs,
    `Timed out reading MCP resource "${uri}".`,
  );
  return result.contents
    .map((content) =>
      "text" in content && typeof content.text === "string"
        ? content.text
        : `[${content.mimeType ?? "binary"}]`,
    )
    .join("\n");
}

/** Reject with `message` if `promise` does not settle within `timeoutMs`. */
export async function withTimeout<T>(
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
