/**
 * Session bookkeeping for the ACP server: the per-session state the agent
 * handler keeps between calls, and the mapping from ACP-supplied MCP servers
 * to LuckyCLI's own config shape.
 */
import type { Agent, McpServerConfig } from "@luckycli/core";
import type { McpServer } from "@zed-industries/agent-client-protocol";

/** One live editor conversation: the engine agent plus its turn state. */
export interface AcpSession {
  agent: Agent;
  /** Working directory the editor anchored this session to. */
  cwd: string;
  /** Abort controller of the in-flight prompt, if one is running. */
  abort: AbortController | null;
}

/**
 * Convert the MCP servers an editor passes in `session/new` to LuckyCLI's
 * config shape, keyed by their name. Stdio servers (no `url`) become local
 * child processes; http/sse become remote — LuckyCLI's McpManager already
 * speaks Streamable HTTP with an SSE fallback, so both map to `remote`.
 */
export function mapAcpMcpServers(servers: McpServer[]): Record<string, McpServerConfig> {
  const out: Record<string, McpServerConfig> = {};
  for (const server of servers) {
    if ("command" in server) {
      out[server.name] = {
        type: "local",
        command: [server.command, ...server.args],
        ...(server.env.length > 0
          ? { environment: Object.fromEntries(server.env.map((e) => [e.name, e.value])) }
          : {}),
      };
    } else {
      out[server.name] = {
        type: "remote",
        url: server.url,
        ...(server.headers.length > 0
          ? { headers: Object.fromEntries(server.headers.map((h) => [h.name, h.value])) }
          : {}),
      };
    }
  }
  return out;
}

/**
 * Merge editor-supplied MCP servers with the user's own config. The local
 * config wins on a name conflict: the user's explicit setup (auth headers,
 * pinned commands) must not be shadowed by whatever the editor forwards.
 */
export function mergeMcpServers(
  fromEditor: Record<string, McpServerConfig>,
  fromConfig: Record<string, McpServerConfig>,
): Record<string, McpServerConfig> {
  return { ...fromEditor, ...fromConfig };
}
