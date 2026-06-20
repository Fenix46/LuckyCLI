import OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import {
  OPENROUTER_BASE_URL,
  OpenRouterProvider,
} from "./OpenRouterProvider.js";

vi.mock("openai", () => {
  const OpenAI = vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn() } },
    models: { list: vi.fn() },
  }));
  return { default: OpenAI };
});

describe("OpenRouterProvider", () => {
  it("targets the OpenRouter endpoint with attribution headers", () => {
    const provider = new OpenRouterProvider({
      type: "openrouter",
      apiKey: "sk-or-test",
    });

    expect(OpenAI).toHaveBeenCalledWith({
      apiKey: "sk-or-test",
      baseURL: OPENROUTER_BASE_URL,
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/luckycli",
        "X-Title": "lucky",
      },
    });
    expect(provider.info.id).toBe("openrouter");
  });
});
