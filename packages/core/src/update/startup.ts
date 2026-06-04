/**
 * Startup hook for the "auto" update policy: finishes an update that was staged
 * on a previous run. Called once, before anything else, so the next cold start
 * after a download swaps the new binary in — never mid-session.
 *
 * Two jobs: clear any leftover `<binary>.old` from a prior Windows swap, and, if
 * a staged binary exists and still matches its recorded checksum, swap it in and
 * forget the staging record. Anything wrong (missing file, bad checksum, swap
 * error) clears the record and is reported — it must never crash startup.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  type StoredConfig,
  loadStoredConfig,
  saveStoredConfig,
} from "../config/store.js";
import { clearStagedUpdate } from "./policy.js";
import { cleanupStaleBinary, swapInPlace } from "./self-replace.js";

export interface StagedApplyResult {
  swapped: boolean;
  version?: string;
  error?: string;
}

export function applyStagedUpdateIfAny(
  deps: {
    execPath?: string;
    loadConfig?: () => StoredConfig;
    saveConfig?: (cfg: StoredConfig) => void;
    platform?: NodeJS.Platform;
  } = {},
): StagedApplyResult {
  const execPath = deps.execPath ?? process.execPath;
  const loadConfig = deps.loadConfig ?? loadStoredConfig;
  const saveConfig = deps.saveConfig ?? saveStoredConfig;

  cleanupStaleBinary(execPath);

  const cfg = loadConfig();
  const staged = cfg.update?.staged;
  if (!staged) return { swapped: false };

  // Always clear the record once we've taken responsibility for it, so a broken
  // staged file can't wedge every future startup.
  const clear = () => saveConfig(clearStagedUpdate(loadConfig()));

  try {
    if (!existsSync(staged.path)) {
      clear();
      return { swapped: false, error: "staged binary missing" };
    }
    const actual = createHash("sha256").update(readFileSync(staged.path)).digest("hex").toLowerCase();
    if (actual !== staged.sha256.toLowerCase()) {
      clear();
      return { swapped: false, error: "staged binary failed checksum" };
    }
    swapInPlace(staged.path, execPath, deps.platform);
    clear();
    return { swapped: true, version: staged.version };
  } catch (error) {
    clear();
    return { swapped: false, error: error instanceof Error ? error.message : String(error) };
  }
}
