import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

/**
 * Where a tool's full output is kept when the model only receives a truncated
 * view. Claude Code writes the complete shell output to a file and puts the
 * path in the tool result, so a large build or test log costs detail in the
 * transcript but never loses information: the model can read the rest.
 *
 * `.lucky/` is gitignored, so a project never commits these files by accident.
 */
export const TOOL_RESULTS_DIR = ".lucky/tool-results";
export const MAX_PERSISTED_OUTPUT_BYTES = 8 * 1024 * 1024;

export interface PersistedToolOutput {
  /** Path relative to the working directory, as shown to the model. */
  relativePath: string;
  absolutePath: string;
  /** Bytes written (the first MAX_PERSISTED_OUTPUT_BYTES when truncated). */
  bytes: number;
  /** True when the output itself was larger than the persistence cap. */
  truncated: boolean;
}

/**
 * Write `output` under `<cwd>/.lucky/tool-results/` and return its location.
 * Best-effort: an unwritable project must not fail the tool that produced the
 * output, so any filesystem error resolves undefined.
 */
export async function persistToolOutput(
  cwd: string,
  toolName: string,
  toolCallId: string | undefined,
  output: string,
): Promise<PersistedToolOutput | undefined> {
  if (output.length === 0) return undefined;
  try {
    const root = resolve(cwd);
    const dir = join(root, TOOL_RESULTS_DIR);
    await mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeTool = sanitize(toolName, 32) || "tool";
    const safeCall = sanitize(toolCallId ?? "call", 48) || "call";
    const absolutePath = join(dir, `${stamp}-${safeTool}-${safeCall}.txt`);
    const buffer = Buffer.from(output, "utf8");
    const truncated = buffer.byteLength > MAX_PERSISTED_OUTPUT_BYTES;
    const bytes = truncated ? MAX_PERSISTED_OUTPUT_BYTES : buffer.byteLength;
    await writeFile(
      absolutePath,
      truncated ? buffer.subarray(0, MAX_PERSISTED_OUTPUT_BYTES) : buffer,
      { mode: 0o600 },
    );
    // writeFile's mode is filtered by umask on some systems.
    await chmod(absolutePath, 0o600).catch(() => {});
    return {
      relativePath: relative(root, absolutePath),
      absolutePath,
      bytes,
      truncated,
    };
  } catch {
    return undefined;
  }
}

function sanitize(value: string, maxLength: number): string {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);
}
