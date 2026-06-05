import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Shown in the opening banner and used by the update check (checkForUpdate
 *  compares this against the latest release). Read straight from
 *  packages/cli/package.json — the single source of truth — so the banner and
 *  updater can never lag behind the published version. The path is the same in
 *  dev (src/ui/components) and build (dist/ui/components): both sit three
 *  levels below the package root, and package.json ships inside the package. */
export const APP_VERSION: string = readAppVersion();

function readAppVersion(): string {
  const pkgPath = fileURLToPath(new URL("../../../package.json", import.meta.url));
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
  return pkg.version ?? "0.0.0";
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
