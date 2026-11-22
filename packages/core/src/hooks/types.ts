/**
 * Hook events. Mirrors the lifecycle Claude Code exposes: a host runs a
 * user-defined handler when the agent reaches a named point, and the handler
 * can observe, annotate or block the action.
 *
 * Not every event is wired by the agent yet; the type lists the full vocabulary
 * so configs and the `/hooks` command can be forward-compatible.
 */
export const HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PostToolBatch",
  "Notification",
  "UserPromptSubmit",
  "UserPromptExpansion",
  "SessionStart",
  "SessionEnd",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "PostCompact",
  "PreModelSwitch",
  "PostModelSwitch",
  "PermissionRequest",
  "PermissionDenied",
  "Setup",
  "TeammateIdle",
  "TaskCreated",
  "TaskCompleted",
  "Elicitation",
  "ElicitationResult",
  "ConfigChange",
  "WorktreeCreate",
  "WorktreeRemove",
  "InstructionsLoaded",
  "CwdChanged",
  "FileChanged",
  "DirectoryAdded",
  "MessageDisplay",
] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

export function isHookEvent(value: string): value is HookEvent {
  return (HOOK_EVENTS as readonly string[]).includes(value);
}

/** A handler the runner can execute. */
export interface HookCommand {
  type: "command";
  /** Shell command. Receives the hook JSON on stdin. */
  command: string;
  /** Seconds; defaults to 60. */
  timeout?: number;
}

export interface HookHttp {
  type: "http";
  url: string;
  headers?: Record<string, string>;
  /** Seconds; defaults to 60. */
  timeout?: number;
}

/**
 * Injects `prompt` as additional context. Cheap and side-effect free, so it is
 * useful for reminders that don't need to inspect the payload.
 */
export interface HookPrompt {
  type: "prompt";
  prompt: string;
}

export type HookHandler = HookCommand | HookHttp | HookPrompt;

export interface HookMatcher {
  /**
   * Regex matched against the tool name for tool events. Omitted or "*" matches
   * every call. Other events ignore it.
   */
  matcher?: string;
  hooks: HookHandler[];
}

export type HookConfig = Partial<Record<HookEvent, HookMatcher[]>>;

/** JSON handed to a command/http hook. */
export interface HookInput {
  session_id: string;
  cwd: string;
  hook_event_name: HookEvent;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: { content: string; isError: boolean };
  prompt?: string;
  source?: string;
  [key: string]: unknown;
}

/** A normalized handler result. */
export interface HookResult {
  /** True when the hook stopped the action. */
  blocked: boolean;
  /** Why it blocked; also used as the model-facing explanation. */
  reason?: string;
  /** Text to add to the prompt/tool result. */
  additionalContext?: string;
  /** Replacement tool input (PreToolUse only). */
  updatedInput?: Record<string, unknown>;
  /** Non-fatal problems, shown to the user but never sent as a block. */
  warnings: string[];
}

/** The narrow interface the agent depends on; tests supply fakes. */
export interface HookRunner {
  run(
    event: HookEvent,
    payload: {
      toolName?: string;
      toolInput?: unknown;
      toolResponse?: { content: string; isError: boolean };
      prompt?: string;
      source?: string;
    },
  ): Promise<HookResult>;
  /** True when at least one handler is configured for the event. */
  has(event: HookEvent): boolean;
}

export const EMPTY_HOOK_RESULT: HookResult = { blocked: false, warnings: [] };
