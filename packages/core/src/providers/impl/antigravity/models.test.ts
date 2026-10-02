import { describe, expect, it } from "vitest";
import {
  antigravityEffortLevels,
  antigravityFamilyDefaultId,
  antigravityModelFamilies,
  antigravityModelInfo,
  antigravityModelLabel,
  antigravityVisibleModelIds,
} from "./models.js";

describe("antigravity model helpers", () => {
  it("keeps only the visible models in UI order", () => {
    expect(
      antigravityVisibleModelIds({
        "gemini-pro-agent": {},
        "gemini-3.5-flash-low": {},
        "claude-sonnet-4-6": {},
        "tab_flash_lite_preview": {},
      }),
    ).toEqual([
      "gemini-3.5-flash-low",
      "gemini-pro-agent",
      "claude-sonnet-4-6",
    ]);
  });

  it("maps known ids to their canonical UI labels", () => {
    expect(antigravityModelLabel("gemini-3-flash-agent")).toBe("Gemini 3.5 Flash (High)");
    expect(antigravityModelLabel("gpt-oss-120b-medium")).toBe("GPT-OSS 120B (Medium)");
  });

  it("derives provider model metadata from the live catalog", () => {
    expect(
      antigravityModelInfo("gemini-pro-agent", {
        maxTokens: 1_048_576,
        maxOutputTokens: 65_535,
      }),
    ).toEqual({
      id: "gemini-pro-agent",
      contextWindow: 1_048_576,
      maxOutputTokens: 65_535,
      source: "provider",
    });
  });

  it("offers Gemini models newer than the static list first, newest first", () => {
    const ids = antigravityVisibleModelIds({
      "gemini-3.1-pro-low": {},
      "gemini-3.7-flash-low": { displayName: "Gemini 3.7 Flash (Medium)" },
      "gemini-3.8-flash-high": { displayName: "Gemini 3.8 Flash (High)" },
      "gemini-3.8-flash-low": { displayName: "Gemini 3.8 Flash (Medium)" },
      "gemini-3-flash": { displayName: "Gemini 3 Flash" },
      "gemini-2.5-flash-lite": { displayName: "Gemini 2.5 Flash Lite" },
      "tab_flash_lite_preview": { displayName: "Gemini 9 Flash" },
      "claude-sonnet-4-6": {},
    });
    expect(ids).toEqual([
      "gemini-3.8-flash-high",
      "gemini-3.8-flash-low",
      "gemini-3.7-flash-low",
      "gemini-3.1-pro-low",
      "claude-sonnet-4-6",
    ]);
    // Labels for ids LuckyCLI didn't know come from the backend.
    expect(antigravityModelLabel("gemini-3.8-flash-high")).toBe("Gemini 3.8 Flash (High)");
  });

  it("groups effort variants of a model into one picker row", () => {
    const families = antigravityModelFamilies([
      "gemini-3.5-flash-low",
      "gemini-3-flash-agent",
      "gemini-3.5-flash-extra-low",
      "gemini-3.1-pro-low",
      "gemini-pro-agent",
      "gpt-oss-120b-medium",
    ]);
    expect(families.map((family) => family.label)).toEqual([
      "Gemini 3.5 Flash",
      "Gemini 3.1 Pro",
      "GPT-OSS 120B (Medium)",
    ]);
    const [flash, pro, oss] = families;
    expect(flash!.variants).toEqual({
      medium: "gemini-3.5-flash-low",
      high: "gemini-3-flash-agent",
      low: "gemini-3.5-flash-extra-low",
    });
    expect(antigravityEffortLevels(flash!)).toEqual(["low", "medium", "high"]);
    expect(antigravityFamilyDefaultId(flash!)).toBe("gemini-3.5-flash-low");
    expect(antigravityEffortLevels(pro!)).toEqual(["low", "high"]);
    expect(antigravityEffortLevels(oss!)).toEqual([]);
  });
});
