import { z } from "zod";
import { defineTool } from "../types.js";

const MAX_SCHEMA_CHARS = 6_000;

/**
 * Discover tools that were left out of the advertised set to save schema
 * tokens (typically MCP servers with many tools). The matched tools are
 * activated for the next step; the result carries their full schemas so the
 * model can plan the call now.
 */
export const toolSearchTool = defineTool({
  name: "tool_search",
  description:
    "Find additional tools that are not currently in your tool list. " +
    "Some tools (especially MCP servers) are hidden until you need them: " +
    "search by capability, read the returned schemas, and call the tool in your " +
    "next step. The tools already listed are always available; use this only " +
    "when the tool you need is missing.",
  readonly: true,
  concurrencySafe: true,
  schema: z.object({
    query: z
      .string()
      .min(1)
      .describe("Capability or keywords, e.g. \"jira issue\" or \"screenshot browser\"."),
    max_results: z
      .number()
      .int()
      .positive()
      .max(10)
      .optional()
      .describe("Maximum tools to return (default 5, at most 10)."),
  }),
  async execute({ query, max_results }, ctx) {
    if (!ctx.toolSearch || !ctx.activateTools) {
      return {
        content: "Tool search is not available in this environment; use the tools already listed.",
        isError: true,
      };
    }
    const matches = ctx.toolSearch(query, max_results ?? 5);
    if (matches.length === 0) {
      return {
        content:
          `No deferred tools match "${query}". The tools already listed are the ones ` +
          "available; try a different capability or continue with them.",
      };
    }
    const activated = ctx.activateTools(matches.map((match) => match.name));
    const body = matches
      .map((match) => {
        const schema = JSON.stringify(match.parameters, null, 2);
        const shown =
          schema.length > MAX_SCHEMA_CHARS
            ? `${schema.slice(0, MAX_SCHEMA_CHARS)}\n... [schema truncated; the full one is in the next request]`
            : schema;
        return `## ${match.name}\n${match.description}\n\nArguments:\n\`\`\`json\n${shown}\n\`\`\``;
      })
      .join("\n\n");
    const activation = activated.length > 0
      ? `Activated: ${activated.join(", ")}. They are available in your next step.`
      : "They were already active.";
    return { content: `${body}\n\n${activation}` };
  },
});
