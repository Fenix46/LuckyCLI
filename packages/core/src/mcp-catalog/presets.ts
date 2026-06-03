import type { McpServerConfig } from "../mcp/types.js";
import type { CatalogServerDetail, LuckyMcpPreset } from "./types.js";

export function catalogDetailToPreset(detail: CatalogServerDetail): LuckyMcpPreset {
  const remote = detail.remotes?.find((entry) => entry.url && (entry.type === "streamable-http" || entry.type === "sse"));
  if (remote?.url) {
    return {
      name: detail.name,
      config: {
        type: "remote",
        url: remote.url,
      },
      source: "official-registry",
      summary: {
        name: detail.name,
        ...(detail.title ? { title: detail.title } : {}),
        ...(detail.description ? { description: detail.description } : {}),
        ...(detail.version ? { version: detail.version } : {}),
        ...(detail.status ? { status: detail.status } : {}),
      },
    };
  }

  const npmPackage = detail.packages?.find(
    (entry) => entry.registryType === "npm" && entry.identifier && entry.transport?.type === "stdio",
  );
  if (npmPackage?.identifier) {
    return {
      name: detail.name,
      config: {
        type: "local",
        command: ["npx", "-y", npmPackage.identifier],
      },
      source: "official-registry",
      summary: {
        name: detail.name,
        ...(detail.title ? { title: detail.title } : {}),
        ...(detail.description ? { description: detail.description } : {}),
        ...(detail.version ? { version: detail.version } : {}),
        ...(detail.status ? { status: detail.status } : {}),
      },
    };
  }

  throw new Error(
    `No Lucky-installable preset found for ${detail.name}. Supported today: remote MCP URLs and npm stdio packages.`,
  );
}

export function presetToStoredMcpConfig(
  preset: LuckyMcpPreset,
): McpServerConfig {
  return preset.config;
}
