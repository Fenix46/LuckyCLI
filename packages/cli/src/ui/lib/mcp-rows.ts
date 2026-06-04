import type { McpServerConfig } from "@luckycli/core";
import type { CommandRow } from "./items.js";

export interface InstalledMcpRow {
  name: string;
  summary: string;
}

export function buildMcpCommandRows(
  mcpStatus: Record<string, { status: string; error?: string }>,
  toolCount: number,
): CommandRow[] {
  return Object.keys(mcpStatus).length === 0
    ? [
        { label: "servers", value: "none configured for this session" },
        { label: "tools", value: String(toolCount) },
      ]
    : [
        { label: "tools", value: String(toolCount) },
        ...Object.entries(mcpStatus).map(([name, status]) => ({
          label: name,
          value:
            status.status === "failed"
              ? `${status.status} · ${status.error}`
              : status.status,
        })),
      ];
}

export function buildInstalledMcpRows(
  mcpConfig: Record<string, McpServerConfig>,
  mcpStatus: Record<string, { status: string; error?: string }>,
): InstalledMcpRow[] {
  return Object.entries(mcpConfig).map(([name, config]) => {
    const status = mcpStatus[name];
    const enabled = config.enabled === false ? "disabled" : "enabled";
    const runtime =
      status?.status === "failed"
        ? `failed · ${status.error}`
        : status?.status ?? "not_loaded";
    const target = config.type === "local" ? config.command.join(" ") : config.url;
    return {
      name,
      summary: `${enabled} · ${runtime} · ${target}`,
    };
  });
}
