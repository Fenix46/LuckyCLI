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
import { askUserTool } from "../tools/builtin/ask-user.js";
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

class CompactingProvider implements IProvider {
  readonly info: ProviderInfo = {
    ...INFO,
    id: "openai",
    availableModels: ["gpt-4o"],
    defaultModel: "gpt-4o",
  };

  async *generateStream(): AsyncGenerator<StreamChunk> {
    yield { textDelta: "ok" };
    yield { finishReason: "stop" };
  }

  async generate(): Promise<GenerationResponse> {
    return {
      content: [{ type: "text", text: "summary of earlier turns" }],
      finishReason: "stop",
    };
  }

  async countTokens(messages: Message[]): Promise<TokenUsage | undefined> {
    return {
      inputTokens: messages.length > 2 ? 100_000 : 1_000,
      outputTokens: 0,
    };
  }

  async healthCheck() {
    return { ok: true };
  }
}

class RuntimeModelInfoProvider implements IProvider {
  readonly info: ProviderInfo = {
    ...INFO,
    models: {
      mock: {
        id: "mock",
        contextWindow: 100_000,
        maxInputTokens: 80_000,
        maxOutputTokens: 10_000,
        source: "provider",
      },
    },
  };

  async *generateStream(): AsyncGenerator<StreamChunk> {
    yield { finishReason: "stop" };
  }

  async generate(): Promise<GenerationResponse> {
    return { content: [], finishReason: "stop" };
  }

  async countTokens(): Promise<TokenUsage | undefined> {
    return { inputTokens: 10_000, outputTokens: 0 };
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

function toolCallStep(id: string): StreamChunk[] {
  return [
    {
      toolCall: {
        type: "tool_call",
        id,
        name: "echo",
        arguments: { value: id },
      },
    },
    { finishReason: "tool_calls" },
  ];
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

  it("denies a tool when permission policy denies it", async () => {
    const provider = new ScriptedProvider([
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
      [{ textDelta: "done" }, { finishReason: "stop" }],
    ]);
    const agent = new Agent({
      provider,
      model: "mock",
      tools: new ToolRegistry().register(echo),
      permissions: { echo: "deny" },
      approveTool: () => "allow",
    });

    const events = await collect(agent.send("use the tool"));
    const toolEnd = events.find((e) => e.type === "tool_end");
    expect(toolEnd).toMatchObject({
      type: "tool_end",
      isError: true,
      content: "Tool 'echo' execution is denied by policy.",
    });
  });

  it("denies ask-permission tools when no approval bridge exists", async () => {
    const provider = new ScriptedProvider([
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
      [{ textDelta: "done" }, { finishReason: "stop" }],
    ]);
    const agent = new Agent({
      provider,
      model: "mock",
      tools: new ToolRegistry().register(echo),
      permissions: { echo: "ask" },
    });

    const events = await collect(agent.send("use the tool"));
    const toolEnd = events.find((e) => e.type === "tool_end");
    expect(toolEnd).toMatchObject({
      type: "tool_end",
      isError: true,
      content: "Tool 'echo' execution was denied by the user.",
    });
  });

  it("denies a tool when approval rejects it", async () => {
    const provider = new ScriptedProvider([
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
      [{ textDelta: "done" }, { finishReason: "stop" }],
    ]);
    const agent = new Agent({
      provider,
      model: "mock",
      tools: new ToolRegistry().register(echo),
      approveTool: () => "deny",
    });

    const events = await collect(agent.send("use the tool"));
    const toolEnd = events.find((e) => e.type === "tool_end");
    expect(toolEnd).toMatchObject({
      type: "tool_end",
      isError: true,
      content: "Tool 'echo' execution was denied by the user.",
    });
  });

  it("accepts allow-always approval decisions as approved", async () => {
    const provider = new ScriptedProvider([
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
      [{ textDelta: "done" }, { finishReason: "stop" }],
    ]);
    const agent = new Agent({
      provider,
      model: "mock",
      tools: new ToolRegistry().register(echo),
      approveTool: () => "always",
    });

    const events = await collect(agent.send("use the tool"));
    const toolEnd = events.find((e) => e.type === "tool_end");
    expect(toolEnd).toMatchObject({
      type: "tool_end",
      isError: false,
      content: "echoed:x",
    });
  });

  it("allows long tool exploration turns by default", async () => {
    const provider = new ScriptedProvider([
      ...Array.from({ length: 12 }, (_, index) => toolCallStep(`t${index}`)),
      [{ textDelta: "done" }, { finishReason: "stop" }],
    ]);
    const agent = new Agent({
      provider,
      model: "mock",
      tools: new ToolRegistry().register(echo),
    });

    const events = await collect(agent.send("inspect the project"));

    expect(events.at(-1)?.type).toBe("turn_end");
    expect(events.some((event) => event.type === "error")).toBe(false);
  });

  it("emits enriched context status from response usage", async () => {
    const provider = new ScriptedProvider([
      [
        { textDelta: "ok" },
        {
          finishReason: "stop",
          usage: {
            inputTokens: 10_000,
            outputTokens: 500,
            cacheReadTokens: 2_000,
            cacheWriteTokens: 1_000,
          },
        },
      ],
    ]);
    const agent = new Agent({
      provider,
      model: "mock",
      tools: new ToolRegistry(),
    });

    const events = await collect(agent.send("hi"));
    const contexts = events.filter((e) => e.type === "context");
    const latest = contexts.at(-1);
    expect(latest).toMatchObject({
      type: "context",
      status: {
        usedTokens: 13_000,
        currentInputTokens: 10_000,
        currentOutputTokens: 500,
        currentCacheReadTokens: 2_000,
        currentCacheWriteTokens: 1_000,
        totalInputTokens: 10_000,
        totalOutputTokens: 500,
        totalCacheReadTokens: 2_000,
        totalCacheWriteTokens: 1_000,
        // Final-stream usage measures the full transcript, so it is reported as
        // an authoritative "provider" count — this is what lets compaction fire
        // for providers (e.g. Claude OAuth) that cannot pre-count cheaply.
        tokenCounter: "provider",
      },
    });
  });

  it("passes askUser bridge to tools", async () => {
    const provider = new ScriptedProvider([
      [
        {
          toolCall: {
            type: "tool_call",
            id: "q1",
            name: "ask_user",
            arguments: { question: "Pick one", options: ["A", "B"], allowFreeText: false },
          },
        },
        { finishReason: "tool_calls" },
      ],
      [{ textDelta: "done" }, { finishReason: "stop" }],
    ]);
    const agent = new Agent({
      provider,
      model: "mock",
      tools: new ToolRegistry().register(askUserTool),
      askUser: async (request) => {
        expect(request.question).toBe("Pick one");
        return "A";
      },
    });

    const events = await collect(agent.send("ask me"));
    const toolEnd = events.find((e) => e.type === "tool_end");
    expect(toolEnd).toMatchObject({
      type: "tool_end",
      isError: false,
      content: "User answered: A",
    });
  });

  it("treats a mid-stream abort as a clean interruption", async () => {
    class AbortingProvider implements IProvider {
      readonly info = INFO;
      async *generateStream(): AsyncGenerator<StreamChunk> {
        yield { textDelta: "partial answer" };
        const err = new Error("Request was aborted.");
        err.name = "AbortError";
        throw err;
      }
      async generate(): Promise<GenerationResponse> {
        return { content: [], finishReason: "stop" };
      }
      async countTokens(): Promise<TokenUsage | undefined> {
        return undefined;
      }
      async healthCheck() {
        return { ok: true };
      }
    }

    const agent = new Agent({
      provider: new AbortingProvider(),
      model: "mock",
      tools: new ToolRegistry(),
    });

    const events = await collect(agent.send("do something"));
    expect(events.some((e) => e.type === "aborted")).toBe(true);
    expect(events.some((e) => e.type === "error")).toBe(false);

    // History stays consistent: partial assistant text is preserved and the
    // interruption is recorded so the next turn resumes cleanly.
    const last = agent.messages.at(-1);
    expect(last).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "[Request interrupted by user]" }],
    });
    expect(agent.messages.at(-2)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "partial answer" }],
    });
  });

  it("stops before the next step when the signal is already aborted", async () => {
    const provider = new ScriptedProvider([toolCallStep("t1")]);
    const agent = new Agent({
      provider,
      model: "mock",
      tools: new ToolRegistry().register(echo),
    });
    const controller = new AbortController();
    // Abort while the (synchronous, scripted) tool runs by aborting up front;
    // the loop's between-steps guard should fire before a second stream.
    const events: AgentEvent[] = [];
    for await (const e of agent.send("use the tool", controller.signal)) {
      events.push(e);
      if (e.type === "tool_end") controller.abort();
    }
    expect(events.some((e) => e.type === "aborted")).toBe(true);
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  it("compacts old turns before sending when context pressure is high", async () => {
    const agent = new Agent({
      provider: new CompactingProvider(),
      model: "gpt-4o",
      tools: new ToolRegistry(),
      compaction: { thresholdRatio: 0.5, keepRecentTurns: 1 },
    });

    await collect(agent.send("first"));
    const events = await collect(agent.send("second"));

    expect(events.some((event) => event.type === "context_compacted")).toBe(true);
    expect(agent.messages[0]).toMatchObject({
      role: "system",
      content: [{ type: "text", text: expect.stringContaining("summary of earlier turns") }],
    });
    expect(agent.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
    });
  });

  it("manual compaction compresses a short conversation below keepRecentTurns", async () => {
    // Default keepRecentTurns is 6. A two-turn chat would leave the
    // turn-count split at 0, so the old compactHistory bailed with
    // "Nothing to compact yet". Manual /compact forces a split that keeps the
    // final user turn verbatim and summarizes everything before it.
    const agent = new Agent({
      provider: new CompactingProvider(),
      model: "gpt-4o",
      tools: new ToolRegistry(),
    });

    await collect(agent.send("first"));
    await collect(agent.send("second"));
    const before = agent.messages.length;

    const result = await agent.compactNow();

    expect(result.removedMessages).toBeGreaterThan(0);
    expect(result.summary).toContain("summary of earlier turns");
    expect(agent.messages.length).toBeLessThan(before);
    expect(agent.messages[0]).toMatchObject({ role: "system" });
    // The final user turn is kept verbatim, never summarized away.
    expect(agent.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
    });
  });

  it("manual compaction is a no-op when there is nothing older to compress", async () => {
    const agent = new Agent({
      provider: new CompactingProvider(),
      model: "gpt-4o",
      tools: new ToolRegistry(),
    });

    // A single turn: only the latest user turn exists, nothing older to keep
    // behind, so even a forced compaction has nothing to do.
    await collect(agent.send("only"));
    const result = await agent.compactNow();

    expect(result.removedMessages).toBe(0);
    expect(result.summary).toBe("Nothing to compact yet.");
  });

  it("uses provider runtime model metadata for context accounting", async () => {
    const agent = new Agent({
      provider: new RuntimeModelInfoProvider(),
      model: "mock",
      tools: new ToolRegistry(),
    });

    const status = await agent.contextStatus();

    expect(status.contextWindow).toBe(100_000);
    expect(status.maxInputTokens).toBe(80_000);
    expect(status.maxOutputTokens).toBe(10_000);
    expect(status.usableTokens).toBe(80_000);
    expect(status.usedTokens).toBe(10_000);
    expect(status.tokenCounter).toBe("provider");
  });
});
