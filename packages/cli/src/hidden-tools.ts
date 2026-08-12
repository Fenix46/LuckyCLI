/**
 * Tools that never get their own row/update in a front-end transcript, shared
 * by the TUI turn runner and the ACP server so both surfaces hide the same
 * set. Task tools have richer dedicated surfaces (the TUI TaskPanel today,
 * ACP plan updates in milestone 5); ask_user's whole surface is the question
 * interaction itself, so a transcript row would only duplicate it.
 */
export const HIDDEN_TOOLS: ReadonlySet<string> = new Set([
  "task_create",
  "task_update",
  "task_list",
  "task_get",
  "ask_user",
]);
