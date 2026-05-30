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
import type { ProviderCredentials, ProviderId } from "../providers/types.js";

export interface StoredConfig {
  provider?: ProviderId;
  model?: string;
  theme?: string;
  /** Saved credentials per provider, so switching doesn't re-prompt. */
  credentials?: Partial<Record<ProviderId, ProviderCredentials>>;
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
