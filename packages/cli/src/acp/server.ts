/**
 * ACP (Agent Client Protocol) server: the editor-facing front-end.
 *
 * Editors that speak ACP (Zed, JetBrains, Neovim/Emacs plugins, VS Code ACP
 * extensions) spawn `lucky acp` as a subprocess and talk JSON-RPC 2.0 over
 * stdio. This module is the agent side of that connection, built on the
 * official SDK: the editor is the *client*, LuckyCLI is the *agent*.
 *
 * Design (see ACP_TASKLIST.md):
 * - One process serves one editor; sessions are created per conversation.
 * - Streams are injectable so the whole server is testable offline against
 *   the SDK's own ClientSideConnection over in-memory streams.
 * - Auth is out of band: `initialize` advertises no auth methods — the user
 *   logs in once via the interactive CLI, and `lucky acp` uses the stored
 *   config. `authenticate` therefore never succeeds.
 *
 * This file currently implements the milestone-1 surface: initialize and
 * authenticate, with the session methods rejecting cleanly until their
 * milestone lands.
 */
import { Readable, Writable } from "node:stream";
import {
  AgentSideConnection,
  PROTOCOL_VERSION,
  RequestError,
  ndJsonStream,
  type Agent,
  type AuthenticateRequest,
  type AuthenticateResponse,
  type CancelNotification,
  type InitializeRequest,
  type InitializeResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
  type Stream,
} from "@zed-industries/agent-client-protocol";
import {
  createSessionId,
  listTasks,
  onTasksUpdated,
  setActiveTaskListId,
  type PlanDecision,
  type PlanProposal,
  type ResolvedConfig,
  type TokenUsage,
} from "@luckycli/core";
import { buildAgentRuntime, type BuiltAgentRuntime } from "../runtime.js";
import { APP_VERSION } from "../ui/components/constants.js";
import type { AskUserRequest } from "@luckycli/core";
import { AUTO_ACCEPT_EDIT_TOOLS, approvalScope } from "../approval.js";
import { HIDDEN_TOOLS } from "../hidden-tools.js";
import {
  ACP_SESSION_MODES,
  mapAcpMcpServers,
  mergeMcpServers,
  toContentParts,
  type AcpSession,
  type AcpSessionMode,
} from "./sessions.js";
import { planBodyUpdate, planUpdateFromProposal, planUpdateFromTasks } from "./plan.js";
import { toolCallEnd, toolCallStart, toolCallTitle, toolKind } from "./tool-calls.js";

/** Guidance surfaced whenever the stored config can't drive a session. */
export const AUTH_GUIDANCE =
  "LuckyCLI manages credentials outside the editor: run `lucky` once in a terminal to pick a provider and log in, then reconnect.";

/**
 * What ask_user reports when a free-text answer is impossible over ACP. The
 * model reads this as the tool result and recovers by asking in its reply.
 */
export const ASK_USER_FALLBACK =
  "Free-text questions cannot be collected mid-turn in this editor. Ask the user directly in your reply and end the turn — their answer will arrive as the next message.";

/** How a session's engine runtime is built; injectable so tests stay offline. */
export type RuntimeBuilder = (
  opts: Parameters<typeof buildAgentRuntime>[0],
) => Promise<BuiltAgentRuntime>;

export interface LuckyAcpAgentOptions {
  /** Resolved headless config; absent means every session request is refused. */
  config?: ResolvedConfig;
  /** Runtime factory, defaulting to the real one. */
  buildRuntime?: RuntimeBuilder;
}

/**
 * The agent-side handler for one editor connection. Owns no I/O of its own —
 * the AgentSideConnection routes incoming JSON-RPC calls here and `conn` is
 * used to push updates back (session/update, permission requests, …).
 */
export class LuckyAcpAgent implements Agent {
  /** The connection back to the editor (session updates, permissions, fs). */
  protected readonly conn: AgentSideConnection;
  protected readonly config: ResolvedConfig | undefined;
  protected readonly buildRuntime: RuntimeBuilder;
  protected readonly sessions = new Map<string, AcpSession>();

  constructor(conn: AgentSideConnection, options: LuckyAcpAgentOptions = {}) {
    this.conn = conn;
    this.config = options.config;
    this.buildRuntime = options.buildRuntime ?? buildAgentRuntime;
  }

  async initialize(params: InitializeRequest): Promise<InitializeResponse> {
    // We implement exactly protocol v1. Per spec: echo the client's version
    // when we support it, otherwise answer with the latest we do support and
    // let the client decide whether to disconnect.
    const protocolVersion =
      params.protocolVersion === PROTOCOL_VERSION ? params.protocolVersion : PROTOCOL_VERSION;
    return {
      protocolVersion,
      agentCapabilities: {
        // Flips to true when session/load lands (task 5.3).
        loadSession: false,
        promptCapabilities: {
          // The engine already speaks multimodal turns (ContentPart images).
          image: true,
          audio: false,
          embeddedContext: false,
        },
        // McpManager speaks Streamable HTTP with an SSE fallback, and stdio
        // servers are mandatory for every agent — all three transports map
        // onto LuckyCLI's own MCP config (see sessions.ts).
        mcpCapabilities: { http: true, sse: true },
      },
      // No in-editor auth: credentials come from the stored CLI config.
      authMethods: [],
      _meta: { "dev.luckycli/version": APP_VERSION },
    };
  }

  async authenticate(_params: AuthenticateRequest): Promise<AuthenticateResponse> {
    // initialize advertises no auth methods, so a compliant client never
    // calls this. Refuse loudly (rather than no-op) so a misconfigured client
    // surfaces the real fix to the user instead of silently "succeeding".
    throw RequestError.invalidRequest({ details: AUTH_GUIDANCE });
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const config = this.requireConfig();
    // The session record exists before the runtime so the approval bridge
    // (captured at build time) can close over its live state.
    const sessionId = createSessionId();
    const session: AcpSession = {
      agent: undefined as unknown as AcpSession["agent"],
      cwd: params.cwd,
      abort: null,
      approved: new Set(),
      mode: "default",
      lastToolCallId: null,
    };
    const built = await this.buildRuntime({
      provider: config.provider!,
      model: config.model!,
      credentials: config.credentials!,
      system: config.system,
      // Recompose the system prompt from this session's context (graph
      // presence, tools, cwd), exactly as the TUI does per activation.
      composeSystemFromContext: true,
      permissions: config.permissions,
      approveTool: (name, input) => this.requestToolPermission(sessionId, session, name, input),
      askUser: (request) => this.askUser(sessionId, request),
      presentPlan: (plan) => this.presentPlan(sessionId, plan),
      cwd: params.cwd,
      // Editor-supplied servers extend the user's own MCP config; the local
      // config wins on a name conflict (the user's auth/pins are explicit).
      mcp: mergeMcpServers(mapAcpMcpServers(params.mcpServers), config.mcp),
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
      ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
      ...(config.reasoningEffort ? { reasoningEffort: config.reasoningEffort } : {}),
      ...(config.thinkingEnabled !== undefined
        ? { thinkingEnabled: config.thinkingEnabled }
        : {}),
    });

    session.agent = built.agent;
    this.sessions.set(sessionId, session);
    return {
      sessionId,
      modes: {
        currentModeId: session.mode,
        availableModes: ACP_SESSION_MODES.map(({ id, name, description }) => ({
          id,
          name,
          description,
        })),
      },
    };
  }

  async setSessionMode(params: {
    sessionId: string;
    modeId: string;
  }): Promise<Record<string, never>> {
    const session = this.requireSession(params.sessionId);
    const mode = ACP_SESSION_MODES.find((m) => m.id === params.modeId);
    if (!mode) {
      throw RequestError.invalidParams({ details: `Unknown mode "${params.modeId}".` });
    }
    // Mirroring the TUI: returning to the ask-first mode also forgets the
    // session's "always" approvals, so the user starts from a clean slate.
    if (mode.id === "default" && session.mode !== "default") session.approved.clear();
    session.mode = mode.id as AcpSessionMode;
    return {};
  }

  /**
   * The ask_user bridge. With predefined options the question maps cleanly
   * onto the permission surface (one option per choice); free-text has no
   * ACP channel mid-turn, so the tool gets an instruction-error telling the
   * model to ask in its reply and end the turn (see ASK_USER_FALLBACK).
   */
  protected async askUser(sessionId: string, request: AskUserRequest): Promise<string> {
    if (request.options?.length) {
      const response = await this.conn.requestPermission({
        sessionId,
        toolCall: {
          toolCallId: `ask:${sessionId}`,
          title: request.question,
          kind: "think",
          status: "pending",
        },
        options: request.options.map((option, index) => ({
          optionId: `option-${index}`,
          kind: "allow_once" as const,
          name: option,
        })),
      });
      if (response.outcome.outcome === "selected") {
        const index = Number(response.outcome.optionId.replace("option-", ""));
        const chosen = request.options[index];
        if (chosen !== undefined) return chosen;
      }
      // Cancelled (or an id we didn't issue): fall through to the fallback.
    }
    throw new Error(ASK_USER_FALLBACK);
  }

  /**
   * The plan bridge: show the proposal (entries + readable body), then ask
   * for the decision through the same permission surface editors already
   * render. ACP has no free-text channel mid-turn, so there is no "modify"
   * option — the user rejects and sends their feedback as the next prompt.
   */
  protected async presentPlan(sessionId: string, plan: PlanProposal): Promise<PlanDecision> {
    await this.conn.sessionUpdate(planUpdateFromProposal(sessionId, plan));
    await this.conn.sessionUpdate(planBodyUpdate(sessionId, plan));
    const response = await this.conn.requestPermission({
      sessionId,
      toolCall: {
        toolCallId: `plan:${sessionId}`,
        title: `Plan: ${plan.title}`,
        kind: "think",
        status: "pending",
      },
      options: [
        { optionId: "accept", kind: "allow_once", name: "Accept and run" },
        { optionId: "reject", kind: "reject_once", name: "Reject (reply with feedback)" },
      ],
    });
    const accepted =
      response.outcome.outcome === "selected" && response.outcome.optionId === "accept";
    return { action: accepted ? "accept" : "reject" };
  }

  /**
   * The approval bridge: resolve a tool permission through the editor.
   * Remembered "always" scopes and the session mode short-circuit the round
   * trip; otherwise the editor shows the request against the tool_call row it
   * is already rendering (tool calls execute sequentially, so the last
   * announced call is the one being approved).
   */
  protected async requestToolPermission(
    sessionId: string,
    session: AcpSession,
    name: string,
    input: unknown,
  ): Promise<"allow" | "deny"> {
    const scope = approvalScope(name, input);
    if (session.approved.has(scope)) return "allow";
    if (session.mode === "bypass-permissions") return "allow";
    if (session.mode === "accept-edits" && AUTO_ACCEPT_EDIT_TOOLS.has(name)) return "allow";

    const response = await this.conn.requestPermission({
      sessionId,
      toolCall: {
        toolCallId: session.lastToolCallId ?? name,
        title: toolCallTitle(name, input),
        kind: toolKind(name),
        status: "pending",
      },
      options: [
        { optionId: "allow_once", kind: "allow_once", name: "Allow once" },
        { optionId: "allow_always", kind: "allow_always", name: "Allow always" },
        { optionId: "reject_once", kind: "reject_once", name: "Reject" },
      ],
    });

    // A cancelled outcome (the user hit Esc / cancelled the turn) is a denial;
    // the engine records the denied call and the turn winds down cleanly.
    if (response.outcome.outcome !== "selected") return "deny";
    if (response.outcome.optionId === "allow_always") {
      session.approved.add(scope);
      return "allow";
    }
    return response.outcome.optionId === "allow_once" ? "allow" : "deny";
  }

  /** The stored config, or the ACP auth-required error with the real fix. */
  protected requireConfig(): ResolvedConfig {
    if (!this.config || this.config.needsSetup) {
      throw RequestError.authRequired({ details: AUTH_GUIDANCE });
    }
    return this.config;
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const session = this.requireSession(params.sessionId);
    if (session.abort) {
      throw RequestError.invalidRequest({
        details: "A prompt is already running for this session.",
      });
    }
    const content = toContentParts(params.prompt);

    const abort = new AbortController();
    session.abort = abort;
    // The task tools write to the process-wide active list; point it at this
    // session for the duration of the turn and mirror every change to the
    // editor as a plan update — the ACP counterpart of the TUI's TaskPanel.
    setActiveTaskListId(params.sessionId);
    const unsubscribeTasks = onTasksUpdated((listId) => {
      if (listId !== params.sessionId) return;
      void this.conn
        .sessionUpdate(planUpdateFromTasks(params.sessionId, listTasks(listId)))
        .catch(() => {
          /* a dropped notification must never break the turn */
        });
    });
    let stopReason: PromptResponse["stopReason"] = "end_turn";
    let usage: TokenUsage | undefined;
    try {
      for await (const event of session.agent.send(content, abort.signal)) {
        switch (event.type) {
          case "text":
            await this.conn.sessionUpdate({
              sessionId: params.sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: event.delta },
              },
            });
            break;
          case "tool_start":
            session.lastToolCallId = event.id;
            if (!HIDDEN_TOOLS.has(event.name)) {
              await this.conn.sessionUpdate(toolCallStart(params.sessionId, event, session.cwd));
            }
            break;
          case "tool_end":
            if (!HIDDEN_TOOLS.has(event.name)) {
              await this.conn.sessionUpdate(toolCallEnd(params.sessionId, event, session.cwd));
            }
            break;
          case "aborted":
            stopReason = "cancelled";
            break;
          case "turn_end":
            usage = event.usage;
            break;
          case "error":
            // The engine already recorded the failed turn consistently; the
            // editor gets a JSON-RPC error, and the session stays usable.
            throw RequestError.internalError({ details: event.message });
          default:
            // reasoning (no text payload), context, compaction — no ACP shape.
            break;
        }
      }
    } finally {
      session.abort = null;
      unsubscribeTasks();
    }
    return {
      stopReason,
      // Non-standard but honest: surface what the turn cost. Editors ignore
      // unknown _meta by contract.
      ...(usage ? { _meta: { "dev.luckycli/usage": usage } } : {}),
    };
  }

  async cancel(params: CancelNotification): Promise<void> {
    // Per spec a cancel for an unknown session (or an idle one) is a no-op —
    // it must never crash the server.
    this.sessions.get(params.sessionId)?.abort?.abort();
  }

  /** Abort every in-flight prompt; called when the editor drops the pipe. */
  abortAll(): void {
    for (const session of this.sessions.values()) session.abort?.abort();
  }

  /** The live session, or a clean invalid-params error for a bogus id. */
  protected requireSession(sessionId: string): AcpSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw RequestError.invalidParams({ details: `Unknown session "${sessionId}".` });
    }
    return session;
  }
}

/**
 * Wire an agent onto an ACP stream. The `toAgent` factory is injectable so
 * tests (and later milestones) can serve a subclassed agent over in-memory
 * streams; production passes the stdio stream from {@link stdioStream}.
 */
export function serveAcp(
  stream: Stream,
  toAgent: (conn: AgentSideConnection) => Agent = (conn) => new LuckyAcpAgent(conn),
): AgentSideConnection {
  return new AgentSideConnection(toAgent, stream);
}

/**
 * The production transport: newline-delimited JSON over this process's
 * stdio. stdout is reserved for the protocol — anything human-facing must go
 * to stderr (see the `lucky acp` subcommand).
 */
export function stdioStream(): Stream {
  // Node types Readable.toWeb as ReadableStream<any>, which TS won't narrow
  // to the byte stream ndJsonStream expects; the runtime object is the same.
  return ndJsonStream(
    Writable.toWeb(process.stdout),
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
  );
}
