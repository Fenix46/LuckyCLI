import { afterEach, describe, expect, it } from "vitest";
import type { IProvider } from "../providers/IProvider.js";
import type {
  GenerationResponse,
  ProviderInfo,
  StreamChunk,
  TokenUsage,
} from "../providers/types.js";
import {
  registerProviderFactory,
  resetProvider,
} from "../providers/registry.js";
import type { AgentProfile } from "./profiles.js";
import { runSubAgent, subAgentToolRegistry } from "./runner.js";
import { defaultToolRegistry } from "../tools/builtin/index.js";

const INFO: ProviderInfo = {
  id: "claude",
  displayName: "Mock",
  availableModels: ["mock"],
  defaultModel: "mock",
  supportsStreaming: true,
  supportsVision: false,
  supportsTools: true,
};

/** A provider that streams one text response and a final usage. */
class ReportingProvider implements IProvider {
  readonly info = INFO;
  async *generateStream(): AsyncGenerator<StreamChunk> {
    yield { textDelta: "did the work" };
    yield {
      finishReason: "stop",
      usage: { inputTokens: 100, outputTokens: 20 },
    };
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

const PROFILE: AgentProfile = {
  name: "tester",
  description: "runs a scripted task",
  provider: "claude",
  model: "mock",
};

const FAKE_CREDS = { type: "claude" as const, apiKey: "test" };

describe("subAgentToolRegistry", () => {
  it("excludes exactly the tools a sub-agent has no channel for", () => {
    const child = subAgentToolRegistry().list().map((t) => t.name);
    const all = defaultToolRegistry().list().map((t) => t.name);

    expect(all).toContain("spawn_agent"); // guards against a silent rename
    expect(child).not.toContain("spawn_agent");
    expect(child).not.toContain("ask_user");
    expect(child).not.toContain("present_plan");
    expect(all.filter((n) => !child.includes(n))).toEqual([
      "present_plan",
      "spawn_agent",
      "ask_user",
    ]);
  });
});

describe("runSubAgent", () => {
  afterEach(() => resetProvider("claude"));

  it("runs the sub-agent and returns its report plus usage", async () => {
    registerProviderFactory("claude", () => new ReportingProvider());
    const usages: TokenUsage[] = [];

    const result = await runSubAgent({
      profile: PROFILE,
      task: "do the work",
      cwd: process.cwd(),
      system: "base prompt",
      resolveCredentials: () => FAKE_CREDS,
      onUsage: (u) => usages.push(u),
    });

    expect(result.report).toBe("did the work");
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(20);
    // onUsage fired at least once with the running total.
    expect(usages.at(-1)?.inputTokens).toBe(100);
  });

  it("does not advertise interactive or delegating tools to the sub-agent", async () => {
    const seen: string[] = [];
    class ToolRecordingProvider extends ReportingProvider {
      override async *generateStream(
        _messages: unknown,
        config: { tools?: { name: string }[] },
      ): AsyncGenerator<StreamChunk> {
        for (const t of config.tools ?? []) seen.push(t.name);
        yield { textDelta: "done" };
        yield { finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 } };
      }
    }
    registerProviderFactory("claude", () => new ToolRecordingProvider());

    await runSubAgent({
      profile: PROFILE,
      task: "do the work",
      cwd: process.cwd(),
      system: "base prompt",
      resolveCredentials: () => FAKE_CREDS,
    });

    expect(seen).not.toContain("spawn_agent");
    expect(seen).not.toContain("ask_user");
    expect(seen).not.toContain("present_plan");
    // The rest of the toolset is still there — this is a filter, not a lockdown.
    expect(seen).toContain("read_file");
    expect(seen).toContain("write_file");
  });

  it("errors when the provider has no credentials", async () => {
    registerProviderFactory("claude", () => new ReportingProvider());
    await expect(
      runSubAgent({
        profile: PROFILE,
        task: "do the work",
        cwd: process.cwd(),
        system: "base prompt",
        resolveCredentials: () => null,
      }),
    ).rejects.toThrow(/not logged into|provider/i);
  });
});
