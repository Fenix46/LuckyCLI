import { exec } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { defineTool } from "../types.js";

const execAsync = promisify(exec);
const MAX_OUTPUT = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export const execTool = defineTool({
  name: "exec",
  description:
    "Run a shell command in the working directory and return its combined " +
    "stdout/stderr. Use for build, test, git and other local operations.",
  schema: z.object({
    command: z.string().describe("The shell command to execute."),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .max(600_000)
      .optional()
      .describe("Optional timeout in milliseconds (default 30000)."),
  }),
  async execute({ command, timeoutMs }, ctx) {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: ctx.cwd,
        timeout: timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });
      const out = [stdout, stderr].filter(Boolean).join("\n").trim();
      return { content: out || "(no output)" };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      const out = [e.stdout, e.stderr, e.message].filter(Boolean).join("\n");
      return { content: out || "command failed", isError: true };
    }
  },
});
