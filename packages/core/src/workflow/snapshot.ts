import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import {
  assertParentPathInsideCwd,
  resolveInsideCwd,
} from "../tools/path.js";
import {
  CheckpointSchema,
  type Checkpoint,
  type CheckpointFile,
  parseCheckpoint,
} from "./types.js";

export const SNAPSHOT_FORMAT_VERSION = 1;

const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");
const EXCLUDED_TOP_LEVEL = new Set([".lucky", "node_modules"]);

export interface CreateSnapshotOptions {
  id: string;
  sessionId: string;
  title?: string;
  reason?: string;
  createdAt?: number;
}

/** Create and persist a complete pre-edit snapshot for relative file paths. */
export async function createSnapshot(
  cwd: string,
  paths: string[],
  options: CreateSnapshotOptions,
): Promise<Checkpoint> {
  const root = await realpath(resolve(cwd));
  const uniquePaths = validatePaths(paths);
  const checkpointDir = resolve(root, `.lucky/checkpoints/${options.id}`);
  await assertParentPathInsideCwd(cwd, `.lucky/checkpoints/${options.id}/manifest.json`);
  await mkdir(checkpointDir, { recursive: true });
  await assertRealPathInside(root, checkpointDir);

  const files: CheckpointFile[] = [];
  try {
    for (const path of uniquePaths) {
      files.push(await snapshotFile(root, checkpointDir, path));
    }

    const checkpoint: Checkpoint = {
      id: options.id,
      sessionId: options.sessionId,
      cwd: root,
      title: options.title ?? "Workflow checkpoint",
      ...(options.reason ? { reason: options.reason } : {}),
      createdAt: options.createdAt ?? Date.now(),
      status: "passed",
      files,
    };
    CheckpointSchema.parse(checkpoint);
    await writeJsonAtomically(
      resolve(checkpointDir, "manifest.json"),
      { version: SNAPSHOT_FORMAT_VERSION, checkpoint },
    );
    return checkpoint;
  } catch (error) {
    await rm(checkpointDir, { recursive: true, force: true });
    throw error;
  }
}

/** Load and validate a persisted snapshot manifest without reading its files. */
export async function loadSnapshot(cwd: string, id: string): Promise<Checkpoint> {
  const manifestPath = resolveInsideCwd(cwd, `.lucky/checkpoints/${id}/manifest.json`);
  await assertParentPathInsideCwd(cwd, `.lucky/checkpoints/${id}/manifest.json`);
  const raw = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  if (!isSnapshotManifest(raw)) {
    throw new Error("Invalid workflow snapshot manifest.");
  }
  return parseCheckpoint(raw.checkpoint);
}

/** Read a file's saved bytes from a validated snapshot. */
export async function readSnapshotFile(
  cwd: string,
  checkpoint: Checkpoint,
  path: string,
): Promise<Buffer | undefined> {
  const file = checkpoint.files.find((entry) => entry.path === path);
  if (!file) throw new Error(`File is not part of checkpoint: ${path}`);
  if (!file.existed || !file.contentPath) return undefined;

  const snapshotRoot = resolve(
    await realpath(resolve(cwd)),
    `.lucky/checkpoints/${checkpoint.id}`,
  );
  const contentPath = resolve(snapshotRoot, file.contentPath);
  await assertParentPathInsideCwd(
    cwd,
    `.lucky/checkpoints/${checkpoint.id}/${file.contentPath}`,
  );
  const bytes = await readFile(contentPath);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== file.sha256 || bytes.length !== file.size) {
    throw new Error(`Snapshot content is corrupt for file: ${path}`);
  }
  return bytes;
}

function validatePaths(paths: string[]): string[] {
  const unique = new Set<string>();
  for (const path of paths) {
    if (!path || path.startsWith("/") || path.includes("\\")) {
      throw new Error(`Snapshot path must be a non-empty relative path: ${path}`);
    }
    const first = path.split("/")[0] ?? "";
    if (EXCLUDED_TOP_LEVEL.has(first)) {
      throw new Error(`Snapshot path is excluded: ${path}`);
    }
    const normalized = path.split("/").filter(Boolean).join("/");
    if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
      throw new Error(`Snapshot path escapes the working directory: ${path}`);
    }
    unique.add(normalized);
  }
  return [...unique].sort();
}

async function snapshotFile(
  root: string,
  checkpointDir: string,
  path: string,
): Promise<CheckpointFile> {
  const target = resolveInsideCwd(root, path);
  await assertParentPathInsideCwd(root, path);
  let stats;
  try {
    stats = await lstat(target);
  } catch {
    return { path, existed: false, sha256: EMPTY_SHA256, size: 0 };
  }
  if (stats.isDirectory()) throw new Error(`Snapshot path is a directory: ${path}`);

  const realTarget = await realpath(target);
  await assertRealPathInside(root, realTarget);
  const bytes = await readFile(realTarget);
  const contentPath = `files/${path}`;
  const destination = resolve(checkpointDir, contentPath);
  await assertParentPathInsideCwd(root, relative(root, destination));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes, { mode: 0o600 });
  return {
    path,
    existed: true,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
    mode: stats.mode & 0o777,
    contentPath,
  };
}

async function assertRealPathInside(root: string, target: string): Promise<void> {
  const realRoot = await realpath(root);
  const realTarget = await realpath(target);
  const rel = relative(realRoot, realTarget);
  if (rel !== "" && (rel.startsWith(`..${sep}`) || rel === "..")) {
    throw new Error("Snapshot path escapes the working directory.");
  }
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    await chmod(temp, 0o600);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

function isSnapshotManifest(value: unknown): value is {
  version: number;
  checkpoint: unknown;
} {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { version?: unknown; checkpoint?: unknown };
  return candidate.version === SNAPSHOT_FORMAT_VERSION && "checkpoint" in candidate;
}
