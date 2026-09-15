import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  attachSessionCheckpoint,
  buildReviewPrompt,
  collectReviewDiff,
  createSnapshot,
  getSessionCheckpoint,
  listSessionCheckpoints,
  removeSessionCheckpoint,
  parseReviewResponse,
  restoreSnapshot,
  runVerification,
  type Checkpoint,
  type ReviewDiffResult,
  type ReviewReport,
  type RestoreConflict,
  type VerificationResult,
} from "@luckycli/core";
import { emitError, unknownCommand } from "./helpers.js";
import type { Command } from "./types.js";

const execFileAsync = promisify(execFile);

export interface WorkflowCommandDeps {
  changedFiles: (cwd: string) => Promise<string[]>;
  createSnapshot: typeof createSnapshot;
  attachCheckpoint: typeof attachSessionCheckpoint;
  listCheckpoints: typeof listSessionCheckpoints;
  getCheckpoint: typeof getSessionCheckpoint;
  removeCheckpoint: typeof removeSessionCheckpoint;
  restoreSnapshot: typeof restoreSnapshot;
  runVerification: (cwd: string, files?: string[], options?: { signal?: AbortSignal }) => Promise<VerificationResult>;
  collectReviewDiff: typeof collectReviewDiff;
  review: (diff: ReviewDiffResult, ctx: Parameters<Command["run"]>[1], signal: AbortSignal) => Promise<ReviewReport>;
}

const defaultDeps: WorkflowCommandDeps = {
  changedFiles: gitChangedFiles,
  createSnapshot,
  attachCheckpoint: attachSessionCheckpoint,
  listCheckpoints: listSessionCheckpoints,
  getCheckpoint: getSessionCheckpoint,
  removeCheckpoint: removeSessionCheckpoint,
  restoreSnapshot,
  runVerification,
  collectReviewDiff,
  review: async (diff, ctx, signal) => {
    let response = "";
    for await (const event of ctx.agent.send(buildReviewPrompt(diff), signal)) {
      if (event.type === "text") response += event.delta;
    }
    return parseReviewResponse(response, diff);
  },
};

export function workflowCommands(deps: WorkflowCommandDeps = defaultDeps): Command[] {
  let activeVerification: AbortController | undefined;
  let lastVerification: VerificationResult | undefined;
  let activeReview: AbortController | undefined;
  return [
    {
      name: "/verify",
      description: "Run the project's configured verification checks",
      async run(args, ctx) {
        if (args !== "" && args !== "last" && args !== "cancel") {
          unknownCommand(ctx, `/verify ${args}`);
          return;
        }
        if (args === "cancel") {
          if (!activeVerification) {
            ctx.emit({ kind: "error", text: "no verification run is active" });
            return;
          }
          activeVerification.abort();
          ctx.emit({ kind: "command", title: "Verification", rows: [{ label: "status", value: "cancelling" }] });
          return;
        }
        if (args === "last") {
          if (!lastVerification) {
            ctx.emit({ kind: "error", text: "no verification result is available" });
            return;
          }
          emitVerificationResult(ctx, lastVerification);
          return;
        }
        if (activeVerification) {
          ctx.emit({ kind: "error", text: "a verification run is already active" });
          return;
        }
        const controller = new AbortController();
        activeVerification = controller;
        ctx.emit({ kind: "command", title: "Verification", rows: [{ label: "status", value: "running" }] });
        try {
          lastVerification = await deps.runVerification(process.cwd(), [], { signal: controller.signal });
          emitVerificationResult(ctx, lastVerification);
        } catch (error) {
          emitError(ctx, error, "failed to run verification");
        } finally {
          activeVerification = undefined;
        }
      },
    },
    {
      name: "/review",
      description: "Review the current diff or a checkpoint",
      async run(args, ctx) {
        if (args === "cancel") {
          if (!activeReview) {
            ctx.emit({ kind: "error", text: "no review is active" });
          } else {
            activeReview.abort();
            ctx.emit({ kind: "command", title: "Review", rows: [{ label: "status", value: "cancelling" }] });
          }
          return;
        }
        if (activeReview) {
          ctx.emit({ kind: "error", text: "a review is already active" });
          return;
        }
        const source = args === "head" ? "head" as const : args === "" ? "unstaged" as const : { checkpointId: args };
        if (typeof source === "object") {
          const sessionId = ctx.state.sessionId;
          if (!sessionId || !deps.getCheckpoint(sessionId, source.checkpointId)) {
            ctx.emit({ kind: "error", text: `checkpoint "${source.checkpointId}" was not found` });
            return;
          }
        }
        const controller = new AbortController();
        activeReview = controller;
        ctx.emit({ kind: "command", title: "Review", rows: [{ label: "status", value: "running" }] });
        try {
          const diff = await deps.collectReviewDiff({ cwd: process.cwd(), source });
          if (diff.files.length === 0) {
            ctx.emit({ kind: "command", title: "Review", rows: [{ label: "status", value: "no diff available" }] });
            return;
          }
          const report = await deps.review(diff, ctx, controller.signal);
          emitReviewReport(ctx, report);
        } catch (error) {
          emitError(ctx, error, "failed to review diff");
        } finally {
          activeReview = undefined;
        }
      },
    },
    {
      name: "/checkpoint",
      description: "Save a restore point for changed files",
      async run(args, ctx) {
        const sessionId = ctx.state.sessionId;
        if (!sessionId) {
          ctx.emit({ kind: "error", text: "start a conversation before creating a checkpoint" });
          return;
        }
        const paths = args ? args.split(/\s+/).filter(Boolean) : await deps.changedFiles(process.cwd());
        if (paths.length === 0) {
          ctx.emit({ kind: "error", text: "no changed files found — provide paths after /checkpoint" });
          return;
        }
        const id = createCheckpointId();
        try {
          const checkpoint = await deps.createSnapshot(process.cwd(), paths, {
            id,
            sessionId,
            title: args ? `Before edit: ${args}` : "Before edit",
          });
          if (!deps.attachCheckpoint(sessionId, checkpoint)) {
            throw new Error("session no longer exists");
          }
          ctx.emit({
            kind: "command",
            title: "Checkpoint",
            rows: [
              { label: "id", value: checkpoint.id },
              { label: "files", value: String(checkpoint.files.length) },
              { label: "status", value: "saved" },
            ],
          });
        } catch (error) {
          emitError(ctx, error, "failed to create checkpoint");
        }
      },
    },
    {
      name: "/undo",
      description: "Restore the latest session checkpoint",
      async run(args, ctx) {
        if (args) {
          unknownCommand(ctx, `/undo ${args}`);
          return;
        }
        const sessionId = ctx.state.sessionId;
        if (!sessionId) {
          ctx.emit({ kind: "error", text: "no active session checkpoint" });
          return;
        }
        const checkpoint = deps.listCheckpoints(sessionId)[0];
        if (!checkpoint) {
          ctx.emit({ kind: "error", text: "no checkpoint found — use /checkpoint first" });
          return;
        }
        await restoreCommand(checkpoint, "undo", ctx, deps);
      },
    },
    {
      name: "/restore",
      description: "Restore a checkpoint (append force to confirm conflicts)",
      async run(args, ctx) {
        const [id, policy, ...extra] = args.split(/\s+/).filter(Boolean);
        if (!id || extra.length > 0 || (policy && policy !== "force")) {
          ctx.emit({ kind: "error", text: "usage: /restore <checkpoint-id> [force]" });
          return;
        }
        const sessionId = ctx.state.sessionId;
        if (!sessionId) {
          ctx.emit({ kind: "error", text: "no active session checkpoint" });
          return;
        }
        const checkpoint = deps.getCheckpoint(sessionId, id);
        if (!checkpoint) {
          ctx.emit({ kind: "error", text: `checkpoint "${id}" was not found` });
          return;
        }
        await restoreCommand(checkpoint, "restore", ctx, deps, policy === "force");
      },
    },
    {
      name: "/checkpoints",
      description: "List saved session checkpoints",
      hidden: true,
      run(args, ctx) {
        if (args) {
          unknownCommand(ctx, `/checkpoints ${args}`);
          return;
        }
        const sessionId = ctx.state.sessionId;
        const checkpoints = sessionId ? deps.listCheckpoints(sessionId) : [];
        ctx.emit({
          kind: "command",
          title: "Checkpoints",
          rows: checkpoints.length
            ? checkpoints.map((checkpoint) => ({
                label: checkpoint.id,
                value: `${checkpoint.files.length} files · ${new Date(checkpoint.createdAt).toISOString()}`,
              }))
            : [{ label: "none", value: "no checkpoints saved" }],
        });
      },
    },
  ];
}

function emitVerificationResult(
  ctx: Parameters<Command["run"]>[1],
  result: VerificationResult,
): void {
  ctx.emit({
    kind: "command",
    title: "Verification",
    rows: [
      { label: "status", value: result.status },
      { label: "checks", value: String(result.checks.length) },
      ...result.checks.map((check) => ({
        label: check.id,
        value: `${check.status}${check.exitCode !== undefined && check.exitCode !== null ? ` · exit ${check.exitCode}` : ""}`,
      })),
    ],
  });
}

function emitReviewReport(
  ctx: Parameters<Command["run"]>[1],
  report: ReviewReport,
): void {
  const rank: Record<ReviewReport["findings"][number]["severity"], number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4,
  };
  const findings = [...report.findings].sort((a, b) =>
    rank[a.severity] - rank[b.severity] || a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0));
  ctx.emit({
    kind: "command",
    title: "Review",
    rows: [
      { label: "status", value: report.valid ? "complete" : "unreadable" },
      { label: "summary", value: report.summary || "no findings" },
      ...findings.map((finding) => ({
        label: `${finding.severity} · ${finding.category} · ${finding.path}${finding.line ? `:${finding.line}` : ""}`,
        value: `${finding.title}${finding.outOfDiff ? " · outside diff" : ""}`,
      })),
    ],
  });
}

async function restoreCommand(
  checkpoint: Checkpoint,
  action: "undo" | "restore",
  ctx: Parameters<Command["run"]>[1],
  deps: WorkflowCommandDeps,
  force = false,
): Promise<void> {
  try {
    const result = await deps.restoreSnapshot(process.cwd(), checkpoint, force ? "force" : "abort");
    ctx.emit({
      kind: "command",
      title: action === "undo" ? "Undo" : "Restore",
      rows: [
        { label: "checkpoint", value: checkpoint.id },
        { label: "restored", value: String(result.restored.length) },
        { label: "unchanged", value: String(result.unchanged.length) },
        ...(result.conflicts.length
          ? [{ label: "conflicts", value: String(result.conflicts.length) }]
          : []),
      ],
    });
  } catch (error) {
    if (isRestoreConflictError(error)) {
      const command = `/restore ${checkpoint.id} force`;
      ctx.emit({
        kind: "command",
        title: "Restore blocked",
        rows: [
          { label: "conflicts", value: formatConflicts(error.conflicts) },
          { label: "confirm", value: `type ${command}` },
        ],
      });
      return;
    }
    emitError(ctx, error, `failed to ${action} checkpoint`);
  }
}

async function gitChangedFiles(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", cwd, "status", "--porcelain", "--untracked-files=all"],
      { maxBuffer: 256 * 1024 },
    );
    return stdout
      .split("\n")
      .map((line) => line.slice(3).trim())
      .map((path) => (path.includes(" -> ") ? path.slice(path.lastIndexOf(" -> ") + 4) : path))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function createCheckpointId(): string {
  return `checkpoint_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isRestoreConflictError(error: unknown): error is { conflicts: RestoreConflict[] } {
  return (
    error instanceof Error &&
    error.name === "RestoreConflictError" &&
    Array.isArray((error as { conflicts?: unknown }).conflicts)
  );
}

function formatConflicts(conflicts: RestoreConflict[]): string {
  return conflicts.map((conflict) => `${conflict.path} (${conflict.reason})`).join(", ");
}
