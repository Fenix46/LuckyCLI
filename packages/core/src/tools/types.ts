import type { z } from "zod";

/** Context handed to every tool at execution time. */
export interface ToolContext {
  /** Working directory the agent is anchored to. */
  cwd: string;
  /** Cancellation signal propagated from the agent loop. */
  signal?: AbortSignal;
}

/** Result of running a tool. `content` is always a string fed back to the model. */
export interface ToolResult {
  content: string;
  isError?: boolean;
}

/**
 * A tool the agent can call. The input schema is a zod schema: it validates the
 * model's arguments at runtime and is converted to JSON Schema when advertised
 * to a provider — single source of truth, type-safe end to end.
 */
export interface Tool<Schema extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: Schema;
  execute(input: z.infer<Schema>, ctx: ToolContext): Promise<ToolResult>;
}

/** Define a tool with full input-type inference on `execute`. */
export function defineTool<Schema extends z.ZodType>(
  tool: Tool<Schema>,
): Tool<Schema> {
  return tool;
}
