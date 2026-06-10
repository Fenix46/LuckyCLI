import {
  CachedMcpCatalog,
  OfficialMcpRegistryCatalog,
  catalogDetailToPreset,
  loadStoredConfig,
  saveStoredConfig,
  withMcpServer,
  type McpServerConfig,
} from "@luckycli/core";
import type { Item } from "../lib/items.js";
import { emitError, unknownCommand } from "./helpers.js";
import type { Command } from "./types.js";

/** Catalog/config access, injectable so tests never hit network or disk. */
export interface McpCommandDeps {
  createCatalog(): Pick<CachedMcpCatalog, "get">;
  loadConfig: typeof loadStoredConfig;
  saveConfig: typeof saveStoredConfig;
}

const defaultDeps: McpCommandDeps = {
  createCatalog: () => new CachedMcpCatalog(new OfficialMcpRegistryCatalog()),
  loadConfig: loadStoredConfig,
  saveConfig: saveStoredConfig,
};

/**
 * Look a server up in the official registry, persist its preset and apply
 * the new config. Emits the "MCP Added" item on success, throws on failure
 * (the /mcp add command and the panel's install flow handle errors
 * differently: transcript item vs. panel error line).
 */
export async function installCatalogServer(
  name: string,
  applyConfig: (next: Record<string, McpServerConfig>) => void,
  emit: (item: Item) => void,
  deps: McpCommandDeps = defaultDeps,
): Promise<void> {
  const detail = await deps.createCatalog().get(name);
  const preset = catalogDetailToPreset(detail);
  const next = withMcpServer(deps.loadConfig(), preset.name, preset.config);
  deps.saveConfig(next);
  applyConfig(next.mcp ?? {});
  emit({
    kind: "command",
    title: "MCP Added",
    rows: [
      { label: "server", value: preset.name },
      { label: "type", value: preset.config.type },
      { label: "source", value: "official-registry" },
    ],
  });
}

export function mcpCommands(deps: McpCommandDeps = defaultDeps): Command[] {
  return [
    {
      name: "/mcp",
      description: "Open the interactive MCP control panel",
      async run(args, ctx) {
        if (!args || args === "status" || args === "list") {
          ctx.ui.openMcpPanel("installed");
          return;
        }
        if (args === "search" || args.startsWith("search ")) {
          ctx.ui.openMcpPanel("search", args.slice("search".length).trim());
          return;
        }
        if (args === "show" || args.startsWith("show ")) {
          const name = args.slice("show".length).trim();
          if (!name) {
            ctx.emit({ kind: "error", text: "usage: /mcp show <server-name>" });
            return;
          }
          try {
            const detail = await deps.createCatalog().get(name);
            const preset = catalogDetailToPreset(detail);
            ctx.emit({
              kind: "command",
              title: `MCP Server: ${detail.name}`,
              rows: [
                ...(detail.title ? [{ label: "title", value: detail.title }] : []),
                ...(detail.description
                  ? [{ label: "description", value: detail.description }]
                  : []),
                ...(detail.version ? [{ label: "version", value: detail.version }] : []),
                {
                  label: "preset",
                  value:
                    preset.config.type === "local"
                      ? preset.config.command.join(" ")
                      : preset.config.url,
                },
              ],
            });
          } catch (error) {
            emitError(ctx, error, "failed to load MCP server");
          }
          return;
        }
        if (args === "add" || args.startsWith("add ")) {
          const name = args.slice("add".length).trim();
          if (!name) {
            ctx.emit({ kind: "error", text: "usage: /mcp add <server-name>" });
            return;
          }
          try {
            await installCatalogServer(name, ctx.ui.setMcpConfig, (item) => ctx.emit(item), deps);
          } catch (error) {
            emitError(ctx, error, "failed to add MCP server");
          }
          return;
        }
        unknownCommand(ctx, `/mcp ${args}`);
      },
    },
  ];
}
