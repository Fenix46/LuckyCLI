import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { collectReviewDiff } from "./review-diff.js";
import { createSnapshot } from "./snapshot.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", ["-C", cwd, ...args]);
}

async function repo(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "lucky-review-"));
  await git(cwd, "init", "-q");
  await git(cwd, "config", "user.email", "test@example.com");
  await git(cwd, "config", "user.name", "Test");
  await writeFile(join(cwd, "app.ts"), "const value = 1;\n");
  await git(cwd, "add", "app.ts");
  await git(cwd, "commit", "-qm", "initial");
  return cwd;
}

describe("collectReviewDiff", () => {
  it("collects staged and unstaged diffs with visible source", async () => {
    const cwd = await repo();
    try {
      await writeFile(join(cwd, "app.ts"), "const value = 2;\n");
      const unstaged = await collectReviewDiff({ cwd, source: "unstaged" });
      expect(unstaged.source).toBe("unstaged");
      expect(unstaged.files[0]).toMatchObject({ path: "app.ts", status: "modified" });
      await git(cwd, "add", "app.ts");
      const staged = await collectReviewDiff({ cwd, source: "staged" });
      expect(staged.source).toBe("staged");
      expect(staged.files[0]?.patch).toContain("const value = 2;");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("redacts secrets without changing the file on disk", async () => {
    const cwd = await repo();
    try {
      const content = "const token = \"super-secret-token-123\";\n";
      await writeFile(join(cwd, "app.ts"), content);
      const result = await collectReviewDiff({ cwd, source: "unstaged" });
      expect(result.files[0]?.patch).toContain("[REDACTED]");
      await expect(readFile(join(cwd, "app.ts"), "utf8")).resolves.toBe(content);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("includes untracked files and reports renames", async () => {
    const cwd = await repo();
    try {
      await writeFile(join(cwd, "new.ts"), "export const fresh = true;\n");
      const added = await collectReviewDiff({ cwd, source: "unstaged" });
      expect(added.files).toContainEqual(expect.objectContaining({ path: "new.ts", status: "added" }));
      await git(cwd, "mv", "app.ts", "renamed.ts");
      const renamed = await collectReviewDiff({ cwd, source: "staged" });
      expect(renamed.files).toContainEqual(expect.objectContaining({ path: "renamed.ts", status: "renamed" }));
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("renders a real bounded checkpoint patch and detects binary content", async () => {
    const cwd = await repo();
    try {
      const checkpoint = await createSnapshot(cwd, ["app.ts"], { id: "checkpoint-review", sessionId: "session", title: "Before" });
      await writeFile(join(cwd, "app.ts"), "const value = 2;\n");
      const result = await collectReviewDiff({ cwd, source: { checkpointId: checkpoint.id } });
      expect(result.files[0]?.patch).toContain("-const value = 1;");
      expect(result.files[0]?.patch).toContain("+const value = 2;");
      expect(result.files[0]?.binary).toBe(false);
      await writeFile(join(cwd, "app.ts"), Buffer.from([0, 1, 2]));
      const binary = await collectReviewDiff({ cwd, source: { checkpointId: checkpoint.id } });
      expect(binary.files[0]).toMatchObject({ binary: true, summary: "binary file changed" });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("summarizes binary files and bounds large diffs", async () => {
    const cwd = await repo();
    try {
      await writeFile(join(cwd, "image.bin"), Buffer.from([0, 1, 2, 3]));
      await writeFile(join(cwd, "app.ts"), "x\n".repeat(30));
      await git(cwd, "add", "image.bin", "app.ts");
      const result = await collectReviewDiff({ cwd, source: "staged", maxChars: 20 });
      const binaryResult = await collectReviewDiff({ cwd, source: "staged", maxChars: 1_000 });
      expect(result.truncated).toBe(true);
      expect(binaryResult.files.some((file) => file.binary && file.summary === "binary file changed")).toBe(true);
      expect(result.files.filter((file) => file.patch).every((file) => (file.patch?.length ?? 0) <= 20)).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("rejects a directory outside the working directory and handles no git", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "lucky-review-no-git-"));
    try {
      await expect(collectReviewDiff({ cwd, source: "head" })).rejects.toThrow("unable to collect git diff");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
