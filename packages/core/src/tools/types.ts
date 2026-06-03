import type { z } from "zod";

/** Context handed to every tool at execution time. */
export interface AskUserRequest {
  /** Question to present to the user. */
  question: string;
  /** Optional predefined answers the user can pick from. */
  options?: string[];
  /** Whether free-form text is accepted. Defaults to true. */
  allowFreeText?: boolean;
}

export interface ToolContext {
  /** Working directory the agent is anchored to. */
  cwd: string;
  /** Cancellation signal propagated from the agent loop. */
  signal?: AbortSignal;
  /** Optional bridge for tools that need to ask the human a question. */
  askUser?: (request: AskUserRequest) => Promise<string>;
  /**
   * Notify the host that files changed (repo-relative or absolute paths), after
   * a successful mutation. The host uses this to keep the knowledge graph fresh
   * without the model having to ask. Fire-and-forget; never throws.
   */
  onFilesChanged?: (paths: string[]) => void;
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
  readonly?: boolean;
  execute(input: z.infer<Schema>, ctx: ToolContext): Promise<ToolResult>;
}

/** Define a tool with full input-type inference on `execute`. */
export function defineTool<Schema extends z.ZodType>(
  tool: Tool<Schema>,
): Tool<Schema> {
  return tool;
}
