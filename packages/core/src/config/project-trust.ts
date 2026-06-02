/**
 * Per-folder trust + graph state.
 *
 * The agent asks to trust a folder only the *first* time it opens there; once a
 * record exists (trusted or not), it never re-prompts. State lives in the global
 * config (~/.luckycli/config.json) keyed by absolute path, so it survives even
 * if the project's `.lucky/` dir is deleted.
 *
 * The decision logic is split into pure functions over a StoredConfig (easy to
 * test) and thin disk-bound wrappers that load/mutate/save.
 */
import { resolve } from "node:path";
import { type ProjectRecord, type StoredConfig, loadStoredConfig, saveStoredConfig } from "./store.js";

/** Canonical key for a folder. */
export function projectKey(path: string): string {
  return resolve(path);
}

// --- Pure helpers over a config object -------------------------------------

/** The record for a folder, if the agent has opened there before. */
export function getProjectRecord(cfg: StoredConfig, path: string): ProjectRecord | undefined {
  return cfg.projects?.[projectKey(path)];
}

/** True the first time we see a folder — i.e. when a trust prompt is due. */
export function needsTrustPrompt(cfg: StoredConfig, path: string): boolean {
  return getProjectRecord(cfg, path) === undefined;
}

/** Whether a folder is known and trusted. */
export function isProjectTrusted(cfg: StoredConfig, path: string): boolean {
  return getProjectRecord(cfg, path)?.trusted === true;
}

/** Return a new config with the folder's trust recorded (preserving firstOpenedAt). */
export function withProjectTrust(
  cfg: StoredConfig,
  path: string,
  trusted: boolean,
  now = new Date().toISOString(),
): StoredConfig {
  const key = projectKey(path);
  const existing = cfg.projects?.[key];
  const record: ProjectRecord = {
    trusted,
    firstOpenedAt: existing?.firstOpenedAt ?? now,
    ...(existing?.graphBuiltAt ? { graphBuiltAt: existing.graphBuiltAt } : {}),
  };
  return { ...cfg, projects: { ...cfg.projects, [key]: record } };
}

/** Return a new config stamping the folder's last graph build time. */
export function withGraphBuilt(
  cfg: StoredConfig,
  path: string,
  now = new Date().toISOString(),
): StoredConfig {
  const key = projectKey(path);
  const existing = cfg.projects?.[key];
  const record: ProjectRecord = {
    trusted: existing?.trusted ?? true,
    firstOpenedAt: existing?.firstOpenedAt ?? now,
    graphBuiltAt: now,
  };
  return { ...cfg, projects: { ...cfg.projects, [key]: record } };
}

// --- Disk-bound wrappers ----------------------------------------------------

/** Whether the folder is new (a trust prompt is due) per the saved config. */
export function projectNeedsTrustPrompt(path: string): boolean {
  return needsTrustPrompt(loadStoredConfig(), path);
}

/** Persist the user's trust decision for a folder. */
export function recordProjectTrust(path: string, trusted: boolean): void {
  saveStoredConfig(withProjectTrust(loadStoredConfig(), path, trusted));
}

/** Persist that the folder's graph was just (re)built. */
export function recordGraphBuilt(path: string): void {
  saveStoredConfig(withGraphBuilt(loadStoredConfig(), path));
}
