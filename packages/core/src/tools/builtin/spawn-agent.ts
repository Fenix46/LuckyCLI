import { z } from "zod";
import { defineTool } from "../types.js";

const WHEN_TO_USE = `Delegate a self-contained sub-task to a sub-agent running on a specific provider/model profile (see the /agents menu).

Use this for large work that splits cleanly into parts that benefit from different models — e.g. a new project where the frontend, backend, and docs each go to a profile chosen for performance/cost. Give the sub-agent a precise, self-contained task; it runs to completion on its assigned model and returns a report you then integrate.

Rules:
- One sub-agent runs at a time (sequential): wait for the report before delegating the next part.
- Pass the profile name in 'agent' (e.g. "frontend") and detailed instructions in 'task'. The sub-agent does not see this conversation — include everything it needs.
- Do not delegate trivial work you can do directly. Prefer low-cost profiles for simple tasks (e.g. docs).
- If a profile is assigned to a provider you are not logged into, the tool errors — tell the user to fix the assignment in /agents.`;

export const spawnAgentTool = defineTool({
  name: "spawn_agent",
  description: WHEN_TO_USE,
  // Writes to the filesystem through the sub-agent: treat as a mutating action
  // so it goes through the permission gate.
  readonly: false,
  schema: z.object({
    agent: z
      .string()
      .min(1)
      .describe('The agent profile name to run as (e.g. "frontend").'),
    task: z
      .string()
      .min(1)
      .describe(
        "Detailed, self-contained instructions for the sub-agent. It cannot see this conversation.",
      ),
  }),
  async execute({ agent, task }, ctx) {
    if (!ctx.runSubAgent) {
      return {
        content:
          "Cannot delegate to a sub-agent in this environment: no runSubAgent bridge is configured.",
        isError: true,
      };
    }

    try {
      const { report } = await ctx.runSubAgent({ agent, task }, ctx.signal);
      return {
        content: report
          ? `Sub-agent "${agent}" finished. Report:\n\n${report}`
          : `Sub-agent "${agent}" finished but produced no report.`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: message, isError: true };
    }
  },
});
