import type { Agent, ContextStatus, ProviderId } from "@luckycli/core";
import type { Item } from "../lib/items.js";
import type { McpPanelTab } from "../components/McpPanel.js";

/**
 * Everything a slash command may touch. Commands never reach into React
 * state directly — App builds a fresh context per dispatch, so handlers
 * always see current state and stay unit-testable with a fake context.
 */
export interface CommandContext {
  agent: Agent;
  meta: { provider: ProviderId; model: string };
  /** Append transcript items (the only way commands produce output). */
  emit(...items: Item[]): void;
  setInput(value: string): void;
  /** Imperative surface into App: open panels/pickers, change model, exit… */
  ui: {
    openMcpPanel(tab: McpPanelTab, query?: string): void;
    openAgentsPanel(): void;
    triggerSetup(): void;
    triggerResume(): void;
    applyTheme(id: string): void;
    changeModel(model: string): void;
    exit(): void;
    setContextStatus(status: ContextStatus): void;
    setCompacting(on: boolean): void;
  };
}

export interface Command {
  /** Primary name, e.g. "/model". */
  name: string;
  /** One-line description shown in the slash menu and /help. */
  description: string;
  /** Extra names that dispatch identically, e.g. "/quit" for "/exit". */
  aliases?: string[];
  /** Excluded from the slash menu and /help (still dispatchable). */
  hidden?: boolean;
  run(args: string, ctx: CommandContext): Promise<void> | void;
}
