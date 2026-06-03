import type { McpServerConfig } from "../mcp/types.js";
import type { CatalogServerDetail, CatalogServerSummary, LuckyMcpPreset } from "./types.js";

export function catalogDetailToPreset(detail: CatalogServerDetail): LuckyMcpPreset {
  const summary: CatalogServerSummary = {
    name: detail.name,
    ...(detail.title ? { title: detail.title } : {}),
    ...(detail.description ? { description: detail.description } : {}),
    ...(detail.version ? { version: detail.version } : {}),
    ...(detail.status ? { status: detail.status } : {}),
  };

  // Prefer what the runtime can actually run today: a local stdio server via npm.
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
      summary,
    };
  }

  // The catalog can describe remote (HTTP/SSE) servers, but the runtime manager
  // does not connect to remote transports yet. Producing a remote preset here
  // would just persist a config that always fails to start, so reject it with a
  // message that explains why instead of installing a dead server.
  const hasRemote = detail.remotes?.some(
    (entry) => entry.url && (entry.type === "streamable-http" || entry.type === "sse"),
  );
  if (hasRemote) {
    throw new Error(
      `${detail.name} is a remote MCP server, which Lucky cannot connect to yet. Only npm stdio servers are installable today.`,
    );
  }

  throw new Error(
    `No Lucky-installable preset found for ${detail.name}. Supported today: npm stdio packages.`,
  );
}

export function presetToStoredMcpConfig(
  preset: LuckyMcpPreset,
): McpServerConfig {
  return preset.config;
}
