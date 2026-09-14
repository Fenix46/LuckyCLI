import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

export const VERIFICATION_SOURCES = ["script", "convention"] as const;
export type VerificationSource = (typeof VERIFICATION_SOURCES)[number];

export interface VerificationCommand {
  id: string;
  label: string;
  argv: string[];
  cwd: string;
  source: VerificationSource;
}

const SCRIPT_ORDER = ["typecheck", "test", "build", "lint"] as const;
const VALID_SCRIPT_NAME = /^[a-zA-Z0-9:_-]+$/;

/** Resolve trusted project checks without executing or inventing commands. */
export async function resolveVerificationCommands(cwd: string): Promise<VerificationCommand[]> {
  const packageJson = await readJson(join(cwd, "package.json"));
  if (packageJson) {
    const scripts = readStringMap(packageJson.scripts);
    const packageManager = await detectPackageManager(cwd, packageJson.packageManager);
    const commands = SCRIPT_ORDER.flatMap((name) => {
      if (!scripts.has(name)) return [];
      return [{
        id: name,
        label: name,
        argv: packageManagerArgs(packageManager, name),
        cwd,
        source: "script" as const,
      }];
    });
    if (commands.length > 0) return commands;
  }

  const conventions: Array<{ marker: string; id: string; label: string; argv: string[] }> = [
    { marker: "go.mod", id: "go-test", label: "go test", argv: ["go", "test", "./..."] },
    { marker: "Cargo.toml", id: "cargo-test", label: "cargo test", argv: ["cargo", "test"] },
    { marker: "pyproject.toml", id: "pytest", label: "pytest", argv: ["pytest"] },
    { marker: "pytest.ini", id: "pytest", label: "pytest", argv: ["pytest"] },
  ];
  for (const convention of conventions) {
    if (await exists(join(cwd, convention.marker))) {
      const { marker: _marker, ...command } = convention;
      return [{ ...command, cwd, source: "convention" }];
    }
  }
  return [];
}

function readStringMap(value: unknown): Map<string, string> {
  if (typeof value !== "object" || value === null) return new Map();
  const result = new Map<string, string>();
  for (const [name, script] of Object.entries(value)) {
    if (VALID_SCRIPT_NAME.test(name) && typeof script === "string" && script.trim()) {
      result.set(name, script);
    }
  }
  return result;
}

async function detectPackageManager(cwd: string, packageManager: unknown): Promise<string> {
  if (typeof packageManager === "string") {
    const name = packageManager.split(/[\s@]/, 1)[0] ?? "";
    if (isPackageManager(name)) return name;
  }
  const markers: Array<[string, string]> = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
  ];
  for (const [marker, name] of markers) {
    if (await exists(join(cwd, marker))) return name;
  }
  return "npm";
}

function packageManagerArgs(manager: string, script: string): string[] {
  if (manager === "yarn") return ["yarn", script];
  if (manager === "pnpm") return ["pnpm", "run", script];
  if (manager === "bun") return ["bun", "run", script];
  return ["npm", "run", script];
}

function isPackageManager(value: string): value is "npm" | "pnpm" | "yarn" | "bun" {
  return value === "npm" || value === "pnpm" || value === "yarn" || value === "bun";
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    return value as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
