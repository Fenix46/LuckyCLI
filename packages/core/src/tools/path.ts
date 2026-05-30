import { isAbsolute, relative, resolve } from "node:path";

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
