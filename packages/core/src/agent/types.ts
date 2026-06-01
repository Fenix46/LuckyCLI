import type { TokenUsage } from "../providers/types.js";

export interface ContextStatus {
  model: string;
  contextWindow?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  usedTokens?: number;
  usableTokens?: number;
  ratio?: number;
  usedPercentage?: number;
  remainingPercentage?: number;
  currentInputTokens?: number;
  currentOutputTokens?: number;
  currentCacheReadTokens?: number;
  currentCacheWriteTokens?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCacheReadTokens?: number;
  totalCacheWriteTokens?: number;
  source?: string;
  tokenCounter: "provider" | "usage" | "unavailable";
}

export interface CompactionResult {
  beforeTokens?: number;
  afterTokens?: number;
  removedMessages: number;
  keptMessages: number;
  summary: string;
}

/** High-level events emitted by the agent loop for a single user turn. */
export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "context"; status: ContextStatus }
  | { type: "context_compacted"; result: CompactionResult }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | {
      type: "tool_end";
      id: string;
      name: string;
      content: string;
      isError: boolean;
    }
  | { type: "turn_end"; usage?: TokenUsage }
  | { type: "aborted" }
  | { type: "error"; message: string };
