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
  renameSync,
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
  /** Legacy global effort; preserved for backward compatibility. */
  reasoningEffort?: string;
  /** Legacy global thinking toggle; preserved for backward compatibility. */
  thinkingEnabled?: boolean;
  /** Provider-specific runtime settings that must not leak across providers. */
  providerSettings?: Partial<Record<ProviderId, {
    reasoningEffort?: string;
    thinkingEnabled?: boolean;
  }>>;
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

/**
 * Atomic tmp+rename write, matching session/store.ts and agents/profiles.ts.
 * config.json holds every provider's credentials, so a crash or a concurrent
 * writer (e.g. two OAuth token refreshes landing close together) must never
 * be able to leave a truncated or interleaved file — loadStoredConfig()
 * silently treats a corrupt file as "no config", which would otherwise mean
 * losing every saved credential with no error surfaced to the user.
 */
export function saveStoredConfig(cfg: StoredConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const tmp = join(CONFIG_DIR, `.config.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  try {
    chmodSync(tmp, 0o600);
  } catch {
    // best-effort on platforms without POSIX permissions
  }
  renameSync(tmp, CONFIG_FILE);
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

/** Default reasoning effort when the user hasn't picked one. */
export const DEFAULT_REASONING_EFFORT = "medium";
/** Claude Code defaults to thinking enabled unless explicitly turned off. */
export const DEFAULT_THINKING_ENABLED = true;

/** The effective reasoning effort (the stored value, or the default). */
export function getReasoningEffort(
  cfg: StoredConfig,
  provider: ProviderId,
): string {
  return cfg.providerSettings?.[provider]?.reasoningEffort ?? cfg.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
}

/** Persist a chosen reasoning effort, returning the merged config. */
export function saveReasoningEffort(
  provider: ProviderId,
  effort: string,
): StoredConfig {
  const cfg = loadStoredConfig();
  cfg.providerSettings = {
    ...cfg.providerSettings,
    [provider]: {
      ...cfg.providerSettings?.[provider],
      reasoningEffort: effort,
    },
  };
  saveStoredConfig(cfg);
  return cfg;
}

/** The effective thinking toggle (the stored value, or the default). */
export function getThinkingEnabled(
  cfg: StoredConfig,
  provider: ProviderId,
): boolean {
  return cfg.providerSettings?.[provider]?.thinkingEnabled ?? cfg.thinkingEnabled ?? DEFAULT_THINKING_ENABLED;
}

/** Persist the thinking toggle, returning the merged config. */
export function saveThinkingEnabled(
  provider: ProviderId,
  enabled: boolean,
): StoredConfig {
  const cfg = loadStoredConfig();
  cfg.providerSettings = {
    ...cfg.providerSettings,
    [provider]: {
      ...cfg.providerSettings?.[provider],
      thinkingEnabled: enabled,
    },
  };
  saveStoredConfig(cfg);
  return cfg;
}
