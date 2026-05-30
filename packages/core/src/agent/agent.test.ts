import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { IProvider } from "../providers/IProvider.js";
import type {
  GenerationConfig,
  GenerationResponse,
  Message,
  ProviderInfo,
  StreamChunk,
  TokenUsage,
} from "../providers/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { defineTool } from "../tools/types.js";
import { Agent } from "./agent.js";
import type { AgentEvent } from "./types.js";

const INFO: ProviderInfo = {
  id: "claude",
  displayName: "Mock",
  availableModels: ["mock"],
  defaultModel: "mock",
  supportsStreaming: true,
  supportsVision: false,
  supportsTools: true,
};

/**
 * Scripted provider: yields a predetermined list of chunk-batches, one batch
 * per `generateStream` call, so we can drive the agent loop deterministically.
 */
class ScriptedProvider implements IProvider {
  readonly info = INFO;
  private turn = 0;
  constructor(private readonly script: StreamChunk[][]) {}

  async *generateStream(): AsyncGenerator<StreamChunk> {
    const batch = this.script[this.turn++] ?? [{ finishReason: "stop" }];
    for (const chunk of batch) yield chunk;
  }
  async generate(): Promise<GenerationResponse> {
    return { content: [], finishReason: "stop" };
  }
  async countTokens(
    _m: Message[],
    _c: GenerationConfig,
  ): Promise<TokenUsage | undefined> {
    return undefined;
  }
  async healthCheck() {
    return { ok: true };
  }
}

const echo = defineTool({
  name: "echo",
  description: "Echo back.",
  schema: z.object({ value: z.string() }),
  async execute({ value }) {
    return { content: `echoed:${value}` };
  },
});

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe("Agent loop", () => {
  it("streams text and finishes a simple turn", async () => {
    const provider = new ScriptedProvider([
      [
        { textDelta: "Hello" },
        { textDelta: " world" },
        { finishReason: "stop", usage: { inputTokens: 5, outputTokens: 2 } },
      ],
    ]);
    const agent = new Agent({
      provider,
      model: "mock",
      tools: new ToolRegistry(),
    });

    const events = await collect(agent.send("hi"));
    const text = events
      .filter((e) => e.type === "text")
      .map((e) => (e as { delta: string }).delta)
      .join("");
    expect(text).toBe("Hello world");
    expect(events.at(-1)?.type).toBe("turn_end");
  });

  it("executes a requested tool then continues to a final answer", async () => {
    const provider = new ScriptedProvider([
      // turn 1: request the tool
      [
        {
          toolCall: {
            type: "tool_call",
            id: "t1",
            name: "echo",
            arguments: { value: "x" },
          },
        },
        { finishReason: "tool_calls" },
      ],
      // turn 2: answer using the tool result
      [{ textDelta: "done" }, { finishReason: "stop" }],
    ]);
    const agent = new Agent({
      provider,
      model: "mock",
      tools: new ToolRegistry().register(echo),
    });

    const events = await collect(agent.send("use the tool"));
    const types = events.map((e) => e.type);
    expect(types).toContain("tool_start");
    expect(types).toContain("tool_end");

    const toolEnd = events.find((e) => e.type === "tool_end");
    expect((toolEnd as { content: string }).content).toBe("echoed:x");

    // History should contain the tool_result fed back to the model.
    const toolMsg = agent.messages.find((m) => m.role === "tool");
    expect(toolMsg?.content[0]).toMatchObject({
      type: "tool_result",
      toolCallId: "t1",
      name: "echo",
    });
  });
});
