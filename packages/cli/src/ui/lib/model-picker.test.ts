import { describe, expect, it } from "vitest";
import { getModelPickerState, validateModel } from "./model-picker.js";

describe("getModelPickerState", () => {
  it("is closed unless the input is a /model command", () => {
    expect(getModelPickerState("hello", "claude", "claude-sonnet-4-6").open).toBe(false);
  });

  it("uses live slugs for openai-oauth when provided", () => {
    const state = getModelPickerState("/model", "openai-oauth", "gpt-5.5", [
      "gpt-5.5",
      "gpt-5.4-mini",
    ]);
    expect(state.open).toBe(true);
    expect(state.items).toEqual(["gpt-5.5", "gpt-5.4-mini"]);
  });

  it("filters live slugs by query", () => {
    const state = getModelPickerState("/model mini", "openai-oauth", "gpt-5.5", [
      "gpt-5.5",
      "gpt-5.4-mini",
    ]);
    expect(state.items).toEqual(["gpt-5.4-mini"]);
  });

  it("treats --refresh as a control flag, not a search query", () => {
    const state = getModelPickerState("/model --refresh", "openai-oauth", "gpt-5.5", [
      "gpt-5.5",
      "gpt-5.4-mini",
    ]);
    expect(state.query).toBe("");
    expect(state.items).toEqual(["gpt-5.5", "gpt-5.4-mini"]);
  });

  it("falls back to the static catalog for non-openai providers", () => {
    const state = getModelPickerState("/model", "claude", "claude-sonnet-4-6");
    expect(state.open).toBe(true);
    expect(state.items).toContain("claude-sonnet-4-6");
  });
});

describe("validateModel", () => {
  it("accepts a live openai-oauth slug and rejects an unknown one", () => {
    expect(validateModel("openai-oauth", "gpt-5.5", ["gpt-5.5"]).ok).toBe(true);
    const bad = validateModel("openai-oauth", "gpt-9", ["gpt-5.5"]);
    expect(bad.ok).toBe(false);
  });

  it("trusts any openai-oauth model before the live catalog is fetched", () => {
    expect(validateModel("openai-oauth", "gpt-anything").ok).toBe(true);
  });

  it("still validates other providers against the static catalog", () => {
    expect(validateModel("claude", "claude-sonnet-4-6").ok).toBe(true);
    expect(validateModel("claude", "made-up").ok).toBe(false);
  });

  it("validates antigravity models against the live catalog when available", () => {
    expect(
      validateModel("antigravity", "gemini-3.5-flash-low", ["gemini-3.5-flash-low"]).ok,
    ).toBe(true);
    const bad = validateModel("antigravity", "made-up", ["gemini-3.5-flash-low"]);
    expect(bad.ok).toBe(false);
  });
});
