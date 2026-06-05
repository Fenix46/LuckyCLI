/**
 * SHIM — minimal stand-in for Claude Code's src/utils/fullscreen.ts.
 * The vendored Ink fork uses only `isMouseClicksDisabled` (App.tsx guards mouse
 * click handling on it). Lucky drives its own SGR mouse tracking from index.tsx,
 * so we report "not disabled" and let the app layer decide.
 */
export function isMouseClicksDisabled(): boolean {
  return false;
}
