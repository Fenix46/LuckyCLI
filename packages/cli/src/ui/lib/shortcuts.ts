/**
 * Keyboard shortcuts worth surfacing. One source for the `/keys` command and
 * the welcome card, so the two can never drift apart.
 */
export interface KeyboardShortcut {
  /** Keys as the user types them (kept short: the table column is narrow). */
  keys: string;
  what: string;
}

export const KEYBOARD_SHORTCUTS: readonly KeyboardShortcut[] = [
  { keys: "shift+tab", what: "cycle permission mode (ask, accept edits, auto, plan)" },
  { keys: "esc", what: "interrupt the turn or close a dialog" },
  { keys: "ctrl+c", what: "press twice to quit while a turn is running" },
  { keys: "/", what: "open the command menu" },
  { keys: "up/down", what: "recall previous prompts" },
  { keys: "pgup/pgdn", what: "scroll the terminal" },
] as const;

/** One compact line for the welcome card. */
export const SHORTCUT_HINT = "shift+tab mode · / commands · esc interrupt";
