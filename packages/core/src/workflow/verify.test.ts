import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveVerificationCommands } from "./verify.js";

describe("verification command resolver", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function fixture(files: Record<string, string>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "lucky-verify-"));
    roots.push(root);
    for (const [path, content] of Object.entries(files)) {
      const target = join(root, path);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, content, "utf8");
    }
    return root;
  }

  it("resolves supported npm scripts in stable order", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        scripts: { build: "tsc", test: "vitest", typecheck: "tsc --build", ignored: "echo" },
      }),
    });

    await expect(resolveVerificationCommands(root)).resolves.toEqual([
      { id: "typecheck", label: "typecheck", argv: ["npm", "run", "typecheck"], cwd: root, source: "script" },
      { id: "test", label: "test", argv: ["npm", "run", "test"], cwd: root, source: "script" },
      { id: "build", label: "build", argv: ["npm", "run", "build"], cwd: root, source: "script" },
    ]);
  });

  it("uses packageManager and lockfile conventions", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({ packageManager: "pnpm@9.0.0", scripts: { test: "vitest" } }),
      "pnpm-lock.yaml": "lockfileVersion: 9",
    });

    const commands = await resolveVerificationCommands(root);
    expect(commands[0]?.argv).toEqual(["pnpm", "run", "test"]);
  });

  it("falls back to supported language conventions", async () => {
    const root = await fixture({ "go.mod": "module example\n" });

    await expect(resolveVerificationCommands(root)).resolves.toEqual([
      { id: "go-test", label: "go test", argv: ["go", "test", "./..."], cwd: root, source: "convention" },
    ]);
  });

  it("supports Python project markers", async () => {
    const root = await fixture({ "pyproject.toml": "[tool.pytest.ini_options]\n" });

    const commands = await resolveVerificationCommands(root);
    expect(commands[0]?.argv).toEqual(["pytest"]);
    expect(commands[0]?.source).toBe("convention");
  });

  it("does not invent a check for an unknown project", async () => {
    const root = await fixture({ "README.md": "hello" });

    await expect(resolveVerificationCommands(root)).resolves.toEqual([]);
  });

  it("ignores invalid package scripts and malformed package json", async () => {
    const invalid = await fixture({
      "package.json": JSON.stringify({ scripts: { "test bad": "vitest", test: "   " } }),
    });
    expect(await resolveVerificationCommands(invalid)).toEqual([]);

    const malformed = await fixture({ "package.json": "not json", "Cargo.toml": "[package]" });
    await expect(resolveVerificationCommands(malformed)).resolves.toEqual([
      { id: "cargo-test", label: "cargo test", argv: ["cargo", "test"], cwd: malformed, source: "convention" },
    ]);
  });
});
