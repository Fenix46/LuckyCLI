import {
  PROVIDER_CATALOG,
  describeHookConfig,
  getReasoningEffort,
  loadHookConfig,
  getThinkingEnabled,
  listSessions,
  listTasks,
  loadStoredConfig,
  resetTaskList,
  type Message,
} from "@luckycli/core";
import { setClipboard } from "../../vendor/ink/termio/osc.js";
import { THEMES } from "../themes.js";
import { formatNumber } from "../lib/format.js";
import { KEYBOARD_SHORTCUTS } from "../lib/shortcuts.js";
import { unknownCommand } from "./helpers.js";
import type { Command } from "./types.js";

/** Store/config access, injectable so tests never touch the real disk. */
export interface BasicCommandDeps {
  listSessions: typeof listSessions;
  listTasks: typeof listTasks;
  resetTaskList: typeof resetTaskList;
  loadConfig: typeof loadStoredConfig;
  /** Read global + project hook config (injectable for /hooks tests). */
  loadHooks: typeof loadHookConfig;
  /** Put text on the system clipboard (OSC 52 / tmux / native helper). */
  copyToClipboard: (text: string) => Promise<void>;
}

const defaultDeps: BasicCommandDeps = {
  listSessions,
  listTasks,
  resetTaskList,
  loadConfig: loadStoredConfig,
  loadHooks: loadHookConfig,
  copyToClipboard: async (text) => {
    const sequence = await setClipboard(text);
    if (sequence) process.stdout.write(sequence);
  },
};

/**
 * Assistant replies (text only, tool calls dropped), newest first — what
 * /copy picks from.
 */
export function assistantReplies(messages: readonly Message[]): string[] {
  const replies: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.role !== "assistant") continue;
    const text = message.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("")
      .trim();
    if (text) replies.push(text);
  }
  return replies;
}

export function basicCommands(deps: BasicCommandDeps = defaultDeps): Command[] {
  return [
    {
      name: "/theme",
      description: "Choose terminal UI colors",
      run(args, ctx) {
        if (args) {
          ctx.ui.applyTheme(args);
          return;
        }
        ctx.emit({
          kind: "command",
          title: "Themes",
          rows: THEMES.map((theme) => ({
            label: theme.id === ctx.state.activeThemeId ? "active" : "theme",
            value: `${theme.id} (${theme.name})`,
          })),
        });
      },
    },
    {
      name: "/worktree",
      description: "List, enter or leave a Lucky git worktree (/worktree enter [name])",
      async run(args, ctx) {
        const trimmed = args.trim();
        if (!trimmed || trimmed === "list") {
          await ctx.ui.worktree("list");
          return;
        }
        if (trimmed === "exit") {
          await ctx.ui.worktree("exit");
          return;
        }
        if (trimmed === "enter") {
          await ctx.ui.worktree("enter");
          return;
        }
        if (trimmed.startsWith("enter ")) {
          await ctx.ui.worktree("enter", trimmed.slice("enter ".length).trim());
          return;
        }
        ctx.emit({
          kind: "error",
          text: "usage: /worktree [list | enter [name] | exit]",
        });
      },
    },
    {
      name: "/browser",
      description: "Show the Lucky Chrome extension port and token",
      async run(_args, ctx) {
        await ctx.ui.browserInfo();
      },
    },
    {
      name: "/hooks",
      description: "List configured lifecycle hooks",
      async run(_args, ctx) {
        const cwd = ctx.agent.workingDirectory ?? process.cwd();
        const loaded = deps.loadHooks(cwd);
        if (loaded.errors.length > 0) {
          ctx.emit({
            kind: "command",
            title: "Hook config errors",
            rows: loaded.errors.map((error) => ({ label: "error", value: error })),
          });
        }
        if (loaded.disabled) {
          ctx.emit({
            kind: "notice",
            tone: "info",
            text: "Hooks are disabled by LUCKY_DISABLE_HOOKS.",
          });
          return;
        }
        const events = describeHookConfig(loaded.config);
        if (events.length === 0) {
          ctx.emit({
            kind: "notice",
            tone: "info",
            text: "No hooks configured. Add them under \"hooks\" in ~/.luckycli/config.json or in .lucky/hooks.json.",
          });
          return;
        }
        ctx.emit({
          kind: "command",
          title: "Lifecycle hooks",
          rows: [
            ...loaded.sources.map((source) => ({
              label: "source",
              value: `${source.path} (${source.events})`,
            })),
            ...events.map((event) => ({
              label: event.event,
              value: `${event.handlers} handler${event.handlers === 1 ? "" : "s"} · ${event.matchers.join(", ")}`,
            })),
          ],
        });
      },
    },
    {
      name: "/task",
      description: "View the work task list (/task clear to empty it)",
      run(args, ctx) {
        if (args && args !== "clear") {
          unknownCommand(ctx, `/task ${args}`);
          return;
        }
        if (args === "clear") {
          deps.resetTaskList(ctx.state.taskListId);
          ctx.emit({
            kind: "command",
            title: "Tasks",
            rows: [{ label: "cleared", value: "the task list is now empty" }],
          });
          return;
        }
        const tasks = deps.listTasks(ctx.state.taskListId);
        ctx.emit({
          kind: "command",
          title: "Tasks",
          rows:
            tasks.length === 0
              ? [{ label: "none", value: "no tasks yet — ask lucky to plan some work" }]
              : tasks.map((t) => ({
                  label: `#${t.id} ${t.status}`,
                  value:
                    t.status === "in_progress" && t.activeForm
                      ? `${t.subject} (${t.activeForm})`
                      : t.subject,
                })),
        });
      },
    },
    {
      name: "/exit",
      aliases: ["/quit"],
      description: "Exit the lucky agent session",
      run(args, ctx) {
        if (args) {
          unknownCommand(ctx, `/exit ${args}`);
          return;
        }
        ctx.ui.exit();
      },
    },
    {
      name: "/resume",
      description: "Pick a saved session to resume",
      run(args, ctx) {
        if (args) {
          unknownCommand(ctx, `/resume ${args}`);
          return;
        }
        if (deps.listSessions().length === 0) {
          ctx.emit({ kind: "error", text: "no saved sessions to resume" });
          return;
        }
        ctx.ui.triggerResume();
      },
    },
    {
      name: "/fork",
      aliases: ["/branch"],
      description: "Branch this conversation into a new session (/fork <n> keeps the first n messages)",
      async run(args, ctx) {
        if (args) {
          const count = Number(args);
          if (!Number.isInteger(count) || count < 1) {
            ctx.emit({
              kind: "error",
              text: "usage: /fork [messages] — messages is a positive integer",
            });
            return;
          }
          await ctx.ui.forkSession(count);
          return;
        }
        await ctx.ui.forkSession();
      },
    },
    {
      name: "/agents",
      description: "Manage sub-agent profiles (provider/model per role)",
      run(args, ctx) {
        if (args) {
          unknownCommand(ctx, `/agents ${args}`);
          return;
        }
        ctx.ui.openAgentsPanel();
      },
    },
    {
      name: "/sessions",
      description: "List this project's saved sessions",
      hidden: true,
      run(args, ctx) {
        if (args) {
          unknownCommand(ctx, `/sessions ${args}`);
          return;
        }
        const sessions = deps.listSessions({ cwd: process.cwd() }).slice(0, 12);
        ctx.emit({
          kind: "command",
          title: "Sessions",
          rows:
            sessions.length === 0
              ? [{ label: "none", value: "no saved sessions for this project yet" }]
              : sessions.map((s) => ({
                  label: s.id === ctx.state.sessionId ? "current" : s.id,
                  value: `${s.messageCount} msgs · ${s.title ?? "(untitled)"}`,
                })),
        });
      },
    },
    {
      name: "/copy",
      description: "Copy the last reply to the clipboard (/copy 2 = the one before)",
      async run(args, ctx) {
        const nth = args ? Number(args) : 1;
        if (!Number.isInteger(nth) || nth < 1) {
          ctx.emit({ kind: "error", text: "usage: /copy [n] — n counts back from the latest reply (1 = latest)" });
          return;
        }
        const reply = assistantReplies(ctx.agent.messages)[nth - 1];
        if (!reply) {
          ctx.emit({ kind: "error", text: nth === 1 ? "no reply to copy yet" : `there is no reply #${nth} to copy` });
          return;
        }
        try {
          await deps.copyToClipboard(reply);
        } catch (error) {
          ctx.emit({
            kind: "error",
            text: `could not copy to the clipboard: ${error instanceof Error ? error.message : String(error)}`,
          });
          return;
        }
        const lines = reply.split("\n").length;
        ctx.emit({
          kind: "command",
          title: "Copied",
          rows: [
            { label: "reply", value: nth === 1 ? "latest" : `#${nth} from latest` },
            { label: "size", value: `${formatNumber(reply.length)} chars · ${lines} ${lines === 1 ? "line" : "lines"}` },
          ],
        });
      },
    },
    {
      name: "/diff",
      description: "Review the file changes of the last turn (/diff all = whole session)",
      run(args, ctx) {
        if (args && args !== "all") {
          ctx.emit({ kind: "error", text: "usage: /diff [all]" });
          return;
        }
        const scope = args === "all" ? "session" : "turn";
        const diffs = ctx.state.diffs[scope];
        const when = scope === "turn" ? "in the last turn" : "in this session";
        if (diffs.length === 0) {
          ctx.emit({
            kind: "notice",
            tone: "info",
            text: `No file changes ${when} (changes made by shell commands aren't tracked).`,
          });
          return;
        }
        const files = new Set(diffs.map((d) => d.path)).size;
        const added = diffs.reduce((n, d) => n + d.additions, 0);
        const removed = diffs.reduce((n, d) => n + d.deletions, 0);
        ctx.emit({
          kind: "diff",
          title: `Changes ${when} · ${files} ${files === 1 ? "file" : "files"} · +${added} −${removed}`,
          diffs,
        });
      },
    },
    {
      name: "/help",
      description: "List available commands",
      hidden: true,
      run(args, ctx) {
        if (args) {
          unknownCommand(ctx, `/help ${args}`);
          return;
        }
        ctx.emit({
          kind: "command",
          title: "Commands",
          rows: ctx.registry
            .filter((command) => !command.hidden)
            .map((command) => ({ label: command.name, value: command.description })),
        });
      },
    },
    {
      name: "/keys",
      description: "Show keyboard shortcuts",
      run(args, ctx) {
        if (args) {
          unknownCommand(ctx, `/keys ${args}`);
          return;
        }
        ctx.emit({
          kind: "command",
          title: "Keyboard shortcuts",
          rows: KEYBOARD_SHORTCUTS.map(({ keys, what }) => ({ label: keys, value: what })),
        });
      },
    },
    {
      name: "/config",
      description: "Show the active provider/model configuration",
      hidden: true,
      run(args, ctx) {
        if (args) {
          unknownCommand(ctx, `/config ${args}`);
          return;
        }
        const { provider, model } = ctx.meta;
        const providerInfo = PROVIDER_CATALOG[provider];
        ctx.emit({
          kind: "command",
          title: "Config",
          rows: [
            { label: "provider", value: `${providerInfo.displayName} (${provider})` },
            { label: "model", value: model },
            ...(provider === "openai-oauth" || provider === "claude"
              ? [{ label: "effort", value: getReasoningEffort(deps.loadConfig(), provider) }]
              : []),
            ...(provider === "claude"
              ? [
                  {
                    label: "thinking",
                    value: getThinkingEnabled(deps.loadConfig(), provider)
                      ? "adaptive"
                      : "disabled",
                  },
                ]
              : []),
            {
              label: "context",
              value: ctx.state.contextStatus?.contextWindow
                ? `${formatNumber(ctx.state.contextStatus.contextWindow)} tokens`
                : "unknown",
            },
            { label: "streaming", value: providerInfo.supportsStreaming ? "yes" : "no" },
            { label: "tools", value: providerInfo.supportsTools ? "yes" : "no" },
            { label: "vision", value: providerInfo.supportsVision ? "yes" : "no" },
          ],
        });
      },
    },
  ];
}
