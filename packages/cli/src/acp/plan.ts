/**
 * Plan reporting for ACP: the engine's present_plan proposals and the task
 * store's live checklist both surface as ACP `plan` updates — the editor
 * equivalent of the TUI's plan view and TaskPanel.
 *
 * Pure builders; the server owns the connection and the store subscription.
 */
import type { PlanProposal, Task } from "@luckycli/core";
import type { SessionNotification } from "@zed-industries/agent-client-protocol";

type PlanEntry = Extract<
  SessionNotification["update"],
  { sessionUpdate: "plan" }
>["entries"][number];

/** The live task checklist as plan entries (statuses map one-to-one). */
export function planEntriesFromTasks(tasks: Task[]): PlanEntry[] {
  return tasks.map((task) => ({
    content:
      task.status === "in_progress" && task.activeForm ? task.activeForm : task.subject,
    // The core store has no priority notion; medium renders neutrally.
    priority: "medium",
    status: task.status,
  }));
}

/** `plan` update for the current state of a session's task list. */
export function planUpdateFromTasks(sessionId: string, tasks: Task[]): SessionNotification {
  return {
    sessionId,
    update: { sessionUpdate: "plan", entries: planEntriesFromTasks(tasks) },
  };
}

/** `plan` update announcing a freshly proposed (not yet accepted) plan. */
export function planUpdateFromProposal(
  sessionId: string,
  plan: PlanProposal,
): SessionNotification {
  return {
    sessionId,
    update: {
      sessionUpdate: "plan",
      entries: plan.tasks.map((task) => ({
        content: task.subject,
        priority: "medium" as const,
        status: "pending" as const,
      })),
    },
  };
}

/** The plan body as a message chunk, so the user can actually read it. */
export function planBodyUpdate(sessionId: string, plan: PlanProposal): SessionNotification {
  return {
    sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: `## Plan: ${plan.title}\n\n${plan.markdown}\n` },
    },
  };
}
