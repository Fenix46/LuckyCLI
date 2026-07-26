import {
  buildAndSaveGraph,
  detectSelfUpdate,
  loadStoredConfig,
  recordGraphBuilt,
  saveStoredConfig,
  withAutoUpdatePolicy,
} from "@luckycli/core";
import { applyUpdateNow, checkForUpdate, updateRows } from "../../update.js";
import { APP_VERSION } from "../components/constants.js";
import { formatNumber } from "../lib/format.js";
import { emitError, unknownCommand } from "./helpers.js";
import type { Command } from "./types.js";

/** Update/graph side effects, injectable so tests stay offline and on-disk-free. */
export interface MaintenanceCommandDeps {
  checkForUpdate: typeof checkForUpdate;
  applyUpdateNow: typeof applyUpdateNow;
  detectSelfUpdate: typeof detectSelfUpdate;
  loadConfig: typeof loadStoredConfig;
  saveConfig: typeof saveStoredConfig;
  buildGraph: typeof buildAndSaveGraph;
  recordGraphBuilt: typeof recordGraphBuilt;
}

const defaultDeps: MaintenanceCommandDeps = {
  checkForUpdate,
  applyUpdateNow,
  detectSelfUpdate,
  loadConfig: loadStoredConfig,
  saveConfig: saveStoredConfig,
  buildGraph: buildAndSaveGraph,
  recordGraphBuilt,
};

export function maintenanceCommands(deps: MaintenanceCommandDeps = defaultDeps): Command[] {
  return [
    {
      name: "/update",
      description: "Check for updates (/update apply, /update auto <mode>)",
      async run(args, ctx) {
        // `/update auto <off|notify|auto>`: set the policy in-session.
        if (args.startsWith("auto")) {
          const policy = args.slice("auto".length).trim();
          if (policy !== "off" && policy !== "notify" && policy !== "auto") {
            ctx.emit({ kind: "error", text: "usage: /update auto <off|notify|auto>" });
            return;
          }
          deps.saveConfig(withAutoUpdatePolicy(deps.loadConfig(), policy));
          ctx.emit({
            kind: "command",
            title: "Update",
            rows: [{ label: "policy", value: policy }],
          });
          return;
        }

        try {
          const info = await deps.checkForUpdate(APP_VERSION, { force: true });

          // `/update apply`: download, verify, swap, then exit cleanly. Typing
          // the subcommand is the confirmation; we never swap mid-turn silently.
          if (args === "apply") {
            if (!info.updateAvailable) {
              ctx.emit({ kind: "command", title: "Update", rows: updateRows(info) });
              return;
            }
            const result = await deps.applyUpdateNow(undefined);
            if (result.applied) {
              ctx.emit({
                kind: "command",
                title: "Updated",
                rows: [
                  { label: "version", value: info.latestVersion ?? "latest" },
                  { label: "status", value: "installed — restart lucky" },
                ],
              });
              ctx.ui.exit();
              return;
            }
            ctx.emit({
              kind: "command",
              title: "Update",
              rows: [
                { label: "status", value: `cannot self-update (${result.reason})` },
                ...(result.installCommand
                  ? [{ label: "command", value: result.installCommand }]
                  : []),
              ],
            });
            return;
          }

          // Plain `/update`: show status, and how to apply if available.
          const rows = updateRows(info);
          if (info.updateAvailable && deps.detectSelfUpdate().ok) {
            rows.push({ label: "apply", value: "run /update apply to install" });
          }
          ctx.emit({
            kind: "command",
            title: info.updateAvailable ? "Update Available" : "Update",
            rows,
          });
        } catch (error) {
          emitError(ctx, error, "failed to check for updates");
        }
      },
    },
    {
      name: "/compact",
      description: "Summarize older chat history now",
      async run(args, ctx) {
        if (args) {
          unknownCommand(ctx, `/compact ${args}`);
          return;
        }
        ctx.ui.setCompacting(true);
        try {
          // compactNow already measured the post-compaction context; reuse it
          // instead of asking again (a billed round-trip on Claude OAuth).
          const { status, ...result } = await ctx.agent.compactNow();
          ctx.ui.setContextStatus(status);
          ctx.ui.persistSession();
          ctx.emit({
            kind: "command",
            title: "Compaction",
            rows: [
              { label: "removed", value: `${result.removedMessages} messages` },
              { label: "kept", value: `${result.keptMessages} messages` },
              {
                label: "tokens",
                value:
                  result.beforeTokens !== undefined && result.afterTokens !== undefined
                    ? `${formatNumber(result.beforeTokens)} -> ${formatNumber(result.afterTokens)}`
                    : "not available",
              },
            ],
          });
        } catch (error) {
          emitError(ctx, error, "failed to compact context");
        } finally {
          ctx.ui.setCompacting(false);
        }
      },
    },
    {
      name: "/graph",
      description: "Build/refresh the project knowledge graph",
      run(args, ctx) {
        if (args && args !== "build" && args !== "rebuild") {
          unknownCommand(ctx, `/graph ${args}`);
          return;
        }
        ctx.emit({
          kind: "command",
          title: "Graph",
          rows: [{ label: "building", value: "scanning project files…" }],
        });
        // Fire-and-forget: the build runs while the session stays usable and
        // reports into the transcript when done.
        const cwd = process.cwd();
        void deps
          .buildGraph(cwd)
          .then((summary) => {
            deps.recordGraphBuilt(cwd);
            const rows = [
              { label: "files", value: String(summary.fileCount) },
              { label: "nodes", value: String(summary.nodeCount) },
              { label: "edges", value: String(summary.edgeCount) },
              { label: "saved", value: summary.path },
            ];
            if (summary.droppedEdges > 0) {
              rows.push({ label: "dropped", value: `${summary.droppedEdges} unresolved edges` });
            }
            ctx.emit({ kind: "command", title: "Graph built", rows });
          })
          .catch((err) => {
            ctx.emit({
              kind: "error",
              text: `graph build failed: ${err instanceof Error ? err.message : String(err)}`,
            });
          });
      },
    },
  ];
}
