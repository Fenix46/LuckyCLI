import type { TokenUsage } from "../providers/types.js";

/** High-level events emitted by the agent loop for a single user turn. */
export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | {
      type: "tool_end";
      id: string;
      name: string;
      content: string;
      isError: boolean;
    }
  | { type: "turn_end"; usage?: TokenUsage }
  | { type: "error"; message: string };
