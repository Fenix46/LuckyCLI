import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectProjectFacts, renderProjectFacts } from "./project-facts.js";
import { buildSystemPromptFromContext } from "./prompts/index.js";

function dir(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "lucky-facts-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content);
  return root;
}

describe("detectProjectFacts", () => {
  it("reads package scripts in a stable order with the right package manager", () => {
    const root = dir({
      "package.json": JSON.stringify({
        workspaces: ["packages/*"],
        scripts: { build: "tsc", test: "vitest run", lint: "eslint .", typecheck: "tsc --noEmit", other: "x" },
      }),
      "pnpm-lock.yaml": "",
    });
    const facts = detectProjectFacts(root);
    expect(facts.toolchain).toBe("pnpm");
    expect(facts.workspaces).toEqual(["packages/*"]);
    expect(facts.commands).toEqual([
      { name: "typecheck", command: "pnpm run typecheck" },
      { name: "test", command: "pnpm run test" },
      { name: "build", command: "pnpm run build" },
      { name: "lint", command: "pnpm run lint" },
    ]);
  });

  it("uses `npm test` for npm and falls back to other ecosystems and make", () => {
    expect(detectProjectFacts(dir({ "package.json": '{"scripts":{"test":"x"}}' })).commands).toEqual([
      { name: "test", command: "npm test" },
    ]);
    expect(detectProjectFacts(dir({ "Cargo.toml": "" })).toolchain).toBe("cargo");
    expect(detectProjectFacts(dir({ "go.mod": "" })).commands[0]).toEqual({ name: "test", command: "go test ./..." });
    expect(detectProjectFacts(dir({ "pyproject.toml": "", "uv.lock": "" })).commands).toEqual([
      { name: "test", command: "uv run pytest" },
    ]);
    const make = detectProjectFacts(dir({ Makefile: "build:\n\tcc\ntest: build\n\t./t\n" }));
    expect(make.toolchain).toBe("make");
    expect(make.commands.map((c) => c.command)).toEqual(["make test", "make build"]);
  });

  it("reports the git branch and pending changes", () => {
    const root = dir({ "a.txt": "a" });
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
    git("init", "-q", "-b", "main");
    git("-c", "user.email=t@t", "-c", "user.name=t", "add", ".");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init");
    writeFileSync(join(root, "b.txt"), "b");
    expect(detectProjectFacts(root).git).toEqual({ branch: "main", changes: 1 });
  });

  it("detects nothing in an empty non-repo folder", () => {
    const facts = detectProjectFacts(dir({}));
    expect(facts.commands).toEqual([]);
    expect(renderProjectFacts({ commands: [] })).toBeNull();
  });
});

describe("project prompt section", () => {
  it("renders the facts into the system prompt", () => {
    const prompt = buildSystemPromptFromContext({
      environment: { cwd: "/repo", os: "linux", date: "2026-01-01" },
      project: {
        toolchain: "npm",
        commands: [{ name: "test", command: "npm test" }],
        git: { branch: "main", changes: 0 },
      },
      env: {},
    });
    expect(prompt).toContain("# Project");
    expect(prompt).toContain("- Toolchain: npm");
    expect(prompt).toContain("test `npm test`");
    expect(prompt).toContain("- Git: branch main, clean (at session start)");
  });

  it("is omitted without detected facts", () => {
    const prompt = buildSystemPromptFromContext({ environment: { cwd: "/repo", os: "linux", date: "2026-01-01" }, env: {} });
    expect(prompt).not.toContain("# Project");
  });
});
