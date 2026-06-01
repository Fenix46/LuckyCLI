import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolRegistry } from "../registry.js";
import { applyPatchTool } from "./apply-patch.js";
import { execTool } from "./exec.js";
import { getTodosForCwd, todoWriteTool } from "./todo-write.js";

describe("robust built-in tools", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lucky-robust-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("stores and summarizes todos", async () => {
    const registry = new ToolRegistry().register(todoWriteTool);
    const result = await registry.execute(
      "todo_write",
      {
        todos: [
          { id: "1", content: "Audit tools", status: "completed", priority: "high" },
          { id: "2", content: "Add patch tool", status: "in_progress" },
        ],
      },
      { cwd: root },
    );

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("1 completed");
    expect(getTodosForCwd(root)).toHaveLength(2);
  });

  it("applies a unified diff to an existing file", async () => {
    await writeFile(join(root, "a.txt"), "one\ntwo\nthree\n", "utf8");
    const registry = new ToolRegistry().register(applyPatchTool);

    const result = await registry.execute(
      "apply_patch",
      {
        patch: [
          "--- a/a.txt",
          "+++ b/a.txt",
          "@@ -1,3 +1,3 @@",
          " one",
          "-two",
          "+TWO",
          " three",
          "",
        ].join("\n"),
      },
      { cwd: root },
    );

    expect(result.content).toContain("Applied patch");
    expect(result.isError).toBeUndefined();
    await expect(readFile(join(root, "a.txt"), "utf8")).resolves.toBe("one\nTWO\nthree\n");
  });

  it("rejects patch path traversal", async () => {
    const registry = new ToolRegistry().register(applyPatchTool);
    const result = await registry.execute(
      "apply_patch",
      {
        patch: [
          "--- a/../x.txt",
          "+++ b/../x.txt",
          "@@ -1,1 +1,1 @@",
          "-a",
          "+b",
        ].join("\n"),
      },
      { cwd: root },
    );

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/escapes|failed/i);
  });

  it("refuses dangerous exec commands unless explicitly allowed", async () => {
    const registry = new ToolRegistry().register(execTool);
    const result = await registry.execute("exec", { command: "rm -rf dist" }, { cwd: root });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/Refusing.*destructive/i);
  });

  it("runs normal exec commands", async () => {
    const registry = new ToolRegistry().register(execTool);
    const result = await registry.execute("exec", { command: "printf ok" }, { cwd: root });
    expect(result).toEqual({ content: "ok" });
  });
});
