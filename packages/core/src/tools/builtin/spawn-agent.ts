import { z } from "zod";
import { defineTool } from "../types.js";

const WHEN_TO_USE = `Delegate a self-contained sub-task to a sub-agent running on a specific provider/model profile (see the /agents menu).

Use this for large work that splits cleanly into parts that benefit from different models — e.g. a new project where the frontend, backend, and docs each go to a profile chosen for performance/cost. Give the sub-agent a precise, self-contained task; it runs to completion on its assigned model and returns a report you then integrate.

Rules:
- Independent parts can run in parallel: issue several spawn_agent calls in the same response, each with 'files' listing what it will write (files, directories or globs such as "docs/**"). They run side by side only when every call lists files and no two lists overlap; otherwise they run one after another. A sub-agent cannot write outside its 'files' with the file tools, so split the work along file boundaries — and don't give parallel sub-agents shell commands that write outside their files.
- Without 'files', a sub-agent may write anywhere and runs alone.
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
    files: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe(
        'Files the sub-agent may write: paths, directories or globs (e.g. ["src/api/**", "README.md"]). Required for parallel runs.',
      ),
  }),
  conflictKeys: (input) => {
    const files = (input as { files?: unknown } | null)?.files;
    return Array.isArray(files) && files.length > 0 && files.every((f) => typeof f === "string")
      ? (files as string[])
      : undefined;
  },
  async execute({ agent, task, files }, ctx) {
    if (!ctx.runSubAgent) {
      return {
        content:
          "Cannot delegate to a sub-agent in this environment: no runSubAgent bridge is configured.",
        isError: true,
      };
    }

    try {
      const { report } = await ctx.runSubAgent({ agent, task, ...(files ? { files } : {}) }, ctx.signal);
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
