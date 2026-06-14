import OpenAI from "openai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LlamaCppProvider } from "./llamacpp/LlamaCppProvider.js";
import { VllmProvider } from "./vllm/VllmProvider.js";
import {
  OpenAiCompatibleProvider,
  normalizeOpenAiCompatibleBaseUrl,
} from "./openai-compatible/OpenAiCompatibleProvider.js";

vi.mock("openai", () => {
  const OpenAI = vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn() } },
    models: { list: vi.fn() },
  }));
  return { default: OpenAI };
});

const OpenAIMock = OpenAI as unknown as ReturnType<typeof vi.fn>;

function lastClientArgs(): { apiKey: string; baseURL?: string } {
  return OpenAIMock.mock.calls.at(-1)?.[0] as { apiKey: string; baseURL?: string };
}

describe("LlamaCppProvider", () => {
  beforeEach(() => vi.clearAllMocks());

  it("appends /v1 and uses a placeholder key by default", () => {
    new LlamaCppProvider({ type: "llamacpp", baseUrl: "http://localhost:8080" });
    expect(lastClientArgs()).toEqual({
      apiKey: "llamacpp",
      baseURL: "http://localhost:8080/v1",
    });
  });

  it("forwards a user-supplied api key and trims a trailing slash", () => {
    new LlamaCppProvider({
      type: "llamacpp",
      baseUrl: "http://localhost:8080/",
      apiKey: "secret",
    });
    expect(lastClientArgs()).toEqual({
      apiKey: "secret",
      baseURL: "http://localhost:8080/v1",
    });
  });
});

describe("VllmProvider", () => {
  beforeEach(() => vi.clearAllMocks());

  it("appends /v1 and uses a placeholder key by default", () => {
    new VllmProvider({ type: "vllm", baseUrl: "http://localhost:8000" });
    expect(lastClientArgs()).toEqual({
      apiKey: "vllm",
      baseURL: "http://localhost:8000/v1",
    });
  });

  it("forwards a user-supplied api key", () => {
    new VllmProvider({ type: "vllm", baseUrl: "http://localhost:8000", apiKey: "k" });
    expect(lastClientArgs().apiKey).toBe("k");
  });
});

describe("OpenAiCompatibleProvider", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the user's base url and api key verbatim", () => {
    new OpenAiCompatibleProvider({
      type: "openai-compatible",
      baseUrl: "https://my.gateway.example/v1",
      apiKey: "my-key",
    });
    expect(lastClientArgs()).toEqual({
      apiKey: "my-key",
      baseURL: "https://my.gateway.example/v1",
    });
  });
});

describe("normalizeOpenAiCompatibleBaseUrl", () => {
  it("appends /v1 to a bare origin", () => {
    expect(normalizeOpenAiCompatibleBaseUrl("https://api.example.com")).toBe(
      "https://api.example.com/v1",
    );
  });

  it("leaves an explicit path untouched", () => {
    expect(normalizeOpenAiCompatibleBaseUrl("https://api.example.com/v1")).toBe(
      "https://api.example.com/v1",
    );
    expect(normalizeOpenAiCompatibleBaseUrl("https://gw.example.com/openai/v1")).toBe(
      "https://gw.example.com/openai/v1",
    );
  });

  it("strips a trailing slash", () => {
    expect(normalizeOpenAiCompatibleBaseUrl("http://localhost:9000/")).toBe(
      "http://localhost:9000/v1",
    );
  });
});
