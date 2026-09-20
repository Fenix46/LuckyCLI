import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ToolRegistry } from "../registry.js";
import type { ToolContext } from "../types.js";
import { verifyTool } from "./verify.js";

describe("verify tool", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("runs trusted scripts and reports every check", async () => {
    const root = await mkdtemp(join(tmpdir(), "lucky-verify-tool-"));
    roots.push(root);
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "node -p 1" } }));

    const result = await new ToolRegistry().register(verifyTool).execute("verify", {}, { cwd: root });

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Verification passed");
    expect(result.content).toContain("test: passed");
  });

  it("returns a tool error for a failed check", async () => {
    const root = await mkdtemp(join(tmpdir(), "lucky-verify-tool-"));
    roots.push(root);
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "node -e \\\"process.exit(2)\\\"" } }));

    const result = await verifyTool.execute({}, { cwd: root } satisfies ToolContext);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("test: failed");
  });

  it("does not fail when no trusted checks are configured", async () => {
    const root = await mkdtemp(join(tmpdir(), "lucky-verify-tool-"));
    roots.push(root);

    const result = await verifyTool.execute({}, { cwd: root } satisfies ToolContext);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("No trusted verification checks");
  });
});
