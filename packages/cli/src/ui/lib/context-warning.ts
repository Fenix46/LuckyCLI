import type { ContextStatus } from "@luckycli/core";

/** Warn once when the context is this full (0..1). */
export const CONTEXT_WARNING_RATIO = 0.8;

/**
 * The one-time notice shown when the context window gets close to the
 * compaction point. Returns null while there is room (or when the provider
 * cannot report a size), so the caller can append a single transcript notice
 * without re-implementing the threshold.
 */
export function contextWarning(status: ContextStatus | null | undefined): string | null {
  const ratio =
    status?.ratio ??
    (status?.usedPercentage !== undefined ? status.usedPercentage / 100 : undefined);
  if (ratio === undefined || ratio < CONTEXT_WARNING_RATIO) return null;
  const percent = Math.min(99, Math.round(ratio * 100));
  return (
    `Context is ${percent}% full. /compact summarizes older turns; old tool output is cleared automatically as it fills.`
  );
}
