import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import {
  assertParentPathInsideCwd,
  resolveInsideCwd,
} from "../tools/path.js";
import { CheckpointSchema, type Checkpoint, type CheckpointFile } from "./types.js";
import { readSnapshotFile } from "./snapshot.js";

export const RESTORE_POLICIES = ["abort", "force"] as const;
export type RestorePolicy = (typeof RESTORE_POLICIES)[number];

export interface RestoreConflict {
  path: string;
  reason: "modified" | "missing" | "symlink";
}

export interface RestoreResult {
  policy: RestorePolicy;
  restored: string[];
  unchanged: string[];
  conflicts: RestoreConflict[];
}

interface CurrentFile {
  existed: boolean;
  bytes?: Buffer;
  mode?: number;
  symlink: boolean;
}

/** Restore a checkpoint, refusing to clobber changes unless explicitly forced. */
export async function restoreSnapshot(
  cwd: string,
  checkpoint: Checkpoint,
  policy: RestorePolicy = "abort",
): Promise<RestoreResult> {
  CheckpointSchema.parse(checkpoint);
  if (!RESTORE_POLICIES.includes(policy)) throw new Error(`Unknown restore policy: ${policy}`);
  const root = await realpath(resolve(cwd));
  if (resolve(checkpoint.cwd) !== root) {
    throw new Error("Checkpoint belongs to a different working directory.");
  }

  const current = new Map<string, CurrentFile>();
  const conflicts: RestoreConflict[] = [];
  for (const file of checkpoint.files) {
    const state = await readCurrentFile(root, file.path);
    current.set(file.path, state);
    const conflict = await findConflict(cwd, checkpoint, file, state);
    if (conflict) conflicts.push(conflict);
  }
  if (conflicts.length > 0 && policy === "abort") {
    throw new RestoreConflictError(conflicts);
  }

  const backups = new Map<string, CurrentFile>();
  for (const [path, state] of current) backups.set(path, state);
  const restored: string[] = [];
  const unchanged: string[] = [];
  try {
    for (const file of checkpoint.files) {
      const state = current.get(file.path);
      if (!state) throw new Error(`Missing current state for file: ${file.path}`);
      if (!conflicts.some((conflict) => conflict.path === file.path) && isSameState(file, state)) {
        unchanged.push(file.path);
        continue;
      }
      await applyFile(cwd, checkpoint, file);
      restored.push(file.path);
    }
  } catch (error) {
    try {
      for (const [path, state] of backups) await restoreCurrentFile(root, path, state);
    } catch (rollbackError) {
      throw new Error(
        `Restore failed and rollback failed: ${formatError(error)}; ${formatError(rollbackError)}`,
      );
    }
    throw error;
  }

  return { policy, restored, unchanged, conflicts };
}

export class RestoreConflictError extends Error {
  readonly conflicts: RestoreConflict[];

  constructor(conflicts: RestoreConflict[]) {
    super(`Restore aborted: ${conflicts.length} file conflict(s).`);
    this.name = "RestoreConflictError";
    this.conflicts = conflicts;
  }
}

async function readCurrentFile(root: string, path: string): Promise<CurrentFile> {
  const target = resolveInsideCwd(root, path);
  await assertParentPathInsideCwd(root, path);
  try {
    const stats = await lstat(target);
    if (stats.isSymbolicLink()) return { existed: true, symlink: true };
    if (stats.isDirectory()) throw new Error(`Restore path is a directory: ${path}`);
    return {
      existed: true,
      bytes: await readFile(target),
      mode: stats.mode & 0o777,
      symlink: false,
    };
  } catch (error) {
    if (isMissing(error)) return { existed: false, symlink: false };
    throw error;
  }
}

async function findConflict(
  cwd: string,
  checkpoint: Checkpoint,
  file: CheckpointFile,
  current: CurrentFile,
): Promise<RestoreConflict | undefined> {
  if (current.symlink) return { path: file.path, reason: "symlink" };
  if (!file.existed && current.existed) return { path: file.path, reason: "modified" };
  if (file.existed && !current.existed) return { path: file.path, reason: "missing" };
  if (file.existed && current.bytes && !matches(file, current.bytes)) {
    return { path: file.path, reason: "modified" };
  }
  if (file.existed) await readSnapshotFile(cwd, checkpoint, file.path);
  return undefined;
}

function isSameState(file: CheckpointFile, current: CurrentFile): boolean {
  if (!file.existed) return !current.existed;
  return current.existed && current.bytes !== undefined && matches(file, current.bytes);
}

function matches(file: CheckpointFile, bytes: Buffer): boolean {
  return bytes.length === file.size && createHash("sha256").update(bytes).digest("hex") === file.sha256;
}

async function applyFile(cwd: string, checkpoint: Checkpoint, file: CheckpointFile): Promise<void> {
  const target = resolveInsideCwd(cwd, file.path);
  await assertParentPathInsideCwd(cwd, file.path);
  if (!file.existed) {
    await rm(target, { force: true });
    return;
  }
  const bytes = await readSnapshotFile(cwd, checkpoint, file.path);
  if (!bytes) throw new Error(`Checkpoint content is missing for file: ${file.path}`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes, { mode: file.mode ?? 0o600 });
  if (file.mode !== undefined) await chmod(target, file.mode);
}

async function restoreCurrentFile(root: string, path: string, state: CurrentFile): Promise<void> {
  const target = resolveInsideCwd(root, path);
  await assertParentPathInsideCwd(root, path);
  if (!state.existed) {
    await rm(target, { force: true });
    return;
  }
  if (state.symlink || !state.bytes) throw new Error(`Cannot rollback symlink: ${path}`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, state.bytes, { mode: state.mode ?? 0o600 });
  if (state.mode !== undefined) await chmod(target, state.mode);
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
