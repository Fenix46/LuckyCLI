import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Resolve a tool path under cwd. Tools intentionally accept only relative paths
 * so model-supplied inputs cannot target arbitrary filesystem locations.
 */
export function resolveInsideCwd(cwd: string, inputPath: string): string {
  if (isAbsolute(inputPath)) {
    throw new Error("Absolute paths are not allowed.");
  }

  const root = resolve(cwd);
  const target = resolve(root, inputPath);
  const rel = relative(root, target);

  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return target;
  }

  throw new Error("Path escapes the working directory.");
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Resolve and verify an existing path after symlinks have been followed. */
export async function resolveExistingInsideCwd(
  cwd: string,
  inputPath: string,
): Promise<string> {
  const target = resolveInsideCwd(cwd, inputPath);
  const [realRoot, realTarget] = await Promise.all([
    realpath(resolve(cwd)),
    realpath(target),
  ]);

  if (!isInside(realRoot, realTarget)) {
    throw new Error("Path escapes the working directory.");
  }
  return realTarget;
}

/**
 * Resolve a write target safely. New files are allowed when their real parent is
 * inside cwd; existing symlinks are followed and must also stay inside cwd.
 */
export async function resolveWritableInsideCwd(
  cwd: string,
  inputPath: string,
): Promise<string> {
  const target = resolveInsideCwd(cwd, inputPath);
  const realRoot = await realpath(resolve(cwd));

  try {
    const realTarget = await realpath(target);
    if (!isInside(realRoot, realTarget)) {
      throw new Error("Path escapes the working directory.");
    }
    return realTarget;
  } catch (err) {
    if (err instanceof Error && err.message === "Path escapes the working directory.") {
      throw err;
    }
    const realParent = await realpath(dirname(target));
    if (!isInside(realRoot, realParent)) {
      throw new Error("Path escapes the working directory.");
    }
    return target;
  }
}

/**
 * Walk every existing path segment from `root` down to (but not including)
 * `target`'s final component, following symlinks as we go, and reject as soon
 * as a segment resolves outside `root`. Segments that don't exist yet are
 * skipped (they're what a subsequent `mkdir -p` would create) but everything
 * that *does* already exist — including a symlink planted partway down —
 * must resolve inside the sandbox before any directory is created.
 *
 * Call this before `mkdir(dirname(target), { recursive: true })` in any tool
 * that creates parent directories on the caller's behalf; validating only
 * after the fact (as `resolveWritableInsideCwd` does for the final target)
 * is too late to stop `mkdir` from having already materialized directories
 * through a symlink that points outside the working directory.
 */
export async function assertParentPathInsideCwd(cwd: string, inputPath: string): Promise<void> {
  const target = resolveInsideCwd(cwd, inputPath);
  const root = resolve(cwd);
  const realRoot = await realpath(root);
  const parent = dirname(target);

  // Walk segments relative to the *unresolved* root (matching how `target`
  // itself was built), so this lines up even when cwd is itself reached
  // through a symlink (e.g. macOS's /tmp -> /private/tmp). Escape checks
  // below always compare against realRoot, the fully-resolved boundary.
  const relFromRoot = relative(root, parent);
  const segments = relFromRoot === "" ? [] : relFromRoot.split(sep);

  let current = root;
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    const next = resolve(current, segment);

    let stat;
    try {
      stat = await lstat(next);
    } catch {
      // Doesn't exist yet: nothing to escape through, and everything from
      // here down is what mkdir -p would create fresh inside the sandbox.
      break;
    }

    if (stat.isSymbolicLink()) {
      const real = await realpath(next);
      if (!isInside(realRoot, real)) {
        throw new Error("Path escapes the working directory.");
      }
      current = real;
    } else {
      current = next;
    }
  }
}
