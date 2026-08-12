/**
 * Session bookkeeping for the ACP server: the per-session state the agent
 * handler keeps between calls, and the mapping from ACP-supplied MCP servers
 * to LuckyCLI's own config shape.
 */
import type {
  Agent,
  ContentPart,
  ContextStatus,
  McpServerConfig,
  ProviderCredentials,
  ProviderId,
} from "@luckycli/core";
import { RequestError, type ContentBlock, type McpServer } from "@zed-industries/agent-client-protocol";

/** Permission modes a session can operate in, advertised in session/new. */
export type AcpSessionMode = "default" | "accept-edits" | "bypass-permissions";

/** The mode roster shown by editors (Zed's mode picker, etc.). */
export const ACP_SESSION_MODES: { id: AcpSessionMode; name: string; description: string }[] = [
  { id: "default", name: "Ask before acting", description: "Side-effecting tools ask for approval." },
  { id: "accept-edits", name: "Accept edits", description: "File edits run without asking; shell commands still ask." },
  { id: "bypass-permissions", name: "Bypass permissions", description: "Every tool runs without asking." },
];

/** One live editor conversation: the engine agent plus its turn state. */
export interface AcpSession {
  /** Session id — also the id in LuckyCLI's persistent session store. */
  id: string;
  /** First-created timestamp, preserved across load/save cycles. */
  createdAt: number;
  agent: Agent;
  /**
   * Provider/model this session is currently running, and the credentials it
   * was built with. Per-session rather than global: `session/set_model` can
   * point one editor conversation at a different provider than the stored
   * config's, and persistence must record what actually produced the turns.
   */
  provider: ProviderId;
  model: string;
  credentials: ProviderCredentials;
  /** Working directory the editor anchored this session to. */
  cwd: string;
  /**
   * MCP servers the editor supplied at session/new, kept so a runtime rebuild
   * (a mid-session model switch) reconnects the same set.
   */
  mcpServers: McpServer[];
  /** Abort controller of the in-flight prompt, if one is running. */
  abort: AbortController | null;
  /** Approval scopes remembered after an "allow always" (see approval.ts). */
  approved: Set<string>;
  /** Current permission mode; starts at "default". */
  mode: AcpSessionMode;
  /**
   * Id of the most recently announced tool_call. Tool calls execute strictly
   * sequentially in the engine loop, so when the approval bridge fires it
   * always refers to this call — letting the permission request reference the
   * row the editor is already rendering.
   */
  lastToolCallId: string | null;
  /**
   * Input of the most recently announced tool call. `tool_end` carries no
   * arguments, but the closing ACP update repeats the call's title and
   * location, both of which are derived from them.
   */
  lastToolInput?: unknown;
  /**
   * Latest context-window reading from the engine, published to the editor as
   * `_meta` and reported by `/context`. Absent until the first turn produces
   * one (a provider that cannot count tokens never does).
   */
  context?: ContextStatus;
  /**
   * The editor-backed file reader handed to the engine's file tools, kept here
   * so the pre-approval diff preview reads exactly what the tool will read —
   * unsaved buffers included. Absent when the client advertised no fs read
   * capability, in which case previews fall back to disk.
   */
  readTextFile?: (absPath: string) => Promise<string | null>;
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
 * Convert an ACP prompt (ContentBlock[]) to the engine's canonical parts.
 * Only what we advertised in initialize is accepted: text and images. Any
 * other block is a client bug — reject the request instead of silently
 * dropping user-visible context.
 */
export function toContentParts(blocks: ContentBlock[]): ContentPart[] {
  return blocks.map((block): ContentPart => {
    switch (block.type) {
      case "text":
        return { type: "text", text: block.text };
      case "image":
        return { type: "image", data: block.data, mimeType: block.mimeType };
      default:
        throw RequestError.invalidParams({
          details: `Unsupported prompt content block "${block.type}" (LuckyCLI accepts text and image).`,
        });
    }
  });
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
