import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { defineTool } from "../types.js";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 256 * 1024;
const MAX_RETURN_CHARS = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

type PowerShellExecutable = "pwsh" | "pwsh.exe" | "powershell.exe";

export type PowerShellCommandSemantics = {
  category: "read_only" | "mutating" | "destructive" | "unknown";
  reason: string;
};

export const powerShellTool = defineTool({
  name: "PowerShell",
  description:
    "Run a PowerShell command in the working directory and return combined stdout/stderr. " +
    "Use on Windows for command execution and file writes because PowerShell handles Windows paths, " +
    "quoting, encodings and redirection more reliably than cmd.exe or POSIX shell syntax. " +
    "Commands that look destructive are rejected unless allowDangerous is true.",
  schema: z.object({
    command: z.string().describe("The PowerShell command to execute."),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .max(600_000)
      .optional()
      .describe("Optional timeout in milliseconds (default 30000)."),
    allowDangerous: z
      .boolean()
      .optional()
      .describe("Set true only when the user explicitly approved a destructive command."),
  }),
  async execute({ command, timeoutMs, allowDangerous }, ctx) {
    const semantics = classifyPowerShellCommandSemantics(command);
    if (semantics.category === "destructive" && !allowDangerous) {
      return {
        content:
          `Refusing to run potentially destructive PowerShell command: ${semantics.reason}. ` +
          "Ask the user for explicit approval, then retry with allowDangerous=true if appropriate.",
        isError: true,
      };
    }

    try {
      const result = await runPowerShell(command, {
        cwd: ctx.cwd,
        timeout: timeoutMs ?? DEFAULT_TIMEOUT_MS,
        signal: ctx.signal,
      });
      const interpreted = interpretPowerShellCommandResult(
        command,
        result.exitCode,
        result.stdout,
        result.stderr,
      );
      const out = [result.stdout, result.stderr, interpreted.message].filter(Boolean).join("\n").trim();
      return {
        content: truncateOutput(out || "(no output)"),
        ...(interpreted.isError ? { isError: true } : {}),
      };
    } catch (err) {
      const e = err as {
        stdout?: string;
        stderr?: string;
        message?: string;
        code?: unknown;
        signal?: unknown;
      };
      const out = [e.stdout, e.stderr, e.message].filter(Boolean).join("\n").trim();
      const prefix = formatFailurePrefix(e);
      return {
        content: truncateOutput([prefix, out || "PowerShell command failed"].filter(Boolean).join("\n")),
        isError: true,
      };
    }
  },
});

export function classifyPowerShellCommandSemantics(command: string): PowerShellCommandSemantics {
  const normalized = command.replace(/\s+/g, " ").trim();
  const destructive: Array<[RegExp, string]> = [
    [/\b(?:remove-item|rm|del|erase|rd|rmdir)\b[^\n;&|]*(?:\s-recurse\b|\s-r\b|\s-force\b|\s-fo\b)/i, "remove file/directory"],
    [/\bclear-content\b/i, "clear file content"],
    [/\bformat-volume\b/i, "format volume"],
    [/\bclear-disk\b/i, "clear disk"],
    [/\bremove-partition\b/i, "remove partition"],
    [/\breset-computer\b/i, "reset computer"],
    [/\bstop-computer\b/i, "stop computer"],
    [/\brestart-computer\b/i, "restart computer"],
    [/\bstop-process\b[^\n;&|]*(?:\s-force\b|\s-f\b)/i, "force stop process"],
    [/\bgit\s+reset\s+--hard\b/i, "git reset --hard"],
    [/\bgit\s+clean\s+-[^\s]*f/i, "git clean -f"],
    [/\bgit\s+branch\s+-D\b/i, "force delete git branch"],
    [/\bgit\s+push\b[^\n;&|]*(?:--force|-f)\b/i, "force push"],
  ];
  const destructiveReason = destructive.find(([re]) => re.test(normalized))?.[1];
  if (destructiveReason) return { category: "destructive", reason: destructiveReason };

  const mutating: Array<[RegExp, string]> = [
    [/\b(?:new-item|set-content|add-content|out-file|copy-item|move-item|rename-item|mkdir|ni|cp|copy|mv|move)\b/i, "filesystem mutation"],
    [/(^|[^>])>\s*[^&\s]/, "file redirect"],
    [/>>\s*[^&\s]/, "file append redirect"],
    [/\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove|update|upgrade)\b/i, "package mutation"],
    [/\b(?:pip|pip3)\s+(?:install|uninstall)\b/i, "python package mutation"],
    [/\bgit\s+(?:add|commit|merge|rebase|cherry-pick|pull|push|checkout|switch|restore)\b/i, "git mutation"],
  ];
  const mutatingReason = mutating.find(([re]) => re.test(normalized))?.[1];
  if (mutatingReason) return { category: "mutating", reason: mutatingReason };

  const readOnly: Array<[RegExp, string]> = [
    [/^(?:get-location|pwd|write-output|echo)\b/i, "read-only PowerShell command"],
    [/^(?:get-content|cat|gc|type|get-item|gi|test-path|resolve-path|get-childitem|gci|ls|dir)\b/i, "read/search filesystem command"],
    [/^(?:select-string|sls|findstr|where\.exe|rg|grep)\b/i, "search command"],
    [/^git\s+(?:status|diff|log|show|branch|rev-parse|ls-files)\b/i, "read-only git command"],
    [/^(?:npm|pnpm|yarn|bun)\s+(?:test|run|exec|why|list|ls)\b/i, "read-only/package script command"],
  ];
  const readOnlyReason = readOnly.find(([re]) => re.test(normalized))?.[1];
  if (readOnlyReason) return { category: "read_only", reason: readOnlyReason };

  return { category: "unknown", reason: "unclassified PowerShell command" };
}

async function runPowerShell(
  command: string,
  options: { cwd: string; timeout: number; signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const script = buildPowerShellScript(command);
  const executables: PowerShellExecutable[] =
    process.platform === "win32" ? ["pwsh.exe", "powershell.exe"] : ["pwsh"];
  let lastError: unknown;

  for (const executable of executables) {
    try {
      const { stdout, stderr } = await execFileAsync(executable, powerShellArgs(executable, script), {
        cwd: options.cwd,
        timeout: options.timeout,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        encoding: "utf8",
        ...(options.signal ? { signal: options.signal } : {}),
      });
      return { stdout, stderr, exitCode: 0 };
    } catch (err) {
      const e = err as { code?: unknown; stdout?: string; stderr?: string };
      if (e.code === "ENOENT") {
        lastError = err;
        continue;
      }
      const exitCode = typeof e.code === "number" ? e.code : 1;
      return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode };
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("PowerShell executable not found. Install PowerShell 7 (pwsh) or Windows PowerShell.");
}

function powerShellArgs(executable: PowerShellExecutable, script: string): string[] {
  const args = ["-NoProfile", "-NonInteractive"];
  if (executable === "powershell.exe") {
    args.push("-ExecutionPolicy", "Bypass");
  }
  args.push("-Command", script);
  return args;
}

function buildPowerShellScript(command: string): string {
  return [
    "$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "$ProgressPreference = 'SilentlyContinue'",
    "& {",
    command,
    "}",
    "if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }",
    "if (-not $?) { exit 1 }",
  ].join("\n");
}

function interpretPowerShellCommandResult(
  command: string,
  exitCode: number,
  stdout: string,
  stderr: string,
): { isError: boolean; message?: string } {
  const baseCommand = extractPowerShellBaseCommand(command);
  if (["grep", "rg", "findstr"].includes(baseCommand)) {
    return {
      isError: exitCode >= 2,
      message: exitCode === 1 ? "No matches found" : undefined,
    };
  }

  if (baseCommand === "robocopy") {
    return {
      isError: exitCode >= 8,
      message:
        exitCode === 0
          ? "No files copied (already in sync)"
          : exitCode >= 1 && exitCode < 8
            ? exitCode & 1
              ? "Files copied successfully"
              : "Robocopy completed (no errors)"
            : undefined,
    };
  }

  return {
    isError: exitCode !== 0,
    message: exitCode !== 0 ? `Command failed with exit code ${exitCode}` : undefined,
  };
}

function extractPowerShellBaseCommand(command: string): string {
  const segments = command.split(/[;|]/).filter((segment) => segment.trim());
  const last = segments[segments.length - 1] ?? command;
  const stripped = last.trim().replace(/^[&.]\s+/, "");
  const firstToken = stripped.split(/\s+/)[0] ?? "";
  const unquoted = firstToken.replace(/^["']|["']$/g, "");
  const basename = unquoted.split(/[\\/]/).pop() ?? unquoted;
  return basename.toLowerCase().replace(/\.exe$/, "");
}

function truncateOutput(output: string): string {
  if (output.length <= MAX_RETURN_CHARS) return output;
  const omitted = output.length - MAX_RETURN_CHARS;
  return `${output.slice(0, MAX_RETURN_CHARS)}\n\n[truncated ${omitted} chars]`;
}

function formatFailurePrefix(err: { code?: unknown; signal?: unknown }): string {
  const parts: string[] = [];
  if (err.code !== undefined) parts.push(`exit=${String(err.code)}`);
  if (err.signal !== undefined) parts.push(`signal=${String(err.signal)}`);
  return parts.length ? `[PowerShell command failed: ${parts.join(" ")}]` : "";
}
