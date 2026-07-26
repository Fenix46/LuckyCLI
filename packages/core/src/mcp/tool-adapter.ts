import { z } from "zod";
import { defineTool, type Tool, type ToolContext, type ToolResult } from "../tools/types.js";
import type { McpToolDescriptor } from "./types.js";

export interface McpToolInvocation {
  server: string;
  tool: string;
  arguments: Record<string, unknown>;
}

export type McpToolInvoker = (
  invocation: McpToolInvocation,
  ctx: ToolContext,
) => Promise<ToolResult>;

function sanitizeNamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function makeMcpToolName(server: string, tool: string): string {
  return `${sanitizeNamePart(server)}_${sanitizeNamePart(tool)}`;
}

/**
 * Sanitization is lossy, so distinct server/tool pairs can produce the same
 * name — `("docs/api", "search")` and `("docs", "api_search")` both give
 * `docs_api_search`. The registry rejects duplicates, which would otherwise
 * make a configured tool silently disappear from the model's toolset.
 *
 * Give the first claimant the natural name (stable for the overwhelmingly
 * common no-collision case) and suffix later ones with `_2`, `_3`, … `taken`
 * accumulates across calls so a caller can disambiguate against names already
 * registered elsewhere.
 */
export function uniqueMcpToolName(
  server: string,
  tool: string,
  taken: Set<string>,
): string {
  const base = makeMcpToolName(server, tool);
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
  taken.add(name);
  return name;
}

export function adaptMcpTool(
  server: string,
  descriptor: McpToolDescriptor,
  invoke: McpToolInvoker,
  /** Registry name, when the caller has already disambiguated collisions. */
  name = makeMcpToolName(server, descriptor.name),
): Tool<z.ZodObject<z.ZodRawShape, "passthrough">> {
  return defineTool({
    name,
    description: descriptor.description ?? `MCP tool ${descriptor.name} from server ${server}.`,
    schema: z.object({}).passthrough(),
    parametersSchema: normalizeToolInputSchema(descriptor.inputSchema),
    async execute(input, ctx) {
      return invoke(
        {
          server,
          tool: descriptor.name,
          arguments: input,
        },
        ctx,
      );
    },
  });
}

function normalizeToolInputSchema(
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return {
    ...(schema ?? {}),
    type: "object",
    ...(schema?.properties && typeof schema.properties === "object"
      ? { properties: schema.properties }
      : {}),
  };
}
