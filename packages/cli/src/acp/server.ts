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
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
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
  type SessionModelState,
  type SessionNotification,
  type Stream,
  type ToolCallContent,
} from "@zed-industries/agent-client-protocol";
import {
  buildAndSaveGraph,
  createSessionId,
  deriveTitle,
  listTasks,
  loadSession as loadStoredSession,
  loadStoredConfig,
  onTasksUpdated,
  recordGraphBuilt,
  resolveCredentials,
  saveSession,
  saveStoredConfig,
  setActiveTaskListId,
  type ContextStatus,
  type Message,
  type PlanDecision,
  type PlanProposal,
  type ProviderId,
  type ResolvedConfig,
  type StoredConfig,
  type TokenUsage,
} from "@luckycli/core";
import { buildAgentRuntime, type BuiltAgentRuntime } from "../runtime.js";
import { APP_VERSION } from "../ui/components/constants.js";
import type { AskUserRequest } from "@luckycli/core";
import { AUTO_ACCEPT_EDIT_TOOLS, approvalScope } from "../approval.js";
import { PREVIEWABLE_TOOLS, previewToolDiffs } from "../approval-preview.js";
import { HIDDEN_TOOLS } from "../hidden-tools.js";
import {
  ACP_SESSION_MODES,
  mapAcpMcpServers,
  mergeMcpServers,
  toContentParts,
  type AcpSession,
  type AcpSessionMode,
} from "./sessions.js";
import {
  availableCommands,
  parseCommand,
  unknownCommandHelp,
  type ParsedCommand,
} from "./commands.js";
import { CONTEXT_META_KEY, USAGE_META_KEY, contextMeta, hasTokenCounts } from "./meta.js";
import { isSelectableModel, modelRoster, parseModelId } from "./models.js";
import { planBodyUpdate, planUpdateFromProposal, planUpdateFromTasks } from "./plan.js";
import { diffContents, toolCallEnd, toolCallStart, toolCallTitle, toolKind } from "./tool-calls.js";

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
  /**
   * Access to LuckyCLI's persistent config, used by the model roster and by
   * `session/set_model`. Injectable so tests never read or write the user's
   * real ~/.luckycli/config.json.
   */
  store?: {
    load: () => StoredConfig;
    save: (config: StoredConfig) => void;
  };
  /** Graph build used by the `/graph` command; injectable so tests stay offline. */
  buildGraph?: typeof buildAndSaveGraph;
  recordGraphBuilt?: typeof recordGraphBuilt;
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
  protected readonly store: NonNullable<LuckyAcpAgentOptions["store"]>;
  protected readonly buildGraph: typeof buildAndSaveGraph;
  protected readonly recordGraphBuilt: typeof recordGraphBuilt;
  protected readonly sessions = new Map<string, AcpSession>();
  /** Client fs capabilities captured at initialize; absent until then. */
  protected clientFs: { readTextFile?: boolean; writeTextFile?: boolean } = {};

  constructor(conn: AgentSideConnection, options: LuckyAcpAgentOptions = {}) {
    this.conn = conn;
    this.config = options.config;
    this.buildRuntime = options.buildRuntime ?? buildAgentRuntime;
    this.store = options.store ?? { load: loadStoredConfig, save: saveStoredConfig };
    this.buildGraph = options.buildGraph ?? buildAndSaveGraph;
    this.recordGraphBuilt = options.recordGraphBuilt ?? recordGraphBuilt;
  }

  async initialize(params: InitializeRequest): Promise<InitializeResponse> {
    // We implement exactly protocol v1. Per spec: echo the client's version
    // when we support it, otherwise answer with the latest we do support and
    // let the client decide whether to disconnect.
    const protocolVersion =
      params.protocolVersion === PROTOCOL_VERSION ? params.protocolVersion : PROTOCOL_VERSION;
    this.clientFs = {
      ...(params.clientCapabilities?.fs?.readTextFile ? { readTextFile: true } : {}),
      ...(params.clientCapabilities?.fs?.writeTextFile ? { writeTextFile: true } : {}),
    };
    return {
      protocolVersion,
      agentCapabilities: {
        // Sessions persist to LuckyCLI's own store, so a conversation started
        // in the TUI can continue in the editor and vice versa.
        loadSession: true,
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
    const session = await this.createSession(createSessionId(), params.cwd, params.mcpServers);
    return {
      sessionId: session.id,
      modes: sessionModeState(session),
      models: this.sessionModelState(session),
    };
  }

  async loadSession(params: {
    sessionId: string;
    cwd: string;
    mcpServers: NewSessionRequest["mcpServers"];
  }): Promise<{
    modes?: ReturnType<typeof sessionModeState>;
    models?: SessionModelState;
  }> {
    const stored = loadStoredSession(params.sessionId);
    if (!stored) {
      throw RequestError.invalidParams({
        details: `No saved session "${params.sessionId}".`,
      });
    }
    const session = await this.createSession(
      params.sessionId,
      params.cwd,
      params.mcpServers,
      stored.messages,
      stored.createdAt,
      // Resume on the provider/model the conversation was actually running,
      // as the TUI's session picker does — a session started on one model
      // must not silently continue on whatever the config now says.
      { provider: stored.provider, model: stored.model },
    );
    // Per spec the whole history streams back as notifications before the
    // response. Text only: tool traffic is transient UI state, and replaying
    // it without live rows confuses editors more than it helps.
    for (const message of stored.messages) {
      for (const part of message.content) {
        if (part.type !== "text" || !part.text.trim()) continue;
        await this.conn.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate:
              message.role === "user" ? "user_message_chunk" : "agent_message_chunk",
            content: { type: "text", text: part.text },
          },
        });
      }
    }
    return { modes: sessionModeState(session), models: this.sessionModelState(session) };
  }

  /** Build the engine runtime for a session and register its record. */
  protected async createSession(
    sessionId: string,
    cwd: string,
    mcpServers: NewSessionRequest["mcpServers"],
    messages?: Message[],
    createdAt?: number,
    resume?: { provider: ProviderId; model: string },
  ): Promise<AcpSession> {
    const config = this.requireConfig();
    // A resumed session keeps its own provider/model when we can still reach
    // that provider's credentials; otherwise it falls back to the configured
    // one rather than refusing to open at all.
    const resumeCredentials = resume ? resolveCredentials(resume.provider, this.store.load()) : undefined;
    const active =
      resume && resumeCredentials
        ? { provider: resume.provider, model: resume.model, credentials: resumeCredentials }
        : { provider: config.provider!, model: config.model!, credentials: config.credentials! };
    // The session record exists before the runtime so the approval bridge
    // (captured at build time) can close over its live state.
    const session: AcpSession = {
      id: sessionId,
      agent: undefined as unknown as AcpSession["agent"],
      provider: active.provider,
      model: active.model,
      credentials: active.credentials,
      cwd,
      mcpServers,
      abort: null,
      approved: new Set(),
      mode: "default",
      lastToolCallId: null,
      createdAt: createdAt ?? Date.now(),
      ...(this.clientFs.readTextFile
        ? {
            readTextFile: async (absPath: string): Promise<string | null> => {
              try {
                const response = await this.conn.readTextFile({ sessionId, path: absPath });
                return response.content;
              } catch {
                return null;
              }
            },
          }
        : {}),
    };
    session.agent = (await this.buildSessionRuntime(session, messages)).agent;
    this.sessions.set(sessionId, session);
    // Tell the editor which slash commands its command menu can offer. A
    // client that ignores the notification simply shows no menu; the commands
    // still work when typed, so this must never fail session creation.
    await this.conn
      .sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands: availableCommands(),
        },
      })
      .catch(() => {
        /* a dropped roster must not break the session */
      });
    return session;
  }

  /**
   * Build (or rebuild) the engine runtime for a session from its current
   * provider/model/credentials. Split out of createSession so switching model
   * mid-session goes through exactly the same wiring — bridges, fs overrides,
   * MCP merge and prompt composition included.
   */
  protected async buildSessionRuntime(
    session: AcpSession,
    messages?: Message[],
  ): Promise<BuiltAgentRuntime> {
    const mcpServers = session.mcpServers;
    const config = this.requireConfig();
    const sessionId = session.id;
    const cwd = session.cwd;
    return await this.buildRuntime({
      provider: session.provider,
      model: session.model,
      credentials: session.credentials,
      system: config.system,
      // Recompose the system prompt from this session's context (graph
      // presence, tools, cwd), exactly as the TUI does per activation.
      composeSystemFromContext: true,
      permissions: config.permissions,
      approveTool: (name, input) => this.requestToolPermission(sessionId, session, name, input),
      askUser: (request) => this.askUser(sessionId, request),
      presentPlan: (plan) => this.presentPlan(sessionId, plan),
      cwd,
      // When the editor advertises fs capabilities, the file tools read
      // through it (unsaved buffers included) and write into it. A null read
      // or a thrown write falls back to disk inside the tools (core
      // file-access), so an editor with no view of a file never blocks work.
      ...(session.readTextFile ? { readTextFile: session.readTextFile } : {}),
      ...(this.clientFs.writeTextFile
        ? {
            writeTextFile: async (absPath: string, content: string): Promise<void> => {
              await this.conn.writeTextFile({ sessionId, path: absPath, content });
            },
          }
        : {}),
      // Editor-supplied servers extend the user's own MCP config; the local
      // config wins on a name conflict (the user's auth/pins are explicit).
      mcp: mergeMcpServers(mapAcpMcpServers(mcpServers), config.mcp),
      ...(messages?.length ? { messages } : {}),
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
      ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
      // Reasoning effort and the thinking toggle are provider-specific knobs
      // resolved for the *configured* provider; they only apply while the
      // session is still running that provider.
      ...(config.reasoningEffort && session.provider === config.provider
        ? { reasoningEffort: config.reasoningEffort }
        : {}),
      ...(config.thinkingEnabled !== undefined && session.provider === config.provider
        ? { thinkingEnabled: config.thinkingEnabled }
        : {}),
    });
  }

  /** The roster + current selection, as session/new and session/load report it. */
  protected sessionModelState(session: AcpSession): SessionModelState | undefined {
    const roster = modelRoster(this.store.load(), {
      provider: session.provider,
      model: session.model,
    });
    if (!roster.currentModelId) return undefined;
    return {
      availableModels: roster.availableModels,
      currentModelId: roster.currentModelId,
    };
  }

  /**
   * Switch the session's provider/model. ACP exposes a single flat selector,
   * so the id carries both halves (see models.ts). The runtime is rebuilt
   * carrying the conversation, exactly as the TUI's model picker does, so the
   * next prompt continues the same thread on the new model.
   */
  async setSessionModel(params: {
    sessionId: string;
    modelId: string;
  }): Promise<Record<string, never>> {
    const session = this.requireSession(params.sessionId);
    // Rebuilding the runtime under a running turn would swap the agent out
    // from under the in-flight stream; refuse rather than corrupt the turn.
    if (session.abort) {
      throw RequestError.invalidRequest({
        details: "Cannot change model while a prompt is running.",
      });
    }
    const parsed = parseModelId(params.modelId);
    const stored = this.store.load();
    if (!parsed || !isSelectableModel(parsed, stored)) {
      throw RequestError.invalidParams({
        details: `Unknown or unusable model "${params.modelId}".`,
      });
    }
    const credentials = resolveCredentials(parsed.provider, stored);
    if (!credentials) {
      throw RequestError.invalidParams({
        details: `No credentials for provider "${parsed.provider}". ${AUTH_GUIDANCE}`,
      });
    }

    // Carry the conversation across the rebuild so context survives the switch.
    const carried = [...session.agent.messages];
    const previous = { provider: session.provider, model: session.model, credentials: session.credentials };
    session.provider = parsed.provider;
    session.model = parsed.model;
    session.credentials = credentials;
    try {
      session.agent = (
        await this.buildSessionRuntime(session, carried.length ? carried : undefined)
      ).agent;
    } catch (err) {
      // A provider that fails to build leaves the session on its old runtime
      // rather than in a half-switched state the next prompt would crash on.
      Object.assign(session, previous);
      throw RequestError.internalError({
        details: `Could not switch to "${params.modelId}": ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // Mirror the TUI: the choice persists, so the next `lucky` run and the
    // next editor session agree on what the user picked.
    try {
      this.store.save({ ...stored, provider: parsed.provider, model: parsed.model });
    } catch {
      // A read-only config must not fail an otherwise successful switch.
    }
    return {};
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

    // For the write tools, show what the call would change before it runs.
    // The diff goes out twice: once as an update on the row the editor is
    // already rendering — which is what makes editors open the file and show
    // the change full-size — and once inside the permission request itself,
    // for clients that render only the request. An unprovable preview (bad
    // patch, unreadable file) simply yields no diff.
    const preview = PREVIEWABLE_TOOLS.has(name)
      ? await this.previewDiff(session, name, input)
      : undefined;
    if (preview && session.lastToolCallId) {
      await this.conn
        .sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: session.lastToolCallId,
            status: "pending",
            content: preview.content,
            locations: preview.locations,
          },
        })
        .catch(() => {
          /* a dropped preview must never block the approval */
        });
    }

    const response = await this.conn.requestPermission({
      sessionId,
      toolCall: {
        toolCallId: session.lastToolCallId ?? name,
        title: toolCallTitle(name, input),
        kind: toolKind(name),
        status: "pending",
        ...(preview ? { content: preview.content, locations: preview.locations } : {}),
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

  /**
   * The diff a pending write tool would produce, as ACP content + locations,
   * or undefined when there is nothing to show. Files are read through the
   * editor when it advertised fs access (so unsaved buffers are what gets
   * previewed) and from disk otherwise; either way a failure is swallowed —
   * the approval must still be askable.
   */
  protected async previewDiff(
    session: AcpSession,
    name: string,
    input: unknown,
  ): Promise<{ content: ToolCallContent[]; locations: { path: string }[] } | undefined> {
    const diffs = await previewToolDiffs(name, input, async (path) => {
      const abs = isAbsolute(path) ? path : join(session.cwd, path);
      if (session.readTextFile) {
        const hosted = await session.readTextFile(abs);
        if (hosted !== null) return hosted;
      }
      try {
        return await readFile(abs, "utf8");
      } catch {
        return undefined;
      }
    });
    if (diffs.length === 0) return undefined;
    return {
      content: diffContents(diffs, session.cwd),
      locations: diffs.map((diff) => ({
        path: isAbsolute(diff.path) ? diff.path : join(session.cwd, diff.path),
      })),
    };
  }

  /**
   * Run an editor slash command inside the turn: its output streams back as
   * agent message chunks and the turn ends normally, so the editor renders it
   * in the transcript like any other reply and cancellation still works.
   *
   * Commands never reach the model, and a command that throws still ends the
   * turn — a broken command must not wedge the session.
   */
  protected async runCommand(
    session: AcpSession,
    parsed: ParsedCommand,
  ): Promise<PromptResponse> {
    const abort = new AbortController();
    session.abort = abort;
    try {
      let text: string;
      if (!parsed.command) {
        text = unknownCommandHelp(parsed.name);
      } else {
        try {
          text = await parsed.command.run(parsed.args, {
            agent: session.agent,
            ...(session.context ? { context: session.context } : {}),
            cwd: session.cwd,
            provider: session.provider,
            model: session.model,
            buildGraph: this.buildGraph,
            recordGraphBuilt: this.recordGraphBuilt,
            store: this.store,
            setContext: (status) => {
              session.context = status;
            },
            rebuild: async () => {
              session.agent = (
                await this.buildSessionRuntime(session, [...session.agent.messages])
              ).agent;
            },
          });
        } catch (err) {
          text = `Command \`/${parsed.name}\` failed: ${
            err instanceof Error ? err.message : String(err)
          }`;
        }
      }
      await this.conn.sessionUpdate({
        sessionId: session.id,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        },
      });
      return { stopReason: abort.signal.aborted ? "cancelled" : "end_turn" };
    } finally {
      session.abort = null;
      // A command can change the conversation (/compact) or the runtime
      // (/thinking); persist so both surfaces see the same session.
      this.persistSession(session);
    }
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

    // A prompt whose first text block starts with `/name` is a command from
    // the editor's command menu, not something to send to the model.
    const first = content.find((part) => part.type === "text");
    const parsed = first?.type === "text" ? parseCommand(first.text) : undefined;
    if (parsed) return await this.runCommand(session, parsed);

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
    // ACP has no standard shape for context usage, so it rides along as _meta
    // on the next update we were going to send anyway (editors ignore unknown
    // _meta by contract) rather than as a stream of notifications the editor
    // cannot render. In practice the engine emits its reading immediately
    // before turn_end, so the PromptResponse below is usually what carries it;
    // this pump exists for the readings that land mid-turn (compaction).
    let pendingContext: ContextStatus | undefined;
    const withContextMeta = <T extends SessionNotification>(notification: T): T => {
      if (!pendingContext) return notification;
      const meta = { [CONTEXT_META_KEY]: contextMeta(pendingContext) };
      pendingContext = undefined;
      return { ...notification, update: { ...notification.update, _meta: meta } };
    };
    try {
      for await (const event of session.agent.send(content, abort.signal)) {
        switch (event.type) {
          case "text":
            await this.conn.sessionUpdate(
              withContextMeta({
                sessionId: params.sessionId,
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: event.delta },
                },
              }),
            );
            break;
          case "tool_start":
            session.lastToolCallId = event.id;
            if (!HIDDEN_TOOLS.has(event.name)) {
              await this.conn.sessionUpdate(
                withContextMeta(toolCallStart(params.sessionId, event, session.cwd)),
              );
            }
            break;
          case "tool_end":
            if (!HIDDEN_TOOLS.has(event.name)) {
              await this.conn.sessionUpdate(
                withContextMeta(toolCallEnd(params.sessionId, event, session.cwd)),
              );
            }
            break;
          case "context":
            // Held for the next update; the freshest reading wins. A reading
            // with no token counts at all carries nothing an editor could
            // render, so it is recorded but never published.
            session.context = event.status;
            if (hasTokenCounts(event.status)) pendingContext = event.status;
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
            // reasoning (no text payload), compaction — no ACP shape.
            break;
        }
      }
    } finally {
      session.abort = null;
      unsubscribeTasks();
      // Persist after every turn (like the TUI) so the conversation can be
      // resumed from either surface — including after an error or a cancel.
      this.persistSession(session);
    }
    // Non-standard but honest: surface what the turn cost and where the
    // context window stands. Editors ignore unknown _meta by contract, and
    // `/context` reports the same figures for those that do.
    const meta = {
      ...(usage ? { [USAGE_META_KEY]: usage } : {}),
      ...(session.context && hasTokenCounts(session.context)
        ? { [CONTEXT_META_KEY]: contextMeta(session.context) }
        : {}),
    };
    return {
      stopReason,
      ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
    };
  }

  async cancel(params: CancelNotification): Promise<void> {
    // Per spec a cancel for an unknown session (or an idle one) is a no-op —
    // it must never crash the server.
    this.sessions.get(params.sessionId)?.abort?.abort();
  }

  /** Best-effort save into LuckyCLI's session store (shared with the TUI). */
  protected persistSession(session: AcpSession): void {
    try {
      const messages = [...session.agent.messages];
      if (messages.length === 0) return;
      const title = deriveTitle(messages);
      saveSession({
        id: session.id,
        ...(title ? { title } : {}),
        // The session's own provider/model, which set_model may have changed
        // away from the stored config's.
        provider: session.provider,
        model: session.model,
        createdAt: session.createdAt,
        updatedAt: Date.now(),
        messages,
      });
    } catch {
      // Persistence must never break a turn (stub agents in tests, full disk…).
    }
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

/** The mode roster + current mode, as session/new and session/load report it. */
function sessionModeState(session: AcpSession): {
  currentModeId: string;
  availableModes: { id: string; name: string; description: string }[];
} {
  return {
    currentModeId: session.mode,
    availableModes: ACP_SESSION_MODES.map(({ id, name, description }) => ({
      id,
      name,
      description,
    })),
  };
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
