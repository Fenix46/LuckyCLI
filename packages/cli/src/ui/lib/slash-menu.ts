/**
 * Pure key semantics for the slash-command menu.
 *
 * Kept out of App so the behaviour is testable without mounting the TUI:
 * - arrows move the selection (clamped when the filtered list shrinks);
 * - Tab completes without running;
 * - Enter runs a highlighted completion (a second Enter would be ambiguous);
 * - Esc closes the menu first and clears the input on a second press.
 *
 * Enter on an input that already equals the selected command is deliberately
 * "none": ChatInput owns that submit, so the command runs exactly once.
 */
export interface SlashMenuKey {
  upArrow?: boolean;
  downArrow?: boolean;
  return?: boolean;
  tab?: boolean;
  escape?: boolean;
  ctrl?: boolean;
  meta?: boolean;
}

export type SlashMenuAction =
  | { type: "none" }
  | { type: "dismiss" }
  | { type: "clear" }
  | { type: "move"; index: number }
  | { type: "complete"; name: string }
  | { type: "execute"; name: string };

export function clampSelection(count: number, index: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(index, 0), count - 1);
}

export function slashMenuAction(params: {
  input: string;
  /** Filtered command names, already in display order. */
  names: readonly string[];
  selectedIndex: number;
  dismissed: boolean;
  key: SlashMenuKey;
}): SlashMenuAction {
  const { input, names, dismissed, key } = params;
  // A modified Enter is a newline in ChatInput, never a menu action.
  if (key.return && (key.ctrl || key.meta)) return { type: "none" };
  if (key.escape) {
    // With the menu already closed, Esc becomes "clear this command line".
    return dismissed ? { type: "clear" } : names.length > 0 ? { type: "dismiss" } : { type: "none" };
  }
  if (dismissed || names.length === 0) return { type: "none" };

  const index = clampSelection(names.length, params.selectedIndex);
  const selected = names[index];
  if (!selected) return { type: "none" };

  if (key.downArrow) return { type: "move", index: (index + 1) % names.length };
  if (key.upArrow) return { type: "move", index: (index - 1 + names.length) % names.length };
  if (key.tab) return { type: "complete", name: selected };
  if (key.return) {
    // The input is already the command: let ChatInput submit it.
    return input === selected ? { type: "none" } : { type: "execute", name: selected };
  }
  return { type: "none" };
}
