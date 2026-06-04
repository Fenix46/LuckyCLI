/**
 * Headless `lucky update` / `lucky upgrade`. Prints status and, with --apply,
 * self-replaces the running binary. Exits without the TUI so it works from
 * scripts and CI.
 *
 *   lucky update                      check; show status + whether self-update works
 *   lucky update --apply | -y         download, verify, and swap in the new binary
 *   lucky update --auto off|notify|auto   set the auto-update policy
 *   LUCKY_VERSION=v0.3.0 lucky update --apply   pin a specific release
 */
import {
  type AutoUpdatePolicy,
  type StoredConfig,
  detectSelfUpdate,
  getAutoUpdatePolicy,
  loadStoredConfig,
  saveStoredConfig,
  withAutoUpdatePolicy,
} from "@luckycli/core";
import { APP_VERSION } from "./ui/components/constants.js";
import { applyUpdateNow, checkForUpdate, updateRows } from "./update.js";

export interface UpdateCommandIO {
  out?: (line: string) => void;
  err?: (line: string) => void;
  /** Injected fetch for the GitHub API + asset download, for tests. */
  fetchImpl?: typeof fetch;
  /** Override the running version (tests). */
  currentVersion?: string;
  /** Config read/write overrides (tests); default to the real store. */
  loadConfig?: () => StoredConfig;
  saveConfig?: (cfg: StoredConfig) => void;
}

const POLICIES: AutoUpdatePolicy[] = ["off", "notify", "auto"];

export async function runUpdateCommand(
  args: string[],
  io: UpdateCommandIO = {},
): Promise<number> {
  const out = io.out ?? ((line) => process.stdout.write(`${line}\n`));
  const err = io.err ?? ((line) => process.stderr.write(`${line}\n`));
  const currentVersion = io.currentVersion ?? APP_VERSION;
  const loadConfig = io.loadConfig ?? loadStoredConfig;
  const saveConfig = io.saveConfig ?? saveStoredConfig;

  // `lucky update --auto <policy>`: set the preference and return.
  const autoIdx = args.indexOf("--auto");
  if (autoIdx !== -1) {
    const value = args[autoIdx + 1];
    if (!value || !POLICIES.includes(value as AutoUpdatePolicy)) {
      err(`Usage: lucky update --auto <off|notify|auto>`);
      return 1;
    }
    saveConfig(withAutoUpdatePolicy(loadConfig(), value as AutoUpdatePolicy));
    out(`Auto-update policy set to "${value}".`);
    return 0;
  }

  const apply = args.includes("--apply") || args.includes("-y");
  const versionPin = process.env.LUCKY_VERSION;

  let info: Awaited<ReturnType<typeof checkForUpdate>>;
  try {
    info = await checkForUpdate(currentVersion, { force: true });
  } catch (error) {
    err(`Update check failed: ${error instanceof Error ? error.message : error}`);
    return 1;
  }

  updateRows(info).forEach(({ label, value }) => out(`${label.padEnd(8)}  ${value}`));
  out(`policy    ${getAutoUpdatePolicy(loadConfig())}`);

  if (!info.updateAvailable && !versionPin) {
    return 0;
  }

  if (!apply) {
    const cap = detectSelfUpdate();
    out("");
    out(
      cap.ok
        ? "Run `lucky update --apply` to install it."
        : `Self-update unavailable here (${cap.reason}). ${info.installCommand ?? ""}`.trim(),
    );
    return 0;
  }

  // --apply: download, verify, swap.
  try {
    const result = await applyUpdateNow(versionPin, { fetchImpl: io.fetchImpl });
    if (result.applied) {
      const target = info.latestVersion ?? versionPin ?? "the latest version";
      out("");
      out(`Updated to ${target}. Re-run \`lucky\` to use it.`);
      return 0;
    }
    // Couldn't self-update in place — point at the manual command.
    out("");
    out(`Could not self-update (${result.reason}).`);
    if (result.installCommand) out(result.installCommand);
    return 0;
  } catch (error) {
    err(`Update failed: ${error instanceof Error ? error.message : error}`);
    return 1;
  }
}
