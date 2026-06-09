import type { AgentEvent, ContextStatus, TokenUsage, ToolResultMetadata } from "@luckycli/core";

export interface EventHandlers {
  onText: (delta: string) => void;
  onReasoning: () => void;
  onToolStart: (name: string, rawInput: unknown) => void;
  onToolEnd: (name: string, output: string, error: boolean, metadata?: ToolResultMetadata) => void;
  onError: (message: string) => void;
  onContext: (status: ContextStatus) => void;
  onCompacted: (result: { beforeTokens?: number; afterTokens?: number; removedMessages: number; keptMessages: number }) => void;
  onTurnEnd: (usage?: TokenUsage) => void;
  onAborted: () => void;
}

/** Route an agent event to the matching handler callback. */
export function handleEvent(event: AgentEvent, h: EventHandlers): void {
  switch (event.type) {
    case "text":
      h.onText(event.delta);
      break;
    case "reasoning":
      h.onReasoning();
      break;
    case "tool_start":
      h.onToolStart(event.name, event.input);
      break;
    case "tool_end":
      h.onToolEnd(event.name, event.content, event.isError, event.metadata);
      break;
    case "error":
      h.onError(event.message);
      break;
    case "context":
      h.onContext(event.status);
      break;
    case "context_compacted":
      h.onCompacted(event.result);
      break;
    case "turn_end":
      h.onTurnEnd(event.usage);
      break;
    case "aborted":
      h.onAborted();
      break;
  }
}
