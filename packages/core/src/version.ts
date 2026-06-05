import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Injected at build time by scripts/build.ts (Bun --define). In the compiled
// single-file binary there is no package.json on disk to read, so the version
// must be baked in. `undefined` in dev/test, where we fall back to the file.
declare const __LUCKY_VERSION__: string | undefined;

/**
 * The @luckycli/core package version. Baked in for the compiled binary; read
 * from package.json otherwise (dev via tsx, tests). Either way it tracks the
 * package.json that is the single source of truth — no hand-synced constant.
 */
export const CORE_VERSION: string = resolveVersion();

function resolveVersion(): string {
  // Compiled binary: the build inlines the literal, so this branch wins and the
  // disk read below is dead-code-eliminated (no $bunfs/package.json lookup).
  if (typeof __LUCKY_VERSION__ === "string") return __LUCKY_VERSION__;
  try {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
