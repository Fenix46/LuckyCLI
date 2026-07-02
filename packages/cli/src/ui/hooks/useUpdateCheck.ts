/**
 * Launch-time update check, extracted from App.tsx (the deferred follow-up in
 * APP_REFACTOR_PLAN.md). The decision flow lives in `runUpdateCheckFlow`, a
 * pure-ish async function taking all effects as injectable deps so tests can
 * drive every branch without network or timers; the hook is just the mount
 * effect wiring App's emit into it.
 */
import { useEffect } from "react";
import {
  type AutoUpdatePolicy,
  detectSelfUpdate,
  getAutoUpdatePolicy,
  loadStoredConfig,
} from "@luckycli/core";
import { applyUpdateNow, checkForUpdate, updateRows, type UpdateInfo } from "../../update.js";
import { APP_VERSION } from "../components/constants.js";
import type { Item } from "../lib/items.js";

export interface UpdateCheckDeps {
  /** Auto-update policy from config: "off" skips everything. */
  policy: AutoUpdatePolicy;
  /** Append transcript items (App's setItems). */
  emit: (item: Item) => void;
  /** True once the caller unmounted; suppresses late emissions. */
  isCancelled: () => boolean;
  check: () => Promise<UpdateInfo>;
  apply: (version: string) => Promise<{ applied: boolean }>;
  canSelfUpdate: () => boolean;
}

/**
 * One background update check. "auto": download+install immediately, narrating
 * progress; on any failure (or a dev runtime that can't self-update) fall
 * through to the notify banner. "notify": banner only. Failures of the check
 * itself are swallowed — /update surfaces them on demand.
 */
export async function runUpdateCheckFlow(deps: UpdateCheckDeps): Promise<void> {
  if (deps.policy === "off") return;
  let info: UpdateInfo;
  try {
    info = await deps.check();
  } catch {
    return; // background check is best-effort
  }
  if (deps.isCancelled() || !info.updateAvailable) return;

  // Swapping the on-disk binary is safe under a live session — the running
  // process keeps its loaded image — so the user only restarts to upgrade.
  if (deps.policy === "auto" && info.latestVersion && deps.canSelfUpdate()) {
    const version = info.latestVersion;
    deps.emit({
      kind: "command",
      title: "Update",
      rows: [
        { label: "version", value: version },
        { label: "status", value: "downloading in the background…" },
      ],
    });
    try {
      const result = await deps.apply(version);
      if (deps.isCancelled()) return;
      if (result.applied) {
        deps.emit({
          kind: "command",
          title: "Update installed",
          rows: [
            { label: "version", value: version },
            { label: "status", value: "restart lucky to use the new version" },
          ],
        });
        return;
      }
      // Could not self-update (dev runtime, unwritable dir): fall through.
    } catch {
      // Download/verify failed; fall through to the notify banner.
    }
  }

  if (deps.isCancelled()) return;
  deps.emit({ kind: "command", title: "Update Available", rows: updateRows(info) });
}

/** Mount-time hook: run the flow once with the real config/network deps. */
export function useUpdateCheck(emit: (item: Item) => void): void {
  useEffect(() => {
    if (process.env.LUCKY_DISABLE_UPDATE_CHECK === "1") return;
    let cancelled = false;
    void runUpdateCheckFlow({
      policy: getAutoUpdatePolicy(loadStoredConfig()),
      emit,
      isCancelled: () => cancelled,
      check: () => checkForUpdate(APP_VERSION),
      apply: applyUpdateNow,
      canSelfUpdate: () => detectSelfUpdate().ok,
    });
    return () => {
      cancelled = true;
    };
    // Mount-only by design: policy/version don't change mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
