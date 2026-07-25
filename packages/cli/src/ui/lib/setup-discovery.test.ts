import { describe, expect, it, vi } from "vitest";
import {
  selectContextWindowDiscovery,
  selectModelDiscovery,
  toModelDiscoveryOutcome,
  type DiscoveryDeps,
} from "./setup-discovery.js";

function deps(overrides: Partial<DiscoveryDeps> = {}): DiscoveryDeps {
  return {
    fetchOpenRouterModels: vi.fn(async () => []),
    fetchOpencodeZenModels: vi.fn(async () => []),
    fetchOpencodeZenContextWindows: vi.fn(async () => ({})),
    fetchOllamaModels: vi.fn(async () => []),
    fetchOpenAiCompatibleModels: vi.fn(async () => []),
    fetchLlamaCppContextWindow: vi.fn(async () => undefined),
    fetchVllmContextWindow: vi.fn(async () => undefined),
    ...overrides,
  } as DiscoveryDeps;
}

const noSecrets = { secret: "", apiKeySecret: "" };

describe("selectModelDiscovery", () => {
  it("returns null without a provider", () => {
    expect(selectModelDiscovery(null, noSecrets, deps())).toBeNull();
  });

  it("returns null for providers with a static catalog", () => {
    expect(selectModelDiscovery("claude", noSecrets, deps())).toBeNull();
    expect(selectModelDiscovery("gemini", noSecrets, deps())).toBeNull();
    expect(selectModelDiscovery("openai", noSecrets, deps())).toBeNull();
  });

  it("passes the trimmed api key to openrouter", async () => {
    const d = deps();
    const discover = selectModelDiscovery("openrouter", { secret: "  key  ", apiKeySecret: "" }, d);
    await discover?.();
    expect(d.fetchOpenRouterModels).toHaveBeenCalledWith("key");
  });

  it("merges models.dev context windows into the zen model list", async () => {
    const d = deps({
      fetchOpencodeZenModels: vi.fn(async () => [{ id: "a" }, { id: "b" }]),
      fetchOpencodeZenContextWindows: vi.fn(async () => ({ a: 200000 })),
    } as Partial<DiscoveryDeps>);
    const models = await selectModelDiscovery("opencode-zen", noSecrets, d)?.();
    expect(models).toEqual([{ id: "a", contextWindow: 200000 }, { id: "b" }]);
  });

  it("sends undefined instead of an empty zen key so core uses the public one", async () => {
    const d = deps();
    await selectModelDiscovery("opencode-zen", { secret: "   ", apiKeySecret: "" }, d)?.();
    expect(d.fetchOpencodeZenModels).toHaveBeenCalledWith(undefined);
  });

  it("skips discovery for a baseUrl provider that already has a static catalog", () => {
    // Ollama ships a small curated model list, so the setup step offers that
    // instead of hitting /api/tags.
    expect(selectModelDiscovery("ollama", { secret: "http://a", apiKeySecret: "" }, deps())).toBeNull();
  });

  it("queries /v1/models with the trimmed base url and key for local servers", async () => {
    const d = deps();
    await selectModelDiscovery(
      "openai-compatible",
      { secret: " http://b ", apiKeySecret: " k " },
      d,
    )?.();
    expect(d.fetchOpenAiCompatibleModels).toHaveBeenCalledWith("http://b", "k");

    await selectModelDiscovery("vllm", { secret: "http://c", apiKeySecret: "" }, d)?.();
    expect(d.fetchOpenAiCompatibleModels).toHaveBeenLastCalledWith("http://c", undefined);
  });

  it("omits a blank api key for openai-compatible discovery", async () => {
    const d = deps();
    await selectModelDiscovery("openai-compatible", { secret: "http://b", apiKeySecret: "  " }, d)?.();
    expect(d.fetchOpenAiCompatibleModels).toHaveBeenCalledWith("http://b", undefined);
  });
});

describe("selectContextWindowDiscovery", () => {
  it("returns null for providers that expose no probe", () => {
    expect(selectContextWindowDiscovery(null, noSecrets, deps())).toBeNull();
    expect(selectContextWindowDiscovery("ollama", noSecrets, deps())).toBeNull();
    expect(selectContextWindowDiscovery("openai-compatible", noSecrets, deps())).toBeNull();
  });

  it("probes llama.cpp with the base url only", async () => {
    const d = deps();
    await selectContextWindowDiscovery("llamacpp", { secret: " http://a ", apiKeySecret: "k" }, d)?.();
    expect(d.fetchLlamaCppContextWindow).toHaveBeenCalledWith("http://a");
  });

  it("probes vLLM with the base url and optional key", async () => {
    const d = deps();
    await selectContextWindowDiscovery("vllm", { secret: "http://a", apiKeySecret: " k " }, d)?.();
    expect(d.fetchVllmContextWindow).toHaveBeenCalledWith("http://a", "k");

    await selectContextWindowDiscovery("vllm", { secret: "http://a", apiKeySecret: "" }, d)?.();
    expect(d.fetchVllmContextWindow).toHaveBeenLastCalledWith("http://a", undefined);
  });
});

describe("toModelDiscoveryOutcome", () => {
  it("keeps ids in order and drops non-positive context windows", () => {
    expect(
      toModelDiscoveryOutcome([
        { id: "a", contextWindow: 100 },
        { id: "b", contextWindow: 0 },
        { id: "c" },
      ]),
    ).toEqual({ modelIds: ["a", "b", "c"], contextByModel: { a: 100 } });
  });

  it("preselects the model when the server serves exactly one", () => {
    expect(toModelDiscoveryOutcome([{ id: "only" }]).preselectedModel).toBe("only");
    expect(toModelDiscoveryOutcome([{ id: "a" }, { id: "b" }]).preselectedModel).toBeUndefined();
    expect(toModelDiscoveryOutcome([]).preselectedModel).toBeUndefined();
  });
});
