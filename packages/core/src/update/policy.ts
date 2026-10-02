/**
 * Read/write helpers for the self-update preference and installed-release record
 * in the stored config. Functional and immutable, mirroring config/project-trust.ts:
 * each `with…` returns a new config the caller persists with saveStoredConfig.
 */
import type { AutoUpdatePolicy, InstalledUpdate, StoredConfig } from "../config/store.js";

/** The effective policy. An unset preference defaults to "auto". */
export function getAutoUpdatePolicy(cfg: StoredConfig): AutoUpdatePolicy {
  return cfg.update?.autoUpdate ?? "auto";
}

/** Return a new config with the auto-update policy set. */
export function withAutoUpdatePolicy(
  cfg: StoredConfig,
  policy: AutoUpdatePolicy,
): StoredConfig {
  return { ...cfg, update: { ...cfg.update, autoUpdate: policy } };
}

/** Return a new config recording the release self-update just installed. */
export function withInstalledUpdate(cfg: StoredConfig, installed: InstalledUpdate): StoredConfig {
  return { ...cfg, update: { ...cfg.update, installed } };
}
