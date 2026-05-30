import type { IProvider } from "../providers/IProvider.js";
import type {
  ContentPart,
  FinishReason,
  Message,
  ToolCallPart,
  TokenUsage,
} from "../providers/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { AgentEvent } from "./types.js";

export interface AgentConfig {
  provider: IProvider;
  model: string;
  tools: ToolRegistry;
  system?: string;
  cwd?: string;
  temperature?: number;
  maxTokens?: number;
  /** Safety bound on provider round-trips per user turn. */
  maxSteps?: number;
  /** Optional callback to approve side-effecting tools before they run. */
  approveTool?: (name: string, input: unknown) => Promise<boolean> | boolean;
}

/**
 * The agent loop. Owns the conversation history and drives the
 * provider <-> tool cycle:
 *   1. stream the running transcript to the provider
 *   2. assemble the assistant message (text + tool calls)
 *   3. if tools were requested, execute them and append the results
 *   4. repeat until the model stops without requesting a tool
 *
 * Fully provider-agnostic — everything flows through canonical types.
 */
export class Agent {
  private readonly provider: IProvider;
  private readonly model: string;
  private readonly tools: ToolRegistry;
  private readonly system: string | undefined;
  private readonly cwd: string;
  private readonly temperature: number | undefined;
  private readonly maxTokens: number | undefined;
  private readonly maxSteps: number;
  private readonly approveTool: ((name: string, input: unknown) => Promise<boolean> | boolean) | undefined;
  private readonly history: Message[] = [];

  constructor(cfg: AgentConfig) {
    this.provider = cfg.provider;
    this.model = cfg.model;
    this.tools = cfg.tools;
    this.system = cfg.system;
    this.cwd = cfg.cwd ?? process.cwd();
    this.temperature = cfg.temperature;
    this.maxTokens = cfg.maxTokens;
    this.maxSteps = cfg.maxSteps ?? 10;
    this.approveTool = cfg.approveTool;
  }

  /** The conversation so far. Useful for persistence or inspection. */
  get messages(): readonly Message[] {
    return this.history;
  }

  /** Run one user turn to completion, yielding events as work progresses. */
  async *send(
    userInput: string,
    signal?: AbortSignal,
  ): AsyncIterable<AgentEvent> {
    this.history.push({
      role: "user",
      content: [{ type: "text", text: userInput }],
    });

    for (let step = 0; step < this.maxSteps; step++) {
      let finishReason: FinishReason = "stop";
      let usage: TokenUsage | undefined;
      const toolCalls: ToolCallPart[] = [];
      let textBuf = "";

      try {
        for await (const chunk of this.provider.generateStream(
          [...this.history],
          {
            model: this.model,
            ...(this.system ? { systemPrompt: this.system } : {}),
            tools: this.tools.definitions(),
            ...(this.temperature !== undefined
              ? { temperature: this.temperature }
              : {}),
            ...(this.maxTokens ? { maxTokens: this.maxTokens } : {}),
            ...(signal ? { abortSignal: signal } : {}),
          },
        )) {
          if (chunk.textDelta) {
            textBuf += chunk.textDelta;
            yield { type: "text", delta: chunk.textDelta };
          }
          if (chunk.toolCall) toolCalls.push(chunk.toolCall);
          if (chunk.finishReason) finishReason = chunk.finishReason;
          if (chunk.usage) usage = chunk.usage;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        yield { type: "error", message };
        return;
      }

      // Assemble the assistant turn: text first, then any tool calls.
      const assistantBlocks: ContentPart[] = [];
      if (textBuf) assistantBlocks.push({ type: "text", text: textBuf });
      assistantBlocks.push(...toolCalls);
      this.history.push({ role: "assistant", content: assistantBlocks });

      // No tools requested -> the turn is complete.
      if (toolCalls.length === 0 || finishReason !== "tool_calls") {
        yield usage ? { type: "turn_end", usage } : { type: "turn_end" };
        return;
      }

      // Execute every requested tool, feeding results back as one user turn.
      const resultBlocks: ContentPart[] = [];
      for (const call of toolCalls) {
        yield {
          type: "tool_start",
          id: call.id,
          name: call.name,
          input: call.arguments,
        };

        const tool = this.tools.get(call.name);
        const needsApproval = tool ? !tool.readonly : true;

        let approved = true;
        if (needsApproval && this.approveTool) {
          try {
            approved = await this.approveTool(call.name, call.arguments);
          } catch {
            approved = false;
          }
        }

        let result;
        if (!approved) {
          result = {
            content: `Tool '${call.name}' execution was denied by the user.`,
            isError: true,
          };
        } else {
          result = await this.tools.execute(call.name, call.arguments, {
            cwd: this.cwd,
            ...(signal ? { signal } : {}),
          });
        }

        yield {
          type: "tool_end",
          id: call.id,
          name: call.name,
          content: result.content,
          isError: result.isError ?? false,
        };
        resultBlocks.push({
          type: "tool_result",
          toolCallId: call.id,
          name: call.name,
          content: result.content,
          ...(result.isError ? { isError: true } : {}),
        });
      }
      this.history.push({ role: "tool", content: resultBlocks });
    }

    yield {
      type: "error",
      message: `Reached max steps (${this.maxSteps}) without completing.`,
    };
  }
}
