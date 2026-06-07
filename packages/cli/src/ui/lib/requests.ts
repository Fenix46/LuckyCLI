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

/** Session-wide tool-approval mode, cycled from the prompt with Shift+Tab. */
export type PermissionMode = "normal" | "acceptEdits";

/** Live token consumption of one running/finished sub-agent. */
export interface AgentUsageEntry {
  provider: ProviderId;
  model: string;
  usage: TokenUsage;
}

/** Sub-agent token consumption keyed by profile name, for the live panel. */
export type AgentUsageMap = Map<string, AgentUsageEntry>;
