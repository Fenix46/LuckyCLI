import { access, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { type VerificationCheck, type VerificationResult } from "./types.js";

export const VERIFICATION_SOURCES = ["script", "convention"] as const;
export type VerificationSource = (typeof VERIFICATION_SOURCES)[number];

export interface VerificationCommand {
  id: string;
  label: string;
  argv: string[];
  cwd: string;
  source: VerificationSource;
}

export interface VerificationRunnerOptions {
  timeoutMs?: number;
  maxOutputChars?: number;
  signal?: AbortSignal;
  onEvent?: (event: VerificationEvent) => void;
}

export type VerificationEvent =
  | { type: "start"; check: Pick<VerificationCheck, "id" | "command" | "cwd"> }
  | { type: "output"; stream: "stdout" | "stderr"; text: string }
  | { type: "finish"; check: VerificationCheck };

export const DEFAULT_VERIFICATION_TIMEOUT_MS = 5 * 60 * 1000;
export const DEFAULT_VERIFICATION_OUTPUT_CHARS = 64 * 1024;

export interface RunVerificationOptions extends VerificationRunnerOptions {
  sessionId?: string;
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

/** Run one resolved check with bounded output and cancellable process lifetime. */
export async function runVerificationCommand(
  command: VerificationCommand,
  options: VerificationRunnerOptions = {},
): Promise<VerificationCheck> {
  const executable = command.argv[0];
  if (!executable) throw new Error(`Verification command "${command.id}" has no executable.`);
  const startedAt = Date.now();
  const checkBase = { id: command.id, command: command.argv.join(" "), cwd: command.cwd };
  options.onEvent?.({ type: "start", check: checkBase });
  const maxOutputChars = options.maxOutputChars ?? DEFAULT_VERIFICATION_OUTPUT_CHARS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS;
  if (options.signal?.aborted) {
    const check = makeResult(checkBase, "cancelled", "cancelled", null, startedAt, "");
    options.onEvent?.({ type: "finish", check });
    return check;
  }

  const child = spawn(executable, command.argv.slice(1), {
    cwd: command.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  let cancelled = false;
  let timedOut = false;
  const append = (stream: "stdout" | "stderr", chunk: Buffer): void => {
    const text = chunk.toString("utf8");
    const remaining = Math.max(0, maxOutputChars - output.length);
    const visible = text.slice(0, remaining);
    output += visible;
    options.onEvent?.({ type: "output", stream, text: visible });
  };
  child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
  child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));

  const result = await new Promise<VerificationCheck>((resolveResult) => {
    let settled = false;
    const abort = (): void => {
      cancelled = true;
      child.kill();
      finish("cancelled", "cancelled", null);
    };
    const finish = (
      status: VerificationCheck["status"],
      termination: VerificationCheck["termination"],
      exitCode: number | null,
    ): void => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", abort);
      clearTimeout(timer);
      resolveResult(makeResult(checkBase, status, termination, exitCode, startedAt, output, maxOutputChars));
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      finish("failed", "timeout", null);
    }, timeoutMs);
    timer.unref?.();
    options.signal?.addEventListener("abort", abort, { once: true });
    child.once("error", () => finish(cancelled ? "cancelled" : "failed", cancelled ? "cancelled" : "error", null));
    child.once("close", (code) => {
      if (timedOut) return;
      finish(cancelled ? "cancelled" : code === 0 ? "passed" : "failed", cancelled ? "cancelled" : "exit", cancelled ? null : code);
    });
  });
  options.onEvent?.({ type: "finish", check: result });
  return result;
}

/** Resolve and run every trusted project check in declaration order. */
export async function runVerification(
  cwd: string,
  files: string[] = [],
  options: RunVerificationOptions = {},
): Promise<VerificationResult> {
  const startedAt = Date.now();
  const commands = await resolveVerificationCommands(cwd);
  const checks: VerificationCheck[] = [];
  for (const command of commands) {
    checks.push(await runVerificationCommand(command, options));
    if (checks.at(-1)?.status === "cancelled") break;
  }
  const status = checks.length === 0
    ? "pending"
    : checks.some((check) => check.status === "cancelled")
      ? "cancelled"
      : checks.every((check) => check.status === "passed")
        ? "passed"
        : "failed";
  return {
    id: `verification_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    sessionId: options.sessionId ?? "agent",
    cwd,
    status,
    startedAt,
    finishedAt: Date.now(),
    checks,
    files: [...new Set(files)].sort(),
  };
}

function makeResult(
  base: Pick<VerificationCheck, "id" | "command" | "cwd">,
  status: VerificationCheck["status"],
  termination: VerificationCheck["termination"],
  exitCode: number | null,
  startedAt: number,
  output: string,
  maxOutputChars = DEFAULT_VERIFICATION_OUTPUT_CHARS,
): VerificationCheck {
  return {
    ...base,
    status,
    startedAt,
    finishedAt: Date.now(),
    exitCode,
    ...(termination ? { termination } : {}),
    output: output.length >= maxOutputChars
      ? `${output}\n\n[truncated at ${maxOutputChars} characters]`
      : output,
  };
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
