/**
 * Slash commands an editor can run against a LuckyCLI session.
 *
 * ACP advertises a command roster (`available_commands_update`) that editors
 * surface in their own command menu; the chosen command arrives as an ordinary
 * prompt whose text starts with `/name`. So the dispatch here is deliberately
 * narrow: a prompt is a command only when its FIRST text block begins with a
 * slash and names something we advertised — anything else is a normal message
 * and must reach the model untouched.
 *
 * Commands run inside the turn: their output streams back as agent message
 * chunks and the turn ends normally, which keeps them cancellable and avoids
 * the editor having to make sense of out-of-turn notifications.
 *
 * The handlers take the pieces they touch (agent, cwd, graph builder, config
 * store) rather than reaching for globals, so the whole registry is testable
 * without a connection or a real project.
 */
import {
  getThinkingEnabled,
  type buildAndSaveGraph,
  type recordGraphBuilt,
  type Agent as EngineAgent,
  type ContextStatus,
  type ProviderId,
  type StoredConfig,
} from "@luckycli/core";
import type { AvailableCommand } from "@zed-industries/agent-client-protocol";

/** What a command handler is given to do its work. */
export interface CommandContext {
  agent: EngineAgent;
  cwd: string;
  provider: ProviderId;
  model: string;
  /** Graph build, injectable so tests stay offline. */
  buildGraph: typeof buildAndSaveGraph;
  recordGraphBuilt: typeof recordGraphBuilt;
  /** Config access, injectable so tests never touch the real config file. */
  store: { load: () => StoredConfig; save: (config: StoredConfig) => void };
  /**
   * Rebuild the session runtime — needed by commands that change how the model
   * is called (e.g. /thinking), mirroring the TUI's changeModel.
   */
  rebuild: () => Promise<void>;
}

export interface AcpCommand {
  name: string;
  description: string;
  /** Placeholder shown by editors that accept command arguments. */
  hint?: string;
  /** Runs the command and resolves the text to stream back into the turn. */
  run: (args: string, ctx: CommandContext) => Promise<string>;
}

export const ACP_COMMANDS: AcpCommand[] = [
  {
    name: "graph",
    description: "Build or refresh the project knowledge graph",
    hint: "build|rebuild",
    async run(args, ctx) {
      if (args && args !== "build" && args !== "rebuild") {
        return "Usage: /graph [build|rebuild]";
      }
      try {
        const summary = await ctx.buildGraph(ctx.cwd);
        ctx.recordGraphBuilt(ctx.cwd);
        const lines = [
          "**Graph built**",
          `- files: ${summary.fileCount}`,
          `- nodes: ${summary.nodeCount}`,
          `- edges: ${summary.edgeCount}`,
          `- saved: ${summary.path}`,
        ];
        if (summary.droppedEdges > 0) {
          lines.push(`- dropped: ${summary.droppedEdges} unresolved edges`);
        }
        return lines.join("\n");
      } catch (err) {
        return `Graph build failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    name: "status",
    description: "Show the active provider, model and context usage",
    async run(_args, ctx) {
      const lines = [
        "**Status**",
        `- provider: ${ctx.provider}`,
        `- model: ${ctx.model}`,
        `- cwd: ${ctx.cwd}`,
      ];
      const status = await safeContextStatus(ctx.agent);
      if (status) lines.push(...contextLines(status));
      return lines.join("\n");
    },
  },
  {
    name: "context",
    description: "Show context window usage for this session",
    async run(_args, ctx) {
      const status = await safeContextStatus(ctx.agent);
      if (!status) return "Context usage is not available for this session.";
      return ["**Context**", ...contextLines(status)].join("\n");
    },
  },
  {
    name: "compact",
    description: "Summarize older history to free up context",
    async run(args, ctx) {
      if (args) return "Usage: /compact";
      try {
        const result = await ctx.agent.compactNow();
        const lines = [
          "**Compacted**",
          `- removed: ${result.removedMessages} messages`,
          `- kept: ${result.keptMessages} messages`,
        ];
        if (result.beforeTokens !== undefined && result.afterTokens !== undefined) {
          lines.push(`- tokens: ${result.beforeTokens} → ${result.afterTokens}`);
        }
        return lines.join("\n");
      } catch (err) {
        return `Compaction failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    name: "thinking",
    description: "Toggle Claude adaptive thinking (on|off)",
    hint: "on|off",
    async run(args, ctx) {
      if (ctx.provider !== "claude") {
        return "/thinking is only supported for Claude.";
      }
      const arg = args.trim().toLowerCase();
      if (!arg) {
        const enabled = getThinkingEnabled(ctx.store.load(), ctx.provider);
        return `Adaptive thinking is **${enabled ? "enabled" : "disabled"}**.`;
      }
      if (arg !== "on" && arg !== "off") return "Usage: /thinking on | /thinking off";
      const enabled = arg === "on";
      // Persist through the injected store, then rebuild so the setting
      // applies to the next turn rather than the one after.
      const config = ctx.store.load();
      ctx.store.save(withThinking(config, ctx.provider, enabled));
      await ctx.rebuild();
      return `Adaptive thinking **${enabled ? "enabled" : "disabled"}**.`;
    },
  },
];

/** The roster as `available_commands_update` carries it. */
export function availableCommands(): AvailableCommand[] {
  return ACP_COMMANDS.map((command) => ({
    name: command.name,
    description: command.description,
    ...(command.hint ? { input: { hint: command.hint } } : {}),
  }));
}

/** A prompt's leading text, parsed as a command invocation. */
export interface ParsedCommand {
  name: string;
  args: string;
  /** The matching command, absent when the name is not one we advertise. */
  command?: AcpCommand;
}

/**
 * Recognize `/name [args]` at the very start of a prompt. Returns undefined
 * for ordinary prompts — including text that merely mentions a slash later on,
 * or a lone `/`, which must reach the model as written.
 */
export function parseCommand(text: string): ParsedCommand | undefined {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("/")) return undefined;
  // Only the first line can be the invocation; a slash followed by a newline
  // or nothing is not a command name.
  const [firstLine = "", ...rest] = trimmed.split("\n");
  const match = /^\/([A-Za-z][\w-]*)\s*(.*)$/.exec(firstLine);
  if (!match) return undefined;
  const name = match[1]!.toLowerCase();
  const inlineArgs = match[2]!.trim();
  const args = [inlineArgs, ...rest].join("\n").trim();
  const command = ACP_COMMANDS.find((c) => c.name === name);
  return { name, args, ...(command ? { command } : {}) };
}

/** The reply for a `/name` we do not implement: a roster, not a silent no-op. */
export function unknownCommandHelp(name: string): string {
  const list = ACP_COMMANDS.map((c) => `- \`/${c.name}\` — ${c.description}`).join("\n");
  return `Unknown command \`/${name}\`.\n\nAvailable commands:\n${list}`;
}

/** Context status without letting a provider hiccup break the command. */
async function safeContextStatus(agent: EngineAgent): Promise<ContextStatus | undefined> {
  try {
    return await agent.contextStatus();
  } catch {
    return undefined;
  }
}

/** The human-readable context lines shared by /status and /context. */
function contextLines(status: ContextStatus): string[] {
  const lines: string[] = [];
  if (status.usedTokens !== undefined && status.usableTokens !== undefined) {
    const percent =
      status.usedPercentage !== undefined ? ` (${Math.round(status.usedPercentage)}%)` : "";
    lines.push(`- context: ${status.usedTokens} / ${status.usableTokens} tokens${percent}`);
  } else if (status.contextWindow !== undefined) {
    lines.push(`- context window: ${status.contextWindow} tokens`);
  }
  if (status.totalCacheReadTokens) {
    lines.push(`- cache reads: ${status.totalCacheReadTokens} tokens`);
  }
  if (status.tokenCounter === "unavailable") {
    lines.push("- token counts are unavailable for this provider");
  }
  return lines;
}

/**
 * Set the per-provider thinking flag without disturbing the rest of the stored
 * config (core's saveThinkingEnabled writes the real file; here the caller's
 * store decides where it lands).
 */
function withThinking(
  config: StoredConfig,
  provider: ProviderId,
  enabled: boolean,
): StoredConfig {
  return {
    ...config,
    providerSettings: {
      ...config.providerSettings,
      [provider]: { ...config.providerSettings?.[provider], thinkingEnabled: enabled },
    },
  };
}
