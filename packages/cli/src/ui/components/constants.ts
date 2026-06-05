import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Injected at build time by scripts/build.ts (Bun --define). The compiled
// single-file binary has no package.json on disk, so the version is baked in.
// `undefined` in dev/test, where we fall back to reading the file.
declare const __LUCKY_VERSION__: string | undefined;

/** Shown in the opening banner and used by the update check (checkForUpdate
 *  compares this against the latest release). Baked in for the compiled binary;
 *  read from packages/cli/package.json otherwise (dev via tsx, tests). Either
 *  way it tracks the package.json that is the single source of truth, so the
 *  banner and updater can never lag behind the published version. */
export const APP_VERSION: string = resolveVersion();

function resolveVersion(): string {
  // Compiled binary: the build inlines the literal, so the disk read below is
  // dead-code-eliminated (no $bunfs/package.json lookup at runtime).
  if (typeof __LUCKY_VERSION__ === "string") return __LUCKY_VERSION__;
  try {
    const pkgPath = fileURLToPath(new URL("../../../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const MASCOT = [
  "  /\\     /\\     ☘",
  " /  \\___/  \\",
  "(   ●   ●   )",
  " \\    ▾    /",
  "  )       (",
  " [ >_      ]",
  " [ $_      ]",
  "  ‾‾‾‾‾‾‾‾‾",
];
