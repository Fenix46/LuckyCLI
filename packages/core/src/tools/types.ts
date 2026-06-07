import type { z } from "zod";
import type { PlanDecision, PlanProposal } from "../agent/plan.js";

/** Context handed to every tool at execution time. */
export interface AskUserRequest {
  /** Question to present to the user. */
  question: string;
  /** Optional predefined answers the user can pick from. */
  options?: string[];
  /** Whether free-form text is accepted. Defaults to true. */
  allowFreeText?: boolean;
}

/** A request from the spawn_agent tool to delegate work to a sub-agent. */
export interface SpawnAgentRequest {
  /** Name of the agent profile to run as (see /agents). */
  agent: string;
  /** The task instructions for the sub-agent. */
  task: string;
}

/** What the spawn_agent bridge returns once the sub-agent finishes. */
export interface SpawnAgentResult {
  /** The sub-agent's report, relayed back to the main agent. */
  report: string;
}

export interface ToolContext {
  /** Working directory the agent is anchored to. */
  cwd: string;
  /** Cancellation signal propagated from the agent loop. */
  signal?: AbortSignal;
  /** Optional bridge for tools that need to ask the human a question. */
  askUser?: (request: AskUserRequest) => Promise<string>;
  /**
   * Optional bridge for the present_plan tool: render a development plan to the
   * user and return their accept/modify/reject decision.
   */
  presentPlan?: (plan: PlanProposal) => Promise<PlanDecision>;
  /**
   * Optional bridge for the spawn_agent tool: run a sub-agent (a named profile
   * bound to a provider+model) to completion and return its report. Sequential
   * in Phase 1 — one sub-agent runs start-to-finish per call.
   */
  runSubAgent?: (
    request: SpawnAgentRequest,
    signal?: AbortSignal,
  ) => Promise<SpawnAgentResult>;
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
  /**
   * Optional provider-facing JSON Schema override.
   *
   * Built-in Lucky tools derive this from `schema`. MCP tools can supply the
   * original server-advertised schema directly, while still using a tolerant
   * local zod schema for runtime parsing.
   */
  parametersSchema?: Record<string, unknown>;
  readonly?: boolean;
  execute(input: z.infer<Schema>, ctx: ToolContext): Promise<ToolResult>;
}

/** Define a tool with full input-type inference on `execute`. */
export function defineTool<Schema extends z.ZodType>(
  tool: Tool<Schema>,
): Tool<Schema> {
  return tool;
}
