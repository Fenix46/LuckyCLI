import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

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
