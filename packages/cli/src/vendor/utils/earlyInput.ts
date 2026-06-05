/**
 * SHIM — minimal stand-in for Claude Code's src/utils/earlyInput.ts.
 * The original buffered keystrokes typed before the app mounted and replayed
 * them; the fork calls `stopCapturingEarlyInput()` once the App takes over
 * stdin. Lucky doesn't buffer early input, so this is a no-op.
 */
export function stopCapturingEarlyInput(): void {
  // no-op: Lucky does not capture pre-mount input.
}
