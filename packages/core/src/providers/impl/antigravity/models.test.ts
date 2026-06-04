import { describe, expect, it } from "vitest";
import {
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
});
