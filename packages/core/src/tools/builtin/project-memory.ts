import { z } from "zod";
import { appendProjectMemory, replaceProjectMemory } from "../../project-memory.js";
import { defineTool } from "../types.js";

export const projectMemoryTool = defineTool({
  name: "project_memory",
  description:
    "Update persistent project memory stored in .lucky/memory.md. Use only for stable, " +
    "project-specific facts that should carry across future LuckyCLI sessions: repo conventions, " +
    "important decisions, recurring commands, completed long-lived work, or user preferences for this project.",
  schema: z.object({
    operation: z
      .enum(["append", "replace"])
      .describe("append adds one concise memory note; replace rewrites the full memory file."),
    content: z.string().min(1).describe("Memory note or full markdown content, depending on operation."),
  }),
  async execute({ operation, content }, ctx) {
    const memory =
      operation === "replace"
        ? await replaceProjectMemory(ctx.cwd, content)
        : await appendProjectMemory(ctx.cwd, content);
    const relative = ".lucky/memory.md";
    return {
      content: `Project memory ${operation === "replace" ? "replaced" : "updated"} at ${relative} (${memory.content.length} chars).`,
    };
  },
});
