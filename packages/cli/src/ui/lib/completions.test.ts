import { describe, expect, it } from "vitest";
import { argumentCompletions, type CompletionContext } from "./completions.js";

const context: CompletionContext = {
  themes: [
    { id: "lucky-dark", name: "Lucky Dark" },
    { id: "lucky-light", name: "Lucky Light" },
  ],
  models: ["claude-sonnet-5", "claude-opus-4-8"],
  providers: ["claude", "openai"],
  skills: ["release-flow", "code-review", "rea"],
  enabledSkills: ["release-flow", "rea"],
  mcpServers: ["rea", "docs"],
};

describe("argumentCompletions", () => {
  it("returns nothing outside a command with known values", () => {
    expect(argumentCompletions("hello", context)).toBeNull();
    expect(argumentCompletions("/theme", context)).toBeNull();
    expect(argumentCompletions("/skill use", context)).toBeNull();
    expect(argumentCompletions("/mcp add ", context)).toBeNull();
    expect(argumentCompletions("/unknown x", context)).toBeNull();
  });

  it("completes themes and knows where the token starts", () => {
    const state = argumentCompletions("/theme lu", context);
    expect(state?.items.map((item) => item.value)).toEqual(["lucky-dark", "lucky-light"]);
    expect(state?.replaceFrom).toBe("/theme ".length);
    expect(state?.items[0]?.description).toBe("Lucky Dark");
  });

  it("completes models, providers and MCP servers", () => {
    expect(argumentCompletions("/model opus", context)?.items.map((item) => item.value)).toEqual([
      "claude-opus-4-8",
    ]);
    expect(argumentCompletions("/provider op", context)?.items.map((item) => item.value)).toEqual([
      "openai",
    ]);
    expect(argumentCompletions("/mcp inspect d", context)?.items.map((item) => item.value)).toEqual([
      "docs",
    ]);
  });

  it("uses enabled skills for use and all skills for enable/disable/remove", () => {
    expect(argumentCompletions("/skill use ", context)?.items.map((item) => item.value)).toEqual([
      "release-flow",
      "rea",
    ]);
    expect(argumentCompletions("/skill disable ", context)?.items.map((item) => item.value)).toEqual([
      "release-flow",
      "code-review",
      "rea",
    ]);
  });

  it("hides once the typed value is the only exact match", () => {
    expect(argumentCompletions("/theme lucky-dark", context)).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(argumentCompletions("/theme nope", context)).toBeNull();
  });
});
