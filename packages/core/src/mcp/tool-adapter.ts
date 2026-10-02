import { createHash } from "node:crypto";
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

/**
 * Providers reject tool names longer than 64 characters (Claude and OpenAI
 * both cap them there), and one bad name fails every request of the session.
 */
export const MAX_TOOL_NAME_LENGTH = 64;

export function makeMcpToolName(server: string, tool: string): string {
  return fitToolName(`${sanitizeNamePart(server)}_${sanitizeNamePart(tool)}`);
}

/**
 * Shorten a too-long name to the limit, keeping its start and swapping the
 * rest for a short hash of the full name so distinct long names stay distinct
 * and stable across sessions.
 */
function fitToolName(name: string, max = MAX_TOOL_NAME_LENGTH): string {
  if (name.length <= max) return name;
  const hash = createHash("sha1").update(name).digest("hex").slice(0, 8);
  return `${name.slice(0, max - hash.length - 1)}_${hash}`;
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
  for (let n = 2; taken.has(name); n++) {
    const suffix = `_${n}`;
    name = `${fitToolName(base, MAX_TOOL_NAME_LENGTH - suffix.length)}${suffix}`;
  }
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
    // A tool the server declares read-only gets the same default permission
    // as the built-in reads instead of an approval prompt on every call.
    readonly: descriptor.readOnly === true,
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
