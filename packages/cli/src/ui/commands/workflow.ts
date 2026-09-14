import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  attachSessionCheckpoint,
  createSnapshot,
  getSessionCheckpoint,
  listSessionCheckpoints,
  removeSessionCheckpoint,
  restoreSnapshot,
  type Checkpoint,
  type RestoreConflict,
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
}

const defaultDeps: WorkflowCommandDeps = {
  changedFiles: gitChangedFiles,
  createSnapshot,
  attachCheckpoint: attachSessionCheckpoint,
  listCheckpoints: listSessionCheckpoints,
  getCheckpoint: getSessionCheckpoint,
  removeCheckpoint: removeSessionCheckpoint,
  restoreSnapshot,
};

export function workflowCommands(deps: WorkflowCommandDeps = defaultDeps): Command[] {
  return [
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
