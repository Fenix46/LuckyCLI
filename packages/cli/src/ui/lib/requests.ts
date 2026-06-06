import type { AskUserRequest, PlanProposal, ToolApproval } from "@luckycli/core";

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
