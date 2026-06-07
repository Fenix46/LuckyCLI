import { z } from "zod";
import { createTask, getActiveTaskListId } from "../../tasks/store.js";
import { defineTool } from "../types.js";

const WHEN_TO_USE = `Present a development plan to the user for approval before implementing non-trivial work.

Use this when the user asks you to plan something (e.g. "plan", "pianifica", "make a plan") or when the task is non-trivial: 3+ steps, multiple files, or architectural choices.

Workflow before calling this tool:
1. Explore read-only (read_file, grep, glob, graph_query/graph_overview) to understand the code.
2. Clarify any open questions or choices with ask_user.
3. Then call present_plan with the plan (in markdown) and the list of tasks it breaks down into.

Do NOT modify any files before the plan is approved. On accept, the tasks you provide are created automatically in the task list — afterwards, execute them, marking each in_progress before you start and completed when done. If the user asks for changes, revise and call present_plan again. If they reject, stop and await instructions.`;

export const presentPlanTool = defineTool({
  name: "present_plan",
  description: WHEN_TO_USE,
  // Read-only with respect to the codebase: it only proposes work. The user's
  // confirmation is the gate; task creation happens only on accept.
  readonly: true,
  schema: z.object({
    title: z.string().min(1).describe("A short title for the plan."),
    plan: z
      .string()
      .min(1)
      .describe("The full plan, in markdown. Shown to the user for approval."),
    tasks: z
      .array(
        z.object({
          subject: z.string().min(1).describe("A brief title for the task."),
          description: z
            .string()
            .min(1)
            .describe("What needs to be done for this step."),
          activeForm: z
            .string()
            .optional()
            .describe('Present-continuous form (e.g. "Running tests").'),
        }),
      )
      .min(1)
      .describe("The tasks the plan breaks down into, created on accept."),
  }),
  async execute({ title, plan, tasks }, ctx) {
    if (!ctx.presentPlan) {
      return {
        content:
          "Cannot present a plan in this environment: no interactive presentPlan bridge is configured.",
        isError: true,
      };
    }

    const decision = await ctx.presentPlan({ title, markdown: plan, tasks });

    if (decision.action === "modify") {
      const feedback = decision.feedback?.trim();
      return {
        content: feedback
          ? `User requested changes to the plan: ${feedback}\nRevise the plan and call present_plan again. Do not create tasks or edit files yet.`
          : "User requested changes to the plan. Revise it and call present_plan again. Do not create tasks or edit files yet.",
      };
    }

    if (decision.action === "reject") {
      return {
        content:
          "User rejected the plan. Stop and await further instructions. Do not create tasks or edit files.",
      };
    }

    // Accepted: create the tasks atomically so the executed work matches the
    // plan the user just approved.
    const taskListId = getActiveTaskListId();
    const created = tasks.map((t) =>
      createTask(taskListId, {
        subject: t.subject,
        description: t.description,
        ...(t.activeForm ? { activeForm: t.activeForm } : {}),
        status: "pending",
      }),
    );
    const ids = created.map((t) => `#${t.id}`).join(", ");
    return {
      content:
        `Plan approved. Created ${created.length} task${created.length === 1 ? "" : "s"} (${ids}). ` +
        `Begin now: mark each task in_progress before you start it and completed when done.`,
    };
  },
});
