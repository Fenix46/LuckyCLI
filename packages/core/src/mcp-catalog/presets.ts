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

  // Otherwise fall back to a remote (HTTP/SSE) transport. The runtime connects
  // to unauthenticated remote servers; OAuth-protected ones will surface an auth
  // failure at connect time until the auth flow lands.
  const remote = detail.remotes?.find(
    (entry) => entry.url && (entry.type === "streamable-http" || entry.type === "sse"),
  );
  if (remote?.url) {
    return {
      name: detail.name,
      config: {
        type: "remote",
        url: remote.url,
      },
      source: "official-registry",
      summary,
    };
  }

  throw new Error(
    `No Lucky-installable preset found for ${detail.name}. Supported today: npm stdio packages and remote HTTP/SSE servers.`,
  );
}

export function presetToStoredMcpConfig(
  preset: LuckyMcpPreset,
): McpServerConfig {
  return preset.config;
}
