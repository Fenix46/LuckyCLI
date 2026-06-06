/**
 * Types for the planning flow (Claude Code's plan mode, adapted).
 *
 * The agent explores read-only, clarifies open questions via ask_user, then
 * calls the `present_plan` tool with a development plan and the list of tasks it
 * proposes. The CLI prints the plan and asks the user to accept, modify, or
 * reject it through the `presentPlan` bridge on ToolContext. On accept, the tool
 * creates the tasks in the task store so the agent can execute them.
 */

/** A single task the plan proposes, mirroring the task store's create shape. */
export interface PlanTask {
  subject: string;
  description: string;
  /** Present-continuous form shown while the task is in_progress. */
  activeForm?: string;
}

/** A development plan presented to the user for approval. */
export interface PlanProposal {
  title: string;
  /** The plan body, in markdown. */
  markdown: string;
  /** The tasks to create if the user accepts. */
  tasks: PlanTask[];
}

/** The user's decision on a presented plan. */
export interface PlanDecision {
  action: "accept" | "modify" | "reject";
  /** Free-text guidance the user gave when asking for changes (modify). */
  feedback?: string;
}
