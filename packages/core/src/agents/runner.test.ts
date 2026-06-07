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
import { runSubAgent } from "./runner.js";

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
