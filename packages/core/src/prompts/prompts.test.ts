import { describe, expect, it } from "vitest";
import {
  buildSummarizationPrompt,
  buildSystemPrompt,
  buildSystemPromptFromContext,
  defineSection,
  resolveSections,
  SYSTEM_PROMPT_SECTIONS,
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

  it("tells the model about the knowledge graph and its tools", () => {
    const prompt = buildSystemPrompt(INFO, ENV);
    expect(prompt).toContain("graph_query");
    expect(prompt).toContain("graph_overview");
    expect(prompt).toContain(".lucky/graph");
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

describe("section architecture", () => {
  it("exposes the ordered default sections", () => {
    expect(SYSTEM_PROMPT_SECTIONS.map((s) => s.name)).toEqual([
      "identity",
      "agency",
      "tool-use",
      "environment",
    ]);
  });

  it("drops sections that compute to null", () => {
    const ctx = { environment: INFO, env: ENV };
    const text = resolveSections(
      [
        defineSection({ name: "a", compute: () => "ALPHA" }),
        defineSection({ name: "b", compute: () => null }),
        defineSection({ name: "c", compute: () => "GAMMA" }),
      ],
      ctx,
    );
    expect(text).toBe("ALPHA\n\nGAMMA");
  });

  it("passes capability flags to sections via the context", () => {
    const ctx = {
      environment: INFO,
      env: ENV,
      hasGraph: true,
      hasSubAgents: false,
      enabledTools: new Set(["read_file"]),
    };
    const text = resolveSections(
      [
        defineSection({
          name: "graph",
          compute: (c) => (c.hasGraph ? "HAS GRAPH" : null),
        }),
        defineSection({
          name: "delegation",
          compute: (c) => (c.hasSubAgents ? "HAS SUBAGENTS" : null),
        }),
      ],
      ctx,
    );
    expect(text).toContain("HAS GRAPH");
    expect(text).not.toContain("HAS SUBAGENTS");
  });

  it("buildSystemPromptFromContext composes the same default prompt", () => {
    const fromCtx = buildSystemPromptFromContext({ environment: INFO, env: ENV });
    const fromCompat = buildSystemPrompt(INFO, ENV);
    expect(fromCtx).toBe(fromCompat);
  });

  it("an empty env override is ignored, a non-empty one wins", () => {
    const overridden = resolveSections(
      [defineSection({ name: "x", envVar: "FOO", compute: () => "DEFAULT" })],
      { environment: INFO, env: { FOO: "CUSTOM" } },
    );
    expect(overridden).toBe("CUSTOM");
    const blank = resolveSections(
      [defineSection({ name: "x", envVar: "FOO", compute: () => "DEFAULT" })],
      { environment: INFO, env: { FOO: "   " } },
    );
    expect(blank).toBe("DEFAULT");
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
