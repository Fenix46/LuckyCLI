import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolRegistry } from "../registry.js";
import { editFileTool } from "./edit-file.js";
import { replace } from "./edit-replace.js";

describe("replace cascade", () => {
  it("replaces an exact match", () => {
    expect(replace("const a = 1;", "a = 1", "a = 2")).toBe("const a = 2;");
  });

  it("matches despite different indentation", () => {
    const content = "function f() {\n      return 1;\n}";
    const out = replace(content, "return 1;", "return 2;");
    expect(out).toBe("function f() {\n      return 2;\n}");
  });

  it("matches a block ignoring per-line whitespace", () => {
    const content = "if (x) {\n    doThing();\n    doOther();\n}";
    const find = "if (x) {\ndoThing();\ndoOther();\n}";
    const out = replace(content, find, "if (x) {\n    done();\n}");
    expect(out).toBe("if (x) {\n    done();\n}");
  });

  it("throws on a missing snippet", () => {
    expect(() => replace("hello world", "goodbye", "hi")).toThrow(/not found/i);
  });

  it("throws on an ambiguous snippet", () => {
    expect(() => replace("x\nx\n", "x", "y")).toThrow(/multiple matches/i);
  });

  it("replaces every occurrence with replaceAll", () => {
    expect(replace("x\nx\n", "x", "y", true)).toBe("y\ny\n");
  });

  it("rejects identical old and new strings", () => {
    expect(() => replace("a", "a", "a")).toThrow(/identical/i);
  });
});

describe("edit_file tool", () => {
  let root: string;
  let registry: ToolRegistry;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lucky-edit-"));
    registry = new ToolRegistry().register(editFileTool);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("edits a file in place", async () => {
    await writeFile(join(root, "f.ts"), "const a = 1;\n", "utf8");

    const result = await registry.execute(
      "edit_file",
      { path: "f.ts", oldString: "a = 1", newString: "a = 2" },
      { cwd: root },
    );

    expect(result.isError).toBeUndefined();
    await expect(readFile(join(root, "f.ts"), "utf8")).resolves.toBe("const a = 2;\n");
  });

  it("returns an error result when the snippet is missing", async () => {
    await writeFile(join(root, "f.ts"), "const a = 1;\n", "utf8");

    const result = await registry.execute(
      "edit_file",
      { path: "f.ts", oldString: "nope", newString: "x" },
      { cwd: root },
    );

    expect(result.isError).toBe(true);
  });

  it("requires approval (not readonly)", () => {
    expect(editFileTool.readonly).toBeUndefined();
  });

  it("rejects absolute paths", async () => {
    const result = await registry.execute(
      "edit_file",
      { path: join(root, "f.ts"), oldString: "a", newString: "b" },
      { cwd: root },
    );
    expect(result.isError).toBe(true);
  });
});
