import type { CommandContext } from "./types.js";

/**
 * The single unknown-command error, used by dispatch for unmatched /x and by
 * no-arg commands rejecting stray arguments (the pre-registry behavior:
 * "/exit now" printed this error instead of exiting).
 */
export function unknownCommand(ctx: CommandContext, text: string): void {
  ctx.emit({ kind: "error", text: `unknown command: ${text}. Try /help.` });
}

export function emitError(ctx: CommandContext, error: unknown, fallback: string): void {
  ctx.emit({
    kind: "error",
    text: error instanceof Error ? error.message : fallback,
  });
}
