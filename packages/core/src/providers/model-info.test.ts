import { describe, expect, it } from "vitest";
import { withContextWindow, withDiscoveredContextWindows } from "./model-info.js";
import type { ProviderInfo } from "./types.js";

const INFO: ProviderInfo = {
  id: "vllm",
  displayName: "vLLM",
  availableModels: ["local-model"],
  models: { "local-model": { id: "local-model", source: "local" } },
  defaultModel: "local-model",
  supportsStreaming: true,
  supportsVision: false,
  supportsTools: true,
};

describe("withContextWindow", () => {
  it("stamps the window onto every catalog model", () => {
    const out = withContextWindow(INFO, 32768);
    expect(out.models?.["local-model"]?.contextWindow).toBe(32768);
  });

  it("does not mutate the input", () => {
    withContextWindow(INFO, 4096);
    expect(INFO.models?.["local-model"]?.contextWindow).toBeUndefined();
  });

  it("records a provider-wide default for arbitrary model ids", () => {
    expect(withContextWindow(INFO, 16384).defaultContextWindow).toBe(16384);
  });

  it("is a no-op for undefined / non-positive windows", () => {
    expect(withContextWindow(INFO, undefined)).toBe(INFO);
    expect(withContextWindow(INFO, 0)).toBe(INFO);
  });
});

describe("withDiscoveredContextWindows", () => {
  it("applies per-model windows from a discovery map", () => {
    const out = withDiscoveredContextWindows(INFO, { "local-model": 8192, other: 16384 });
    expect(out.models?.["local-model"]?.contextWindow).toBe(8192);
    expect(out.models?.["other"]?.contextWindow).toBe(16384);
  });

  it("is a no-op for an empty map", () => {
    expect(withDiscoveredContextWindows(INFO, {})).toBe(INFO);
  });
});
