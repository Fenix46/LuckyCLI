import { describe, expect, it } from "vitest";
import type { CodexModel } from "@luckycli/core";
import {
  isModelPickerInput,
  isModelRefreshRequest,
  liveModelsFor,
} from "./useModelCatalogs.js";

const CATALOGS = {
  codex: [{ slug: "gpt-5.1-codex" }, { slug: "gpt-5.1-codex-mini" }] as CodexModel[],
  antigravity: ["gemini-3-pro"],
  ollama: ["llama3.3:70b"],
  zen: ["big-pickle"],
  openRouter: ["anthropic/claude-sonnet-5"],
};

describe("isModelPickerInput", () => {
  it("opens on /model and /model with arguments", () => {
    expect(isModelPickerInput("/model")).toBe(true);
    expect(isModelPickerInput("/model gpt")).toBe(true);
    expect(isModelPickerInput("/model --refresh")).toBe(true);
  });

  it("stays closed for other inputs, including /model prefixed commands", () => {
    expect(isModelPickerInput("")).toBe(false);
    expect(isModelPickerInput("/models")).toBe(false);
    expect(isModelPickerInput("hello /model")).toBe(false);
  });
});

describe("isModelRefreshRequest", () => {
  it("detects /model --refresh (whitespace-tolerant)", () => {
    expect(isModelRefreshRequest("/model --refresh")).toBe(true);
    expect(isModelRefreshRequest("/model   --refresh")).toBe(true);
  });

  it("treats anything else as a search query", () => {
    expect(isModelRefreshRequest("/model")).toBe(false);
    expect(isModelRefreshRequest("/model gpt")).toBe(false);
    expect(isModelRefreshRequest("/model --refresh now")).toBe(false);
  });
});

describe("liveModelsFor", () => {
  it("maps each runtime-catalog provider to its list", () => {
    expect(liveModelsFor("openai-oauth", CATALOGS)).toEqual([
      "gpt-5.1-codex",
      "gpt-5.1-codex-mini",
    ]);
    expect(liveModelsFor("antigravity", CATALOGS)).toEqual(["gemini-3-pro"]);
    expect(liveModelsFor("ollama", CATALOGS)).toEqual(["llama3.3:70b"]);
    expect(liveModelsFor("opencode-zen", CATALOGS)).toEqual(["big-pickle"]);
    expect(liveModelsFor("openrouter", CATALOGS)).toEqual(["anthropic/claude-sonnet-5"]);
  });

  it("returns undefined for static-catalog providers", () => {
    expect(liveModelsFor("claude", CATALOGS)).toBeUndefined();
    expect(liveModelsFor("openai", CATALOGS)).toBeUndefined();
  });
});
