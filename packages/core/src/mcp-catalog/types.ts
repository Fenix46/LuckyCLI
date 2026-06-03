import type { McpServerConfig } from "../mcp/types.js";

export interface CatalogServerSummary {
  name: string;
  title?: string;
  description?: string;
  version?: string;
  status?: string;
}

export interface CatalogPackage {
  registryType?: string;
  identifier?: string;
  version?: string;
  transport?: {
    type?: string;
  };
}

export interface CatalogRemote {
  type?: string;
  url?: string;
}

export interface CatalogServerDetail extends CatalogServerSummary {
  packages?: CatalogPackage[];
  remotes?: CatalogRemote[];
}

export interface CatalogSearchResult {
  items: CatalogServerSummary[];
}

export interface LuckyMcpPreset {
  name: string;
  config: McpServerConfig;
  source: "official-registry";
  summary: CatalogServerSummary;
}
