/**
 * SHIM — minimal stand-in for Claude Code's src/bootstrap/state.ts.
 * The original is a large global-state module (telemetry, session ids, cost
 * tracking) pulling OpenTelemetry + the Anthropic SDK. The vendored Ink fork
 * uses only three functions:
 *   - markScrollActivity(): flag "scroll in progress" so background pollers can
 *     skip a tick (kept functional — it's a real scroll-smoothness optimization).
 *   - flushInteractionTime() / updateLastInteractionTime(): interaction-time
 *     telemetry (no-op here).
 */

const SCROLL_DRAIN_IDLE_MS = 100;
let scrollDraining = false;
let scrollDrainTimer: ReturnType<typeof setTimeout> | undefined;

export function markScrollActivity(): void {
  scrollDraining = true;
  if (scrollDrainTimer) clearTimeout(scrollDrainTimer);
  scrollDrainTimer = setTimeout(() => {
    scrollDraining = false;
    scrollDrainTimer = undefined;
  }, SCROLL_DRAIN_IDLE_MS);
  scrollDrainTimer.unref?.();
}

export function isScrollDraining(): boolean {
  return scrollDraining;
}

export function flushInteractionTime(): void {
  // no-op: Lucky doesn't track interaction-time telemetry.
}

export function updateLastInteractionTime(_immediate?: boolean): void {
  // no-op: Lucky doesn't track interaction-time telemetry.
}
