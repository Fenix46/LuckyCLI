import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolRegistry } from "../registry.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { matchGlob } from "./fs-search.js";

describe("matchGlob", () => {
  it("matches a basename pattern anywhere in the tree", () => {
    expect(matchGlob("*.ts", "src/a.ts")).toBe(true);
    expect(matchGlob("*.ts", "a.ts")).toBe(true);
    expect(matchGlob("*.ts", "a.js")).toBe(false);
  });

  it("matches a full-path pattern with ** and *", () => {
    expect(matchGlob("src/**/*.ts", "src/x/y/a.ts")).toBe(true);
    expect(matchGlob("src/**/*.ts", "src/a.ts")).toBe(true);
    expect(matchGlob("src/*.ts", "src/x/a.ts")).toBe(false);
  });

  it("supports brace alternation", () => {
    expect(matchGlob("*.{ts,tsx}", "a.tsx")).toBe(true);
    expect(matchGlob("*.{ts,tsx}", "a.js")).toBe(false);
  });
});

describe("glob and grep tools", () => {
  let root: string;
  let registry: ToolRegistry;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lucky-search-"));
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "node_modules"), { recursive: true });
    await writeFile(join(root, "src", "a.ts"), "export const foo = 1;\nconst bar = 2;\n", "utf8");
    await writeFile(join(root, "src", "b.js"), "const foo = 3;\n", "utf8");
    await writeFile(join(root, "node_modules", "skip.ts"), "const foo = 99;\n", "utf8");
    registry = new ToolRegistry().register(globTool).register(grepTool);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("globs files and ignores vendor dirs", async () => {
    const result = await registry.execute("glob", { pattern: "**/*.ts" }, { cwd: root });
    expect(result.content).toContain(join("src", "a.ts"));
    expect(result.content).not.toContain("skip.ts");
  });

  it("greps file contents", async () => {
    const result = await registry.execute("grep", { pattern: "foo" }, { cwd: root });
    expect(result.content).toContain(join("src", "a.ts") + ":1:");
    expect(result.content).toContain(join("src", "b.js") + ":1:");
    expect(result.content).not.toContain("skip.ts");
  });

  it("restricts grep with an include glob", async () => {
    const result = await registry.execute(
      "grep",
      { pattern: "foo", include: "*.ts" },
      { cwd: root },
    );
    expect(result.content).toContain("a.ts");
    expect(result.content).not.toContain("b.js");
  });

  it("reports no matches cleanly", async () => {
    const result = await registry.execute("grep", { pattern: "zzz" }, { cwd: root });
    expect(result.isError).toBeUndefined();
    expect(result.content).toMatch(/no matches/i);
  });

  it("returns an error on an invalid regex", async () => {
    const result = await registry.execute("grep", { pattern: "(" }, { cwd: root });
    expect(result.isError).toBe(true);
  });

  it("tools are readonly", () => {
    expect(globTool.readonly).toBe(true);
    expect(grepTool.readonly).toBe(true);
  });
});
