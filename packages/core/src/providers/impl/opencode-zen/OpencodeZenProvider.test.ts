import OpenAI from "openai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OPENCODE_ZEN_BASE_URL,
  OPENCODE_ZEN_PUBLIC_KEY,
  OpencodeZenProvider,
} from "./OpencodeZenProvider.js";

vi.mock("openai", () => {
  const OpenAI = vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn() } },
    models: { list: vi.fn() },
  }));
  return { default: OpenAI };
});

describe("OpencodeZenProvider", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the supplied API key against the zen endpoint", () => {
    const provider = new OpencodeZenProvider({
      type: "opencode-zen",
      apiKey: "zen-key",
    });

    expect(OpenAI).toHaveBeenCalledWith({
      apiKey: "zen-key",
      baseURL: OPENCODE_ZEN_BASE_URL,
      defaultHeaders: { "X-Title": "lucky" },
    });
    expect(provider.info.id).toBe("opencode-zen");
  });

  it("falls back to the public key when none is supplied", () => {
    new OpencodeZenProvider({ type: "opencode-zen" });

    expect(OpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: OPENCODE_ZEN_PUBLIC_KEY }),
    );
  });
});
