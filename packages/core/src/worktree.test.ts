import { execFile } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createWorktree,
  listWorktrees,
  removeWorktree,
  repoRoot,
  sanitizeWorktreeName,
} from "./worktree.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", ["-C", cwd, ...args], { windowsHide: true });
}

describe("worktrees", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lucky-worktree-"));
    await git(root, "init");
    await git(root, "config", "user.email", "lucky@example.invalid");
    await git(root, "config", "user.name", "Lucky Test");
    await writeFile(join(root, "README.md"), "hello\n", "utf8");
    await git(root, "add", "README.md");
    await git(root, "commit", "-m", "initial");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("creates, lists and removes a worktree", async () => {
    expect(await repoRoot(root)).toBe(await repoRoot(join(root, ".")));

    const created = await createWorktree(root, "Feature One");
    expect(created.branch).toBe("lucky/feature-one");
    expect(created.path).toContain(join(".lucky", "worktrees", "feature-one"));
    await expect(stat(join(created.path, "README.md"))).resolves.toBeTruthy();

    const listed = await listWorktrees(root);
    const main = listed.find((entry) => entry.current);
    expect(main?.path).toBe(await repoRoot(root));
    expect(listed.some((entry) => entry.path === created.path && entry.branch === created.branch)).toBe(true);

    await removeWorktree(root, created.path);
    await expect(stat(created.path)).rejects.toThrow();
  });

  it("sanitizes names and rejects useless ones", () => {
    expect(sanitizeWorktreeName("  Feature One! ")).toBe("feature-one");
    expect(sanitizeWorktreeName("fix/thing")).toBe("fix-thing");
    expect(() => sanitizeWorktreeName("!!!")).toThrow(/letters or digits/);
    expect(() => sanitizeWorktreeName("..")).toThrow(/letters or digits/);
  });

  it("rejects a non-repository and a removal outside it", async () => {
    const plain = await mkdtemp(join(tmpdir(), "lucky-plain-"));
    try {
      await expect(createWorktree(plain, "x")).rejects.toThrow(/Not a git repository/);
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
    await expect(removeWorktree(root, "/tmp/not-in-this-repo")).rejects.toThrow(
      /outside this repository/,
    );
  });
});
