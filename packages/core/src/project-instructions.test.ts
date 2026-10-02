import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendProjectInstructionsToSystemPrompt, loadProjectInstructions } from "./project-instructions.js";

describe("project instructions", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "lucky-instructions-"));
    await mkdir(join(repo, ".git"));
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("loads AGENTS.md and CLAUDE.md from the repo root down to cwd, once each", async () => {
    await writeFile(join(repo, "AGENTS.md"), "# Root rules\nUse npm.", "utf8");
    await writeFile(join(repo, "CLAUDE.md"), "# Root rules\nUse npm.", "utf8");
    await mkdir(join(repo, "packages", "core"), { recursive: true });
    await writeFile(join(repo, "packages", "core", "AGENTS.md"), "Core stays provider-agnostic.", "utf8");

    const files = loadProjectInstructions(join(repo, "packages", "core"));
    expect(files.map((f) => f.path)).toEqual([join("..", "..", "AGENTS.md"), "AGENTS.md"]);

    const prompt = appendProjectInstructionsToSystemPrompt("BASE", files);
    expect(prompt.startsWith("BASE\n\n# Project instructions")).toBe(true);
    expect(prompt).toContain("Use npm.");
    expect(prompt).toContain("Core stays provider-agnostic.");
  });

  it("leaves the prompt untouched when the project has none", () => {
    expect(loadProjectInstructions(repo)).toEqual([]);
    expect(appendProjectInstructionsToSystemPrompt("BASE", [])).toBe("BASE");
  });
});
