import {
  getThinkingEnabled,
  loadStoredConfig,
  saveThinkingEnabled,
} from "@luckycli/core";
import { getAvailableModels } from "../lib/model-picker.js";
import { contextRows } from "../lib/status.js";
import { emitError, unknownCommand } from "./helpers.js";
import type { Command } from "./types.js";

/** Config access, injectable so tests never touch the real disk. */
export interface ProviderCommandDeps {
  loadConfig: typeof loadStoredConfig;
  saveThinkingEnabled: typeof saveThinkingEnabled;
}

const defaultDeps: ProviderCommandDeps = {
  loadConfig: loadStoredConfig,
  saveThinkingEnabled,
};

export function providerCommands(deps: ProviderCommandDeps = defaultDeps): Command[] {
  return [
    {
      name: "/model",
      description: "Switch model for the active provider",
      run(args, ctx) {
        if (args) {
          ctx.ui.selectModel(args);
          return;
        }
        ctx.emit({
          kind: "command",
          title: "Models",
          rows: getAvailableModels(ctx.meta.provider).map((model) => ({
            label: model === ctx.meta.model ? "active" : "model",
            value: model,
          })),
        });
      },
    },
    {
      name: "/thinking",
      description: "Toggle Claude adaptive thinking (/thinking on|off)",
      run(args, ctx) {
        if (ctx.meta.provider !== "claude") {
          ctx.emit({
            kind: "error",
            text: "/thinking is currently only supported for Claude.",
          });
          return;
        }
        const arg = args.toLowerCase();
        if (!arg) {
          const enabled = getThinkingEnabled(deps.loadConfig(), ctx.meta.provider);
          ctx.emit({
            kind: "command",
            title: "Thinking",
            rows: [
              { label: "provider", value: "Claude" },
              { label: "adaptive", value: enabled ? "enabled" : "disabled" },
            ],
          });
          return;
        }
        if (arg !== "on" && arg !== "off") {
          ctx.emit({ kind: "error", text: "Usage: /thinking on | /thinking off" });
          return;
        }
        const enabled = arg === "on";
        deps.saveThinkingEnabled(ctx.meta.provider, enabled);
        // Rebuild the agent so the new thinking setting takes effect now.
        ctx.ui.changeModel(ctx.meta.model);
        ctx.emit({
          kind: "assistant",
          text: `Claude thinking ${enabled ? "enabled" : "disabled"}.`,
        });
      },
    },
    {
      name: "/provider",
      aliases: ["/setup"],
      description: "Switch provider and authenticate",
      run(args, ctx) {
        if (args) {
          unknownCommand(ctx, `/provider ${args}`);
          return;
        }
        ctx.emit({
          kind: "command",
          title: "Provider",
          rows: [{ label: "action", value: "opening provider switcher" }],
        });
        ctx.ui.triggerSetup();
      },
    },
    {
      name: "/status",
      description: "Show provider auth, account, quota and context status",
      async run(args, ctx) {
        if (args) {
          unknownCommand(ctx, `/status ${args}`);
          return;
        }
        try {
          const [providerStatus, status] = await Promise.all([
            ctx.agent.providerStatus(),
            ctx.agent.contextStatus(),
          ]);
          ctx.ui.setContextStatus(status);
          ctx.emit({ kind: "status", provider: providerStatus, context: status });
        } catch (error) {
          emitError(ctx, error, "failed to read provider status");
        }
      },
    },
    {
      name: "/context",
      description: "Show context window usage",
      hidden: true,
      async run(args, ctx) {
        if (args) {
          unknownCommand(ctx, `/context ${args}`);
          return;
        }
        try {
          const status = await ctx.agent.contextStatus();
          ctx.ui.setContextStatus(status);
          ctx.emit({ kind: "command", title: "Context", rows: contextRows(status) });
        } catch (error) {
          emitError(ctx, error, "failed to read context status");
        }
      },
    },
  ];
}
