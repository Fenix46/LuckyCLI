import { describe, expect, it } from "vitest";
import { PROVIDER_CATALOG, type ProviderCredentials, type StoredConfig } from "@luckycli/core";
import {
  isSelectableModel,
  modelRoster,
  parseModelId,
  toModelId,
  usableProviders,
} from "./models.js";

const apiKey = (key: string) => ({ kind: "api-key", apiKey: key }) as ProviderCredentials;

/** A stored config with credentials for exactly the given providers. */
function storedWith(providers: Record<string, ProviderCredentials>): StoredConfig {
  return { credentials: providers } as StoredConfig;
}

/** No env credentials, so tests see only what the stored config grants. */
const noEnv: NodeJS.ProcessEnv = {};

describe("model id round-trip", () => {
  it("joins and splits a provider/model pair", () => {
    expect(toModelId("claude", "claude-sonnet-5")).toBe("claude/claude-sonnet-5");
    expect(parseModelId("claude/claude-sonnet-5")).toEqual({
      provider: "claude",
      model: "claude-sonnet-5",
    });
  });

  it("keeps slashes inside the model half", () => {
    // openrouter slugs are themselves `vendor/model`.
    expect(parseModelId("openrouter/anthropic/claude-sonnet-4")).toEqual({
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4",
    });
  });

  it("rejects ids that are not a known provider plus a model", () => {
    expect(parseModelId("claude-sonnet-5")).toBeUndefined();
    expect(parseModelId("nope/some-model")).toBeUndefined();
    expect(parseModelId("claude/")).toBeUndefined();
    expect(parseModelId("/claude-sonnet-5")).toBeUndefined();
    expect(parseModelId("")).toBeUndefined();
  });
});

describe("usableProviders", () => {
  it("lists providers whose credentials resolve and omits the rest", () => {
    const stored = storedWith({ claude: apiKey("sk-a"), openai: apiKey("sk-b") });
    const providers = usableProviders(stored, noEnv).map((p) => p.provider);
    expect(providers).toContain("claude");
    expect(providers).toContain("openai");
    expect(providers).not.toContain("gemini");
    expect(providers).not.toContain("antigravity");
  });

  it("picks up credentials from the environment too", () => {
    const found = usableProviders({} as StoredConfig, { ANTHROPIC_API_KEY: "sk-env" });
    expect(found.map((p) => p.provider)).toContain("claude");
  });

  it("excludes base-URL providers when nothing is configured", () => {
    // Their credentials always "resolve" to a default localhost URL nobody
    // asked for, so they must not appear unprompted. opencode Zen legitimately
    // needs no key (free public tier), so it may still be listed.
    const providers = usableProviders({} as StoredConfig, noEnv).map((p) => p.provider);
    expect(providers).not.toContain("ollama");
    expect(providers).not.toContain("llamacpp");
    expect(providers).not.toContain("vllm");
    expect(providers).not.toContain("openai-compatible");
    expect(providers).not.toContain("claude");
  });

  it("offers a base-URL provider only once it is explicitly configured", () => {
    expect(usableProviders({} as StoredConfig, noEnv).map((p) => p.provider)).not.toContain(
      "ollama",
    );
    // Configured through the environment...
    expect(
      usableProviders({} as StoredConfig, { OLLAMA_BASE_URL: "http://box:11434" }).map(
        (p) => p.provider,
      ),
    ).toContain("ollama");
    // ...or through the stored config.
    const stored = storedWith({ ollama: { type: "ollama", baseUrl: "http://box:11434" } as unknown as ProviderCredentials });
    expect(usableProviders(stored, noEnv).map((p) => p.provider)).toContain("ollama");
  });
});

describe("modelRoster", () => {
  const stored = storedWith({ claude: apiKey("sk-a"), openai: apiKey("sk-b") });

  it("lists every configured provider's catalog, active provider first", () => {
    const roster = modelRoster(stored, { provider: "openai", model: "gpt-5.2" }, noEnv);
    const providers = roster.availableModels.map((m) => m.modelId.split("/")[0]);
    // All the openai entries precede all the claude ones.
    expect(providers.indexOf("claude")).toBeGreaterThan(providers.lastIndexOf("openai"));
    expect(new Set(providers)).toEqual(new Set(["openai", "claude"]));
  });

  it("excludes providers with no resolvable credentials", () => {
    const roster = modelRoster(stored, { provider: "claude", model: "claude-sonnet-5" }, noEnv);
    const providers = new Set(roster.availableModels.map((m) => m.modelId.split("/")[0]));
    expect(providers.has("gemini")).toBe(false);
    expect(providers.has("ollama")).toBe(false);
  });

  it("reports the active pair as currentModelId, first in its provider", () => {
    const roster = modelRoster(stored, { provider: "claude", model: "claude-opus-5" }, noEnv);
    expect(roster.currentModelId).toBe("claude/claude-opus-5");
    expect(roster.availableModels[0]!.modelId).toBe("claude/claude-opus-5");
  });

  it("includes an active model the catalog does not know, exactly once", () => {
    const roster = modelRoster(stored, { provider: "claude", model: "claude-custom-x" }, noEnv);
    const ids = roster.availableModels.map((m) => m.modelId);
    expect(ids[0]).toBe("claude/claude-custom-x");
    expect(ids.filter((id) => id === "claude/claude-custom-x")).toHaveLength(1);
    // The catalog models are still there behind it.
    expect(ids).toContain(`claude/${PROVIDER_CATALOG.claude.defaultModel}`);
  });

  it("never repeats a model id", () => {
    const roster = modelRoster(stored, { provider: "claude", model: "claude-sonnet-5" }, noEnv);
    const ids = roster.availableModels.map((m) => m.modelId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names entries with the provider display name and the model", () => {
    const roster = modelRoster(stored, { provider: "claude", model: "claude-sonnet-5" }, noEnv);
    expect(roster.availableModels[0]!.name).toBe(
      `${PROVIDER_CATALOG.claude.displayName} · claude-sonnet-5`,
    );
  });

  it("has no current selection when the session has no active pair", () => {
    const roster = modelRoster(stored, undefined, noEnv);
    expect(roster.currentModelId).toBeUndefined();
    expect(roster.availableModels.length).toBeGreaterThan(0);
  });
});

describe("isSelectableModel", () => {
  const stored = storedWith({
    claude: apiKey("sk-a"),
    ollama: { type: "ollama", baseUrl: "http://box:11434" } as unknown as ProviderCredentials,
  });

  it("accepts a catalog model of a credentialed provider", () => {
    expect(
      isSelectableModel({ provider: "claude", model: "claude-sonnet-5" }, stored, noEnv),
    ).toBe(true);
  });

  it("rejects a provider with no credentials", () => {
    expect(isSelectableModel({ provider: "openai", model: "gpt-5.2" }, stored, noEnv)).toBe(false);
  });

  it("rejects an unknown model of a credentialed provider", () => {
    expect(isSelectableModel({ provider: "claude", model: "not-a-model" }, stored, noEnv)).toBe(
      false,
    );
  });

  it("accepts any model for a base-URL provider, which serves what it was launched with", () => {
    expect(isSelectableModel({ provider: "ollama", model: "whatever:7b" }, stored, noEnv)).toBe(
      true,
    );
  });

  it("rejects an unconfigured base-URL provider, matching the roster", () => {
    expect(
      isSelectableModel({ provider: "vllm", model: "anything" }, stored, noEnv),
    ).toBe(false);
  });
});
