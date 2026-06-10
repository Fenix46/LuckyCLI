import {
  PROVIDER_CATALOG,
  getReasoningEffort,
  getThinkingEnabled,
  listSessions,
  listTasks,
  loadStoredConfig,
  resetTaskList,
} from "@luckycli/core";
import { THEMES } from "../themes.js";
import { formatNumber } from "../lib/format.js";
import { unknownCommand } from "./helpers.js";
import { ALL_SLASH_COMMANDS } from "./slash-menu.js";
import type { Command } from "./types.js";

/** Store/config access, injectable so tests never touch the real disk. */
export interface BasicCommandDeps {
  listSessions: typeof listSessions;
  listTasks: typeof listTasks;
  resetTaskList: typeof resetTaskList;
  loadConfig: typeof loadStoredConfig;
}

const defaultDeps: BasicCommandDeps = {
  listSessions,
  listTasks,
  resetTaskList,
  loadConfig: loadStoredConfig,
};

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
      description: "List saved sessions",
      hidden: true,
      run(args, ctx) {
        if (args) {
          unknownCommand(ctx, `/sessions ${args}`);
          return;
        }
        const sessions = deps.listSessions().slice(0, 12);
        ctx.emit({
          kind: "command",
          title: "Sessions",
          rows:
            sessions.length === 0
              ? [{ label: "none", value: "no saved sessions yet" }]
              : sessions.map((s) => ({
                  label: s.id === ctx.state.sessionId ? "current" : s.id,
                  value: `${s.messageCount} msgs · ${s.title ?? "(untitled)"}`,
                })),
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
          rows: ALL_SLASH_COMMANDS.map((cmd) => ({
            label: cmd.name,
            value: cmd.desc,
          })),
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
