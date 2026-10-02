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
  versionLabel,
} from "@luckycli/core";
import {
  alreadyInstalled,
  applyUpdateNow,
  buildInstallCommand,
  checkForUpdate,
  updateRows,
  type ApplyResult,
  type UpdateInfo,
} from "../../update.js";
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
  apply: (version: string) => Promise<ApplyResult>;
  canSelfUpdate: () => boolean;
  /** Self-update already put `version` in place (see alreadyInstalled). */
  alreadyInstalled: (version: string) => boolean;
}

/**
 * One update check at launch.
 *
 * "auto": when a newer release exists, download, verify and install it right
 * away, then tell the user to restart — the running process keeps its loaded
 * image, so the swap is safe mid-session. Every outcome is reported: a failed
 * install says why and gives the manual command, and the next launch tries
 * again. "notify": banner only. A failing *check* (offline) stays silent —
 * /update surfaces it on demand.
 */
export async function runUpdateCheckFlow(deps: UpdateCheckDeps): Promise<void> {
  if (deps.policy === "off") return;
  let info: UpdateInfo;
  try {
    info = await deps.check();
  } catch {
    return; // offline or GitHub unreachable: nothing to act on
  }
  if (deps.isCancelled() || !info.updateAvailable || !info.latestVersion) return;
  const version = versionLabel(info.latestVersion);

  if (deps.policy !== "auto" || !deps.canSelfUpdate()) {
    deps.emit({ kind: "command", title: "Update Available", rows: updateRows(info) });
    return;
  }

  if (deps.alreadyInstalled(version)) {
    // We installed this release and relaunched, yet the binary still reports
    // the old version: the release is mislabeled. Reinstalling would loop.
    deps.emit({
      kind: "command",
      title: "Update",
      rows: [
        { label: "version", value: version },
        {
          label: "status",
          value: `already installed, but this binary reports ${versionLabel(info.currentVersion)} — the release build is mislabeled`,
        },
      ],
    });
    return;
  }

  deps.emit({
    kind: "command",
    title: "Update",
    rows: [
      { label: "version", value: version },
      { label: "status", value: "downloading and installing…" },
    ],
  });

  let result: ApplyResult;
  try {
    result = await deps.apply(version);
  } catch (error) {
    result = { applied: false, reason: error instanceof Error ? error.message : String(error) };
  }
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

  deps.emit({
    kind: "command",
    title: "Update failed",
    rows: [
      { label: "version", value: version },
      { label: "reason", value: result.reason ?? "unknown" },
      { label: "next", value: "lucky will retry at the next launch" },
      { label: "command", value: result.installCommand ?? buildInstallCommand(version) },
    ],
  });
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
      check: () => checkForUpdate(APP_VERSION, { fallbackToCache: true }),
      apply: (version) => applyUpdateNow(version),
      canSelfUpdate: () => detectSelfUpdate().ok,
      alreadyInstalled: (version) => alreadyInstalled(version),
    });
    return () => {
      cancelled = true;
    };
    // Mount-only by design: policy/version don't change mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
