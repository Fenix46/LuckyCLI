import type { AskUserRequest, ToolApproval } from "@luckycli/core";

export interface ApprovalRequest {
  name: string;
  input: unknown;
  resolve: (decision: ToolApproval) => void;
}

export interface UserQuestionRequest extends AskUserRequest {
  resolve: (answer: string) => void;
}

/** Session-wide tool-approval mode, cycled from the prompt with Shift+Tab. */
export type PermissionMode = "normal" | "acceptEdits";
