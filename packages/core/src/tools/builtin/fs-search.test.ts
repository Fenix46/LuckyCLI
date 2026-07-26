import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolRegistry } from "../registry.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { matchGlob, runRipgrep } from "./fs-search.js";

/**
 * ripgrep is an optional runtime dependency (the tools fall back to a JS
 * walker), so cases that assert on rg's own behaviour only run where it exists.
 */
const hasRg = await (async () => {
  const probe = await runRipgrep(["--version"], tmpdir());
  return probe.status !== "unavailable";
})();

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

describe("runRipgrep", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lucky-rg-"));
    await writeFile(join(root, "a.txt"), "hello\n", "utf8");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it.runIf(hasRg)("reports ok with stdout for a successful search", async () => {
    const result = await runRipgrep(["--no-heading", "hello", "."], root);
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.stdout).toContain("hello");
  });

  it.runIf(hasRg)("treats 'no matches' (exit 1) as a successful empty search", async () => {
    const result = await runRipgrep(["--no-heading", "zzzznope", "."], root);
    expect(result).toEqual({ status: "ok", stdout: "" });
  });

  it.runIf(hasRg)("reports failure for a pattern ripgrep's engine rejects", async () => {
    // Lookahead is valid JS regex but unsupported by Rust's regex crate, so rg
    // exits 2. This must not be mistaken for "rg is not installed".
    const result = await runRipgrep(["--no-heading", "(?=hello)", "."], root);
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.message).toMatch(/regex parse error/i);
  });

  it("reports unavailable when the binary is missing", async () => {
    const result = await runRipgrep(["x", "."], root, undefined, "rg-does-not-exist-lucky");
    expect(result).toEqual({ status: "unavailable" });
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

  it.runIf(hasRg)("runs glob through ripgrep without an argument error", async () => {
    // Regression: the ignore globs were once passed bare instead of behind
    // --glob, so ripgrep read them as paths, failed, and glob silently fell
    // back to the JS walker on every call.
    const result = await registry.execute("glob", { pattern: "**/*.ts" }, { cwd: root });
    expect(result.isError).toBeUndefined();
    expect(result.content).not.toMatch(/no such file or directory/i);
    expect(result.content).toContain(join("src", "a.ts"));
  });

  it.runIf(hasRg)("surfaces a ripgrep engine error instead of falling back", async () => {
    // A lookahead parses as a JS RegExp (so the tool's own validation passes)
    // but ripgrep rejects it. Falling back to the JS walker here would return
    // matches from a different regex engine with no indication of the switch.
    const result = await registry.execute("grep", { pattern: "(?=foo)" }, { cwd: root });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/search failed/i);
    expect(result.content).not.toContain("a.ts");
  });

  it("includes surrounding lines when context is requested", async () => {
    // a.ts: line 1 matches "foo"; line 2 ("const bar = 2;") is context.
    const result = await registry.execute(
      "grep",
      { pattern: "foo", include: "*.ts", context: 1 },
      { cwd: root },
    );
    // The match line uses ':' after the line number, context lines use '-'.
    expect(result.content).toContain(join("src", "a.ts") + ":1:");
    expect(result.content).toContain(join("src", "a.ts") + ":2-");
    expect(result.content).toContain("const bar = 2;");
  });

  it("omits context lines by default", async () => {
    const result = await registry.execute(
      "grep",
      { pattern: "foo", include: "*.ts" },
      { cwd: root },
    );
    expect(result.content).toContain(join("src", "a.ts") + ":1:");
    expect(result.content).not.toContain("const bar = 2;");
  });

  it("returns an error on an invalid regex", async () => {
    const result = await registry.execute("grep", { pattern: "(" }, { cwd: root });
    expect(result.isError).toBe(true);
  });

  it("rejects search roots that are symlinks outside cwd", async () => {
    const outside = await mkdtemp(join(tmpdir(), "lucky-search-outside-"));
    try {
      await writeFile(join(outside, "secret.ts"), "const secret = true;\n", "utf8");
      await symlink(outside, join(root, "outside-link"));

      await expect(
        registry.execute("grep", { pattern: "secret", path: "outside-link" }, { cwd: root }),
      ).resolves.toMatchObject({ isError: true });
      await expect(
        registry.execute("glob", { pattern: "*.ts", path: "outside-link" }, { cwd: root }),
      ).resolves.toMatchObject({ isError: true });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("skips files larger than the grep byte limit", async () => {
    await writeFile(join(root, "src", "huge.ts"), `${"x".repeat(1024 * 1024 + 1)}needle`, "utf8");
    const result = await registry.execute("grep", { pattern: "needle" }, { cwd: root });
    expect(result.content).not.toContain("huge.ts");
  });

  it("tools are readonly", () => {
    expect(globTool.readonly).toBe(true);
    expect(grepTool.readonly).toBe(true);
  });
});
