import type {
  AskUserRequest,
  PlanProposal,
  ProviderId,
  TokenUsage,
  ToolApproval,
} from "@luckycli/core";

export interface ApprovalRequest {
  name: string;
  input: unknown;
  /** Why the command policy wants a human yes (e.g. "pushes to a remote repository"). */
  reason?: string;
  /** Flagged by the command policy: "always" then covers only this exact command. */
  risky?: boolean;
  resolve: (decision: ToolApproval) => void;
}

export interface UserQuestionRequest extends AskUserRequest {
  resolve: (answer: string) => void;
}

/**
 * A development plan being shown in the transcript while its accept/modify/
 * reject decision is collected through the question UI. The decision itself
 * flows back via the askUser bridge, so no resolver is carried here.
 */
export type PlanRequest = PlanProposal;

/**
 * Session-wide tool-approval mode, cycled from the prompt with Shift+Tab:
 *  - normal: every side-effecting tool asks.
 *  - acceptEdits: file edits are auto-approved; shell commands still ask.
 *  - auto: everything is auto-approved except shell calls that opt into
 *    destructive commands (see requiresApprovalInAutoMode).
 */
export type PermissionMode = "normal" | "acceptEdits" | "auto";

const PERMISSION_MODE_CYCLE: readonly PermissionMode[] = ["normal", "acceptEdits", "auto"];

/** The mode Shift+Tab switches to from `current`. */
export function nextPermissionMode(current: PermissionMode): PermissionMode {
  const index = PERMISSION_MODE_CYCLE.indexOf(current);
  return PERMISSION_MODE_CYCLE[(index + 1) % PERMISSION_MODE_CYCLE.length] ?? "normal";
}

/** Live token consumption of one running/finished sub-agent. */
export interface AgentUsageEntry {
  provider: ProviderId;
  model: string;
  usage: TokenUsage;
}

/** Sub-agent token consumption keyed by profile name, for the live panel. */
export type AgentUsageMap = Map<string, AgentUsageEntry>;
