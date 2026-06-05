import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The @luckycli/core package version, read straight from its package.json (the
 * single source of truth) so User-Agent strings and MCP client identifiers
 * never drift from the published version. The path is the same in dev (src/)
 * and build (dist/): both sit one level below the package root, and
 * package.json ships inside the package.
 */
export const CORE_VERSION: string = readCoreVersion();

function readCoreVersion(): string {
  const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
  return pkg.version ?? "0.0.0";
}
