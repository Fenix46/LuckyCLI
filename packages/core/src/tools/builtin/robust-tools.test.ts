import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolRegistry } from "../registry.js";
import { applyPatchTool } from "./apply-patch.js";
import { classifyCommandSemantics, execTool } from "./exec.js";
import { classifyPowerShellCommandSemantics, powerShellTool } from "./powershell.js";
import { resetTaskList, setActiveTaskListId } from "../../tasks/store.js";
import { projectMemoryTool } from "./project-memory.js";
import { taskCreateTool, taskListTool } from "./tasks.js";

describe("robust built-in tools", () => {
  let root: string;
  let taskListId: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lucky-robust-"));
    // Task tools resolve the active task list id, not ctx.cwd — give each test
    // a unique list so they don't collide with the shared on-disk default.
    taskListId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setActiveTaskListId(taskListId);
  });

  afterEach(async () => {
    resetTaskList(taskListId);
    await rm(root, { recursive: true, force: true });
  });

  it("creates and lists tasks", async () => {
    const registry = new ToolRegistry()
      .register(taskCreateTool)
      .register(taskListTool);

    const created = await registry.execute(
      "task_create",
      { subject: "Audit tools", description: "Review the built-in tool set." },
      { cwd: root },
    );
    expect(created.isError).toBeUndefined();
    expect(created.content).toContain("Created task #1");

    const listed = await registry.execute("task_list", {}, { cwd: root });
    expect(listed.isError).toBeUndefined();
    expect(listed.content).toContain("1 pending");
    expect(listed.content).toContain("Audit tools");
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

  it("creates a file from a unified diff", async () => {
    const registry = new ToolRegistry().register(applyPatchTool);

    const result = await registry.execute(
      "apply_patch",
      {
        patch: [
          "--- /dev/null",
          "+++ b/nested/new.txt",
          "@@ -0,0 +1,2 @@",
          "+one",
          "+two",
          "",
        ].join("\n"),
      },
      { cwd: root },
    );

    expect(result.isError).toBeUndefined();
    await expect(readFile(join(root, "nested", "new.txt"), "utf8")).resolves.toBe("one\ntwo");
  });

  it("deletes a file from a unified diff", async () => {
    await writeFile(join(root, "delete-me.txt"), "one\ntwo\n", "utf8");
    const registry = new ToolRegistry().register(applyPatchTool);

    const result = await registry.execute(
      "apply_patch",
      {
        patch: [
          "--- a/delete-me.txt",
          "+++ /dev/null",
          "@@ -1,2 +0,0 @@",
          "-one",
          "-two",
          "",
        ].join("\n"),
      },
      { cwd: root },
    );

    expect(result.isError).toBeUndefined();
    await expect(stat(join(root, "delete-me.txt"))).rejects.toThrow();
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

  it("classifies shell command semantics", () => {
    expect(classifyCommandSemantics("git status --short")).toMatchObject({
      category: "read_only",
    });
    expect(classifyCommandSemantics("npm install")).toMatchObject({
      category: "mutating",
    });
    expect(classifyCommandSemantics("find . -name '*.tmp' -delete")).toMatchObject({
      category: "destructive",
      reason: "find -delete",
    });
    expect(classifyCommandSemantics("git push --force")).toMatchObject({
      category: "destructive",
      reason: "force push",
    });
  });

  it("runs normal exec commands", async () => {
    const registry = new ToolRegistry().register(execTool);
    const result = await registry.execute("exec", { command: "printf ok" }, { cwd: root });
    expect(result).toEqual({ content: "ok" });
  });

  it("classifies PowerShell command semantics", () => {
    expect(classifyPowerShellCommandSemantics("Get-ChildItem .")).toMatchObject({
      category: "read_only",
    });
    expect(classifyPowerShellCommandSemantics("Set-Content -Path out.txt -Value ok")).toMatchObject({
      category: "mutating",
    });
    expect(classifyPowerShellCommandSemantics("Remove-Item -Recurse dist")).toMatchObject({
      category: "destructive",
      reason: "remove file/directory",
    });
    expect(classifyPowerShellCommandSemantics("git push --force")).toMatchObject({
      category: "destructive",
      reason: "force push",
    });
  });

  it("refuses dangerous PowerShell commands unless explicitly allowed", async () => {
    const registry = new ToolRegistry().register(powerShellTool);
    const result = await registry.execute(
      "PowerShell",
      { command: "Remove-Item -Recurse dist" },
      { cwd: root },
    );
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/Refusing.*destructive PowerShell/i);
  });

  it("updates persistent project memory", async () => {
    const registry = new ToolRegistry().register(projectMemoryTool);
    const result = await registry.execute(
      "project_memory",
      { operation: "append", content: "Use npm test before commits." },
      { cwd: root },
    );

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain(".lucky/memory.md");
    await expect(readFile(join(root, ".lucky", "memory.md"), "utf8")).resolves.toContain(
      "Use npm test before commits.",
    );
  });
});
