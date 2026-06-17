import type { Agent, ContextStatus, McpServerConfig, ProviderId } from "@luckycli/core";
import type { Item } from "../lib/items.js";
import type { McpPanelTab } from "../components/McpPanel.js";
import type { SkillPanelTab } from "../components/SkillPanel.js";

/**
 * Everything a slash command may touch. Commands never reach into React
 * state directly — App builds a fresh context per dispatch, so handlers
 * always see current state and stay unit-testable with a fake context.
 */
export interface CommandContext {
  agent: Agent;
  meta: { provider: ProviderId; model: string };
  /** The full command registry, for commands that render it (/help). */
  registry: Command[];
  /** Append transcript items (the only way commands produce output). */
  emit(...items: Item[]): void;
  setInput(value: string): void;
  /** Read-only snapshot of the App state commands render from. */
  state: {
    activeThemeId: string;
    sessionId: string | null;
    taskListId: string;
    contextStatus: ContextStatus | null;
  };
  /** Imperative surface into App: open panels/pickers, change model, exit… */
  ui: {
    openMcpPanel(tab: McpPanelTab, query?: string): void;
    openSkillPanel(tab: SkillPanelTab, query?: string): void;
    /**
     * Load an installed+enabled skill by name and send it as an operative turn,
     * so the model applies it to the current work. Resolves false (and the
     * caller reports the error) when the skill is missing or disabled.
     */
    runSkill(name: string): Promise<boolean>;
    openAgentsPanel(): void;
    triggerSetup(): void;
    triggerResume(): void;
    applyTheme(id: string): void;
    /** Validate + pick: may open the effort picker before switching. */
    selectModel(model: string): void;
    /** Rebuild the agent on the given model immediately (no picker). */
    changeModel(model: string): void;
    exit(): void;
    setContextStatus(status: ContextStatus): void;
    /** Toggle compaction-in-progress (App also tracks the started-at time). */
    setCompacting(on: boolean): void;
    /** Propagate a changed MCP config to the live manager. */
    setMcpConfig(next: Record<string, McpServerConfig>): void;
    persistSession(): void;
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
