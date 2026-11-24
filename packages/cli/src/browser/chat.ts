/**
 * Chat side panel backend.
 *
 * The native host already bridges MCP tool calls between Lucky and the
 * extension. This controller adds a second conversation channel: the extension
 * panel sends a prompt, and the host runs a headless ACP session in-process
 * (the same engine `lucky acp` exposes to editors). Streaming text, tool
 * status, plan/permission requests and cancellation all go back over native
 * messaging.
 *
 * The ACP session is created lazily on the first prompt so simply having the
 * extension loaded costs nothing.
 */
import type {
  AgentSideConnection,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@zed-industries/agent-client-protocol";
import { resolveAcpConfig } from "../acp/acp-cli.js";
import { LuckyAcpAgent } from "../acp/server.js";
import { readBrowserChatCwd } from "./chat-cwd.js";

export interface ChatSink {
  send(message: Record<string, unknown>): void;
}

export interface BrowserChatOptions {
  sink: ChatSink;
  cwd?: string;
  log?: (line: string) => void;
  /** Injectable for tests; defaults to the real ACP agent. */
  createAgent?: (conn: AgentSideConnection, config: import("@luckycli/core").ResolvedConfig) => LuckyAcpAgent;
  /** Injectable for tests; defaults to resolveAcpConfig. */
  resolveConfig?: typeof resolveAcpConfig;
}

export interface ChatEvent {
  kind: "text" | "reasoning" | "tool" | "plan";
  text?: string;
  title?: string;
  status?: string;
}

/** Map one ACP session update to a panel event, or undefined to ignore it. */
export function chatEventFromUpdate(update: unknown): ChatEvent | undefined {
  if (!update || typeof update !== "object") return undefined;
  const value = update as {
    sessionUpdate?: unknown;
    content?: unknown;
    title?: unknown;
    status?: unknown;
    entries?: unknown;
  };
  if (value.sessionUpdate === "agent_message_chunk") {
    const content = value.content as { type?: unknown; text?: unknown } | undefined;
    return content?.type === "text" && typeof content.text === "string"
      ? { kind: "text", text: content.text }
      : undefined;
  }
  if (value.sessionUpdate === "agent_thought_chunk") {
    const content = value.content as { type?: unknown; text?: unknown } | undefined;
    return content?.type === "text" && typeof content.text === "string"
      ? { kind: "reasoning", text: content.text }
      : undefined;
  }
  if (value.sessionUpdate === "tool_call" || value.sessionUpdate === "tool_call_update") {
    return {
      kind: "tool",
      ...(typeof value.title === "string" ? { title: value.title } : {}),
      ...(typeof value.status === "string" ? { status: value.status } : {}),
    };
  }
  if (value.sessionUpdate === "plan") {
    return { kind: "plan", ...(typeof value.entries === "object" ? { text: JSON.stringify(value.entries) } : {}) };
  }
  return undefined;
}

interface PendingApproval {
  resolve: (optionId: string | undefined) => void;
  payload: Record<string, unknown>;
}

export class BrowserChat {
  private readonly sink: ChatSink;
  private readonly log: (line: string) => void;
  private readonly createAgent: (conn: AgentSideConnection, config: import("@luckycli/core").ResolvedConfig) => LuckyAcpAgent;
  private readonly resolveConfig: typeof resolveAcpConfig;
  private agent: LuckyAcpAgent | undefined;
  private sessionId: string | undefined;
  private busy = false;
  private approvalSeq = 1;
  private readonly approvals = new Map<string, PendingApproval>();

  constructor(options: BrowserChatOptions) {
    this.sink = options.sink;
    this.log = options.log ?? (() => {});
    this.createAgent = options.createAgent ?? ((conn, config) => new LuckyAcpAgent(conn, { config }));
    this.resolveConfig = options.resolveConfig ?? resolveAcpConfig;
    this.cwd = options.cwd ?? readBrowserChatCwd();
  }

  private cwd: string;

  status(): Record<string, unknown> {
    return {
      busy: this.busy,
      cwd: this.cwd,
      hasSession: Boolean(this.sessionId),
      approvals: [...this.approvals.values()].map((approval) => approval.payload),
    };
  }

  setCwd(cwd: string): void {
    if (!cwd.startsWith("/")) return;
    this.cwd = cwd;
    this.reset();
  }

  /** Send one prompt; rejects when a previous prompt is still running. */
  async send(text: string): Promise<void> {
    if (this.busy) throw new Error("A chat turn is already running.");
    this.busy = true;
    this.sink.send({ type: "chat_start" });
    try {
      await this.ensureSession();
      const sessionId = this.sessionId!;
      const result = await this.agent!.prompt({
        sessionId,
        prompt: [{ type: "text", text }],
      });
      this.sink.send({ type: "chat_done", stopReason: result.stopReason });
    } catch (error) {
      this.sink.send({
        type: "chat_error",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.busy = false;
    }
  }

  async cancel(): Promise<void> {
    for (const [id, approval] of this.approvals) {
      approval.resolve(undefined);
      this.approvals.delete(id);
    }
    if (this.agent && this.sessionId) {
      await this.agent.cancel({ sessionId: this.sessionId }).catch(() => {});
    }
  }

  resolveApproval(id: string, optionId: string | undefined): boolean {
    const approval = this.approvals.get(id);
    if (!approval) return false;
    this.approvals.delete(id);
    approval.resolve(optionId);
    return true;
  }

  reset(): void {
    void this.cancel();
    this.agent?.abortAll();
    this.agent = undefined;
    this.sessionId = undefined;
  }

  close(): void {
    void this.cancel();
    this.agent?.abortAll();
    this.agent = undefined;
    this.sessionId = undefined;
  }

  private async ensureSession(): Promise<void> {
    if (this.agent && this.sessionId) return;
    const resolved = this.resolveConfig({});
    if (!resolved.ok) throw new Error(resolved.reason);
    const conn = this.connection();
    const agent = this.createAgent(conn, resolved.config);
    await agent.initialize({ protocolVersion: 1, clientCapabilities: {} });
    const session = await agent.newSession({ cwd: this.cwd, mcpServers: [] });
    this.agent = agent;
    this.sessionId = session.sessionId;
  }

  private connection(): AgentSideConnection {
    const conn = {
      sessionUpdate: async (params: { update: unknown }) => {
        const event = chatEventFromUpdate(params.update);
        if (event) this.sink.send({ type: "chat_event", event });
      },
      requestPermission: async (params: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
        const id = `approval-${this.approvalSeq++}`;
        return new Promise<RequestPermissionResponse>((resolve) => {
          const payload = {
            id,
            title: params.toolCall.title ?? "Approval required",
            options: params.options.map((option) => ({
              id: option.optionId,
              name: option.name,
              kind: option.kind,
            })),
          };
          this.approvals.set(id, {
            payload,
            resolve: (optionId) => {
              resolve(
                optionId
                  ? { outcome: { outcome: "selected", optionId } }
                  : { outcome: { outcome: "cancelled" } },
              );
            },
          });
          this.sink.send({ type: "approval_request", ...payload });
        });
      },
      readTextFile: async () => {
        throw new Error("The chat panel does not provide an editor filesystem.");
      },
      writeTextFile: async () => {
        throw new Error("The chat panel does not provide an editor filesystem.");
      },
    };
    return conn as unknown as AgentSideConnection;
  }
}
