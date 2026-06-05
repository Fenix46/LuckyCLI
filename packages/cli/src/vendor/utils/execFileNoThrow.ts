/**
 * SHIM — minimal stand-in for Claude Code's src/utils/execFileNoThrow.ts.
 * The vendored Ink fork uses this only for OSC clipboard dispatch in
 * termio/osc.ts (tmux load-buffer, pbcopy/wl-copy/xclip/xsel/clip). We back it
 * with node's child_process.execFile and always resolve (never throw), matching
 * the original's contract of returning a { code } result with optional stdio.
 */
import { execFile } from "node:child_process";

interface ExecFileOptions {
  abortSignal?: AbortSignal;
  timeout?: number;
  preserveOutputOnError?: boolean;
  useCwd?: boolean;
  env?: NodeJS.ProcessEnv;
  stdin?: "ignore" | "inherit" | "pipe";
  input?: string;
}

export function execFileNoThrow(
  file: string,
  args: string[],
  options: ExecFileOptions = {},
): Promise<{ stdout: string; stderr: string; code: number; error?: string }> {
  return new Promise((resolve) => {
    const child = execFile(
      file,
      args,
      {
        timeout: options.timeout ?? 10 * 60 * 1000,
        ...(options.env ? { env: options.env } : {}),
        ...(options.abortSignal ? { signal: options.abortSignal } : {}),
      },
      (error, stdout, stderr) => {
        if (error) {
          const code = typeof error.code === "number" ? error.code : 1;
          resolve({
            stdout: String(stdout ?? ""),
            stderr: String(stderr ?? ""),
            code,
            error: error.message,
          });
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr), code: 0 });
      },
    );
    // Some callers pipe data into stdin (clipboard payload).
    if (options.input !== undefined && child.stdin) {
      child.stdin.end(options.input);
    }
  });
}
