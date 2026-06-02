import { describe, expect, it } from "vitest";
import {
  buildSummarizationPrompt,
  buildSystemPrompt,
  IDENTITY_PROMPT,
  SUMMARIZATION_PROMPT,
  TOOL_USE_PROMPT,
} from "./index.js";

const ENV: NodeJS.ProcessEnv = {};
const INFO = { cwd: "/tmp/proj", os: "darwin (arm64)", date: "2026-06-01" };

describe("buildSystemPrompt", () => {
  it("composes the identity, agency, tool-use, and environment sections", () => {
    const prompt = buildSystemPrompt(INFO, ENV);
    expect(prompt).toContain(IDENTITY_PROMPT);
    expect(prompt).toContain(TOOL_USE_PROMPT);
    expect(prompt).toContain("# How you work");
    expect(prompt).toContain("PowerShell");
    expect(prompt).toContain("project_memory");
  });

  it("interpolates the environment block with runtime values", () => {
    const prompt = buildSystemPrompt(INFO, ENV);
    expect(prompt).toContain("Working directory: /tmp/proj");
    expect(prompt).toContain("Platform: darwin (arm64)");
    expect(prompt).toContain("Today's date: 2026-06-01");
    expect(prompt).not.toContain("{cwd}");
  });

  it("lets a per-section env variable override that section only", () => {
    const prompt = buildSystemPrompt(INFO, {
      LUCKY_PROMPT_IDENTITY: "You are a custom bot.",
    });
    expect(prompt).toContain("You are a custom bot.");
    expect(prompt).not.toContain(IDENTITY_PROMPT);
    // Other sections remain intact.
    expect(prompt).toContain(TOOL_USE_PROMPT);
  });

  it("ignores a blank override and keeps the default section", () => {
    const prompt = buildSystemPrompt(INFO, { LUCKY_PROMPT_TOOL_USE: "  " });
    expect(prompt).toContain(TOOL_USE_PROMPT);
  });
});

describe("buildSummarizationPrompt", () => {
  it("returns the default summarization instruction", () => {
    expect(buildSummarizationPrompt(ENV)).toBe(SUMMARIZATION_PROMPT);
  });

  it("can be overridden via env", () => {
    expect(buildSummarizationPrompt({ LUCKY_PROMPT_SUMMARIZATION: "Sum it up." })).toBe(
      "Sum it up.",
    );
  });
});
