import { describe, expect, it, vi } from "vitest";
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
import type { HookEvent, HookResult, HookRunner } from "./types.js";
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

class ScriptedProvider implements IProvider {
  readonly info = INFO;
  private turn = 0;
  constructor(private readonly script: StreamChunk[][]) {}
  async *generateStream(_messages: Message[], _config: GenerationConfig): AsyncGenerator<StreamChunk> {
    const batch = this.script[this.turn++] ?? [{ finishReason: "stop" }];
    for (const chunk of batch) yield chunk;
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

function fakeHooks(
  handlers: Partial<Record<HookEvent, (payload: { toolName?: string }) => HookResult | Promise<HookResult>>>,
): HookRunner & { calls: HookEvent[] } {
  const calls: HookEvent[] = [];
  return {
    calls,
    has: (event) => event in handlers,
    async run(event, payload) {
      calls.push(event);
      const handler = handlers[event];
      return handler ? await handler(payload) : { blocked: false, warnings: [] };
    },
  };
}

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

const toolCallBatch = (id = "t1"): StreamChunk[] => [
  { toolCall: { type: "tool_call", id, name: "echo", arguments: { value: "x" } } },
  { finishReason: "tool_calls" },
];

describe("agent hooks", () => {
  function registry(execute = vi.fn(async () => ({ content: "echo: x" }))) {
    const echo = defineTool({
      name: "echo",
      description: "echo",
      schema: z.object({ value: z.string() }),
      readonly: true,
      execute,
    });
    return { tools: new ToolRegistry().register(echo), execute };
  }

  it("blocks a tool call in PreToolUse without executing it", async () => {
    const { tools, execute } = registry();
    const hooks = fakeHooks({
      PreToolUse: () => ({ blocked: true, reason: "no echo", warnings: [] }),
    });
    const agent = new Agent({
      provider: new ScriptedProvider([toolCallBatch(), [{ textDelta: "done" }, { finishReason: "stop" }]]),
      model: "mock",
      tools,
      hooks,
    });
    const events = await collect(agent.send("go"));
    expect(execute).not.toHaveBeenCalled();
    const toolResult = agent.messages.at(-2)?.content[0];
    expect(toolResult).toMatchObject({ type: "tool_result", isError: true });
    expect((toolResult as { content: string }).content).toContain("no echo");
    expect(events.at(-1)?.type).toBe("turn_end");
  });

  it("rewrites tool input before execution", async () => {
    const { tools, execute } = registry();
    const hooks = fakeHooks({
      PreToolUse: () => ({ blocked: false, updatedInput: { value: "rewritten" }, warnings: [] }),
    });
    const agent = new Agent({
      provider: new ScriptedProvider([toolCallBatch(), [{ textDelta: "done" }, { finishReason: "stop" }]]),
      model: "mock",
      tools,
      hooks,
    });
    await collect(agent.send("go"));
    expect(execute).toHaveBeenCalledWith({ value: "rewritten" }, expect.anything());
  });

  it("adds PostToolUse context to the result the model sees", async () => {
    const { tools } = registry();
    const hooks = fakeHooks({
      PostToolUse: () => ({ blocked: false, additionalContext: "lint passed", warnings: [] }),
    });
    const agent = new Agent({
      provider: new ScriptedProvider([toolCallBatch(), [{ textDelta: "done" }, { finishReason: "stop" }]]),
      model: "mock",
      tools,
      hooks,
    });
    await collect(agent.send("go"));
    const result = agent.messages.at(-2)?.content[0] as { content: string };
    expect(result.content).toContain("echo: x");
    expect(result.content).toContain("<hook-context>\nlint passed\n</hook-context>");
  });

  it("uses PostToolUseFailure when the tool errors", async () => {
    const { tools } = registry(vi.fn(async () => ({ content: "boom", isError: true })));
    const hooks = fakeHooks({
      PostToolUseFailure: () => ({ blocked: false, additionalContext: "known failure", warnings: [] }),
    });
    const agent = new Agent({
      provider: new ScriptedProvider([toolCallBatch(), [{ textDelta: "done" }, { finishReason: "stop" }]]),
      model: "mock",
      tools,
      hooks,
    });
    await collect(agent.send("go"));
    expect(hooks.calls).toContain("PostToolUseFailure");
    const result = agent.messages.at(-2)?.content[0] as { content: string };
    expect(result.content).toContain("known failure");
  });

  it("stops a turn blocked by UserPromptSubmit before touching the transcript", async () => {
    const { tools } = registry();
    const hooks = fakeHooks({
      UserPromptSubmit: () => ({ blocked: true, reason: "not now", warnings: [] }),
    });
    const agent = new Agent({
      provider: new ScriptedProvider([[{ textDelta: "should not run" }]]),
      model: "mock",
      tools,
      hooks,
    });
    const events = await collect(agent.send("hello"));
    expect(events.at(-1)).toMatchObject({ type: "error" });
    expect(agent.messages).toHaveLength(0);
  });

  it("lets a Stop hook ask for another step, at most three times", async () => {
    const { tools } = registry();
    let stops = 0;
    const hooks = fakeHooks({
      Stop: () => {
        stops += 1;
        return stops <= 1
          ? { blocked: true, reason: "tests still fail", warnings: [] }
          : { blocked: false, warnings: [] };
      },
    });
    const provider = new ScriptedProvider([
      [{ textDelta: "first" }, { finishReason: "stop" }],
      [{ textDelta: "second" }, { finishReason: "stop" }],
    ]);
    const agent = new Agent({ provider, model: "mock", tools, hooks });
    const events = await collect(agent.send("go"));
    expect(stops).toBe(2);
    expect(events.at(-1)?.type).toBe("turn_end");
    expect(agent.messages.some((message) => message.content.some(
      (part) => part.type === "text" && part.text.includes("tests still fail"),
    ))).toBe(true);
  });
});
