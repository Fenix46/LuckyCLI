import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendProjectMemory,
  appendProjectMemoryToSystemPrompt,
  ensureProjectMemoryFile,
  projectMemoryPath,
  replaceProjectMemory,
} from "./project-memory.js";

describe("project memory", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lucky-memory-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("creates a project memory file under .lucky", async () => {
    const memory = ensureProjectMemoryFile(root);

    expect(memory.path).toBe(projectMemoryPath(root));
    await expect(readFile(memory.path, "utf8")).resolves.toContain("Lucky project memory");
  });

  it("appends and replaces memory notes", async () => {
    await appendProjectMemory(root, "Use npm test for verification.");
    await replaceProjectMemory(root, "# Lucky project memory\n\n- Prefer small commits.\n");

    await expect(readFile(projectMemoryPath(root), "utf8")).resolves.toBe(
      "# Lucky project memory\n\n- Prefer small commits.\n",
    );
  });

  it("adds non-empty project memory to the system prompt", async () => {
    const path = projectMemoryPath(root);
    await replaceProjectMemory(root, "# Lucky project memory\n\n- Keep UI commits separate.\n");
    const content = await readFile(path, "utf8");

    expect(appendProjectMemoryToSystemPrompt("base", { path, content })).toContain(
      "Keep UI commits separate.",
    );
  });

  it("skips empty template memory in the system prompt", async () => {
    ensureProjectMemoryFile(root);
    const path = projectMemoryPath(root);
    await writeFile(path, "# Lucky project memory\n\n", "utf8");
    const content = await readFile(path, "utf8");

    expect(appendProjectMemoryToSystemPrompt("base", { path, content })).toBe("base");
  });
});
