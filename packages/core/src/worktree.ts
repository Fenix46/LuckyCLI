import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 4 * 1024 * 1024;

export const WORKTREE_DIR = ".lucky/worktrees";

export interface WorktreeInfo {
  /** Absolute path of the worktree checkout. */
  path: string;
  /** Branch created for it, when known. */
  branch?: string;
  /** True for the repository's main checkout. */
  current: boolean;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
  });
  return stdout.trim();
}

/** Absolute path of the repository containing `cwd`. */
export async function repoRoot(cwd: string): Promise<string> {
  try {
    return await git(cwd, ["rev-parse", "--show-toplevel"]);
  } catch {
    throw new Error("Not a git repository.");
  }
}

/** Turn a free-form worktree name into a safe branch/path component. */
export function sanitizeWorktreeName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (!slug || slug === "." || slug === "..") {
    throw new Error("Worktree name must contain letters or digits.");
  }
  return slug;
}

/** Directory that holds Lucky's worktrees for a repository. */
export function worktreeRoot(repo: string): string {
  return join(repo, WORKTREE_DIR);
}

/**
 * Create a git worktree under `.lucky/worktrees/<name>` on a new
 * `lucky/<name>` branch at HEAD. The caller switches the session to the
 * returned path; the worktree is independent, so edits there do not touch the
 * original checkout.
 */
export async function createWorktree(cwd: string, name?: string): Promise<WorktreeInfo> {
  const repo = await repoRoot(cwd);
  const slug = sanitizeWorktreeName(name ?? `lucky-${Date.now().toString(36)}`);
  const base = worktreeRoot(repo);
  await mkdir(base, { recursive: true });
  const path = join(base, slug);
  const branch = `lucky/${slug}`;
  try {
    await git(repo, ["worktree", "add", "-b", branch, path, "HEAD"]);
  } catch (error) {
    // A previous run may have left the branch (but not the checkout). Reuse
    // the branch rather than failing the whole command.
    if (await branchExists(repo, branch)) {
      await git(repo, ["worktree", "add", path, branch]);
    } else {
      throw error;
    }
  }
  return { path, branch, current: false };
}

async function branchExists(repo: string, branch: string): Promise<boolean> {
  try {
    await git(repo, ["rev-parse", "--verify", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

/** Remove a worktree created by {@link createWorktree}. */
export async function removeWorktree(cwd: string, path: string, force = false): Promise<void> {
  const repo = await repoRoot(cwd);
  const absolute = resolve(path);
  const relativeToRepo = relative(repo, absolute);
  if (relativeToRepo.startsWith("..") || relativeToRepo === "") {
    throw new Error("Refusing to remove a worktree outside this repository.");
  }
  await git(repo, ["worktree", "remove", ...(force ? ["--force"] : []), absolute]);
}

/** Every worktree of the repository, parsed from `git worktree list`. */
export async function listWorktrees(cwd: string): Promise<WorktreeInfo[]> {
  const repo = await repoRoot(cwd);
  const output = await git(repo, ["worktree", "list", "--porcelain"]);
  const entries: WorktreeInfo[] = [];
  let current: WorktreeInfo | undefined;
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length), current: false };
      entries.push(current);
    } else if (current && line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    } else if (current && line === "detached") {
      delete current.branch;
    }
  }
  return entries.map((entry) => ({
    ...entry,
    current: resolve(entry.path) === resolve(repo),
  }));
}
