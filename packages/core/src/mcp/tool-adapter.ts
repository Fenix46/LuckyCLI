import { z } from "zod";
import { defineTool, type Tool, type ToolResult } from "../tools/types.js";
import type { McpToolDescriptor } from "./types.js";

export interface McpToolInvocation {
  server: string;
  tool: string;
  arguments: Record<string, unknown>;
}

export type McpToolInvoker = (
  invocation: McpToolInvocation,
) => Promise<ToolResult>;

function sanitizeNamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function makeMcpToolName(server: string, tool: string): string {
  return `${sanitizeNamePart(server)}_${sanitizeNamePart(tool)}`;
}

export function adaptMcpTool(
  server: string,
  descriptor: McpToolDescriptor,
  invoke: McpToolInvoker,
): Tool<z.ZodObject<z.ZodRawShape, "passthrough">> {
  return defineTool({
    name: makeMcpToolName(server, descriptor.name),
    description: descriptor.description ?? `MCP tool ${descriptor.name} from server ${server}.`,
    schema: z.object({}).passthrough(),
    parametersSchema: normalizeToolInputSchema(descriptor.inputSchema),
    async execute(input) {
      return invoke({
        server,
        tool: descriptor.name,
        arguments: input,
      });
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
