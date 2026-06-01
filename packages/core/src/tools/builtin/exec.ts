import { exec } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { defineTool } from "../types.js";

const execAsync = promisify(exec);
const MAX_BUFFER = 256 * 1024;
const MAX_RETURN_CHARS = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export const execTool = defineTool({
  name: "exec",
  description:
    "Run a shell command in the working directory and return its combined " +
    "stdout/stderr. Use for build, test, git and other local operations. " +
    "Commands that look destructive are rejected unless allowDangerous is true.",
  schema: z.object({
    command: z.string().describe("The shell command to execute."),
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
    const danger = classifyDangerousCommand(command);
    if (danger && !allowDangerous) {
      return {
        content:
          `Refusing to run potentially destructive command: ${danger}. ` +
          "Ask the user for explicit approval, then retry with allowDangerous=true if appropriate.",
        isError: true,
      };
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: ctx.cwd,
        timeout: timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });
      const out = [stdout, stderr].filter(Boolean).join("\n").trim();
      return { content: truncateOutput(out || "(no output)") };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string; code?: unknown; signal?: unknown };
      const out = [e.stdout, e.stderr, e.message].filter(Boolean).join("\n").trim();
      const prefix = formatFailurePrefix(e);
      return { content: truncateOutput([prefix, out || "command failed"].filter(Boolean).join("\n")), isError: true };
    }
  },
});

export function classifyDangerousCommand(command: string): string | undefined {
  const normalized = command.replace(/\s+/g, " ").trim();
  const checks: Array<[RegExp, string]> = [
    [/\brm\s+(?:-[^\s]*[rf][^\s]*|-[^\s]*[fr][^\s]*)\b/, "recursive/force rm"],
    [/\bsudo\b/, "sudo command"],
    [/\bchmod\s+(?:-[^\s]*R[^\s]*\s+)?777\b/, "chmod 777"],
    [/\bchown\s+-R\b/, "recursive chown"],
    [/\bgit\s+reset\s+--hard\b/, "git reset --hard"],
    [/\bgit\s+clean\s+-[^\s]*f/, "git clean -f"],
    [/\bgit\s+checkout\s+[^\n;&|]*--\s+\.\b/, "git checkout -- ."],
    [/\bmkfs(?:\.[\w-]+)?\b/, "filesystem formatting"],
    [/\bdd\s+[^\n;&|]*\bof=\/dev\//, "dd writing to device"],
    [/>\s*\/dev\/sd[a-z]\b/, "write redirect to block device"],
  ];
  return checks.find(([re]) => re.test(normalized))?.[1];
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
  return parts.length ? `[command failed: ${parts.join(" ")}]` : "";
}
