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
import { APP_VERSION } from "../ui/components/constants.js";

/** Guidance surfaced whenever the stored config can't drive a session. */
export const AUTH_GUIDANCE =
  "LuckyCLI manages credentials outside the editor: run `lucky` once in a terminal to pick a provider and log in, then reconnect.";

/**
 * The agent-side handler for one editor connection. Owns no I/O of its own —
 * the AgentSideConnection routes incoming JSON-RPC calls here and `conn` is
 * used to push updates back (session/update, permission requests, …).
 */
export class LuckyAcpAgent implements Agent {
  /** The connection back to the editor; used from milestone 2 onward. */
  protected readonly conn: AgentSideConnection;

  constructor(conn: AgentSideConnection) {
    this.conn = conn;
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
        // Declared once client-supplied MCP servers are wired (task 2.1).
        mcpCapabilities: { http: false, sse: false },
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

  async newSession(_params: NewSessionRequest): Promise<NewSessionResponse> {
    throw notYetImplemented("session/new");
  }

  async prompt(_params: PromptRequest): Promise<PromptResponse> {
    throw notYetImplemented("session/prompt");
  }

  async cancel(_params: CancelNotification): Promise<void> {
    // Nothing to cancel until sessions exist (milestone 2); a stray cancel
    // notification must never crash the server.
  }
}

/** Milestone gate: a clean JSON-RPC error instead of a crash or a hang. */
function notYetImplemented(method: string): RequestError {
  return RequestError.methodNotFound(method);
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
