/**
 * Persistent on-disk configuration at ~/.luckycli/config.json.
 *
 * This is what makes LuckyCLI feel like a normal CLI tool: the user picks a
 * provider + key once (via the setup dialog) and it's remembered. The file is
 * written with 0600 permissions since it can hold API keys.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { McpServerConfig } from "../mcp/types.js";
import type { ProviderCredentials, ProviderId } from "../providers/types.js";
import type { ToolPermissionPolicy } from "../tools/permissions.js";

export interface StoredConfig {
  provider?: ProviderId;
  model?: string;
  theme?: string;
  update?: {
    lastCheckedAt?: number;
    latestVersion?: string;
    releaseUrl?: string;
    /** How aggressively to self-update. Unset is treated as "auto". */
    autoUpdate?: AutoUpdatePolicy;
    /** A verified new binary staged on disk, applied on the next cold start. */
    staged?: StagedUpdate;
  };
  /** Tool permission policy. Keys can be tool names or wildcard patterns; values are allow/ask/deny. */
  permissions?: ToolPermissionPolicy;
  /** Saved credentials per provider, so switching doesn't re-prompt. */
  credentials?: Partial<Record<ProviderId, ProviderCredentials>>;
  /** Configured MCP servers, keyed by logical server name. */
  mcp?: Record<string, McpServerConfig>;
  /** Per-folder trust + graph state, keyed by absolute path. See project-trust.ts. */
  projects?: Record<string, ProjectRecord>;
}

/**
 * Self-update aggressiveness:
 * - `off`    — never check or download.
 * - `notify` — check and show a banner; the user applies updates manually.
 * - `auto`   — download + verify in the background and apply on next launch.
 */
export type AutoUpdatePolicy = "off" | "notify" | "auto";

/** A verified binary downloaded ahead of time, waiting to replace the running one. */
export interface StagedUpdate {
  version: string;
  /** Absolute path of the staged, checksum-verified binary. */
  path: string;
  sha256: string;
  stagedAt: number;
}

/** What we remember about a project folder once the agent has opened it. */
export interface ProjectRecord {
  /** Whether the user trusted this folder. */
  trusted: boolean;
  /** ISO timestamp of the first time the agent opened here. */
  firstOpenedAt: string;
  /** ISO timestamp of the last graph build, if any. */
  graphBuiltAt?: string;
}

const CONFIG_DIR = join(homedir(), ".luckycli");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export function configFilePath(): string {
  return CONFIG_FILE;
}

export function loadStoredConfig(): StoredConfig {
  try {
    if (!existsSync(CONFIG_FILE)) return {};
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as StoredConfig;
  } catch {
    return {};
  }
}

export function saveStoredConfig(cfg: StoredConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  try {
    chmodSync(CONFIG_FILE, 0o600);
  } catch {
    // best-effort on platforms without POSIX permissions
  }
}

/**
 * Persist the result of the setup dialog: make this the active provider/model
 * and remember its credentials. Returns the merged config.
 */
export function saveProviderSetup(
  provider: ProviderId,
  model: string,
  credentials: ProviderCredentials,
): StoredConfig {
  const cfg = loadStoredConfig();
  cfg.provider = provider;
  cfg.model = model;
  cfg.credentials = { ...cfg.credentials, [provider]: credentials };
  saveStoredConfig(cfg);
  return cfg;
}
