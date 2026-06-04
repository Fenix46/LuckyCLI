/**
 * Read/write helpers for the self-update preference and staged-binary record in
 * the stored config. Functional and immutable, mirroring config/project-trust.ts:
 * each `with…` returns a new config the caller persists with saveStoredConfig.
 */
import type { AutoUpdatePolicy, StagedUpdate, StoredConfig } from "../config/store.js";

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

/** Return a new config carrying a staged (verified) update. */
export function withStagedUpdate(cfg: StoredConfig, staged: StagedUpdate): StoredConfig {
  return { ...cfg, update: { ...cfg.update, staged } };
}

/** Return a new config with any staged update cleared. */
export function clearStagedUpdate(cfg: StoredConfig): StoredConfig {
  if (!cfg.update?.staged) return cfg;
  const { staged: _staged, ...rest } = cfg.update;
  return { ...cfg, update: rest };
}
