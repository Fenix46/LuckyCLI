import { statSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadProjectConfig } from "../config/project.js";
import { collectFiles } from "./detect.js";
import { graphFilePath, tryLoadGraph } from "./store.js";
import { updateGraphForFiles, type UpdateSummary } from "./update.js";

/**
 * Code files whose graph entries are out of date: tracked files modified
 * after the graph was last written or since deleted, plus code files the
 * graph doesn't know yet. This catches what the agent's own file tools can't
 * report — edits made in the user's editor, `git pull`/`checkout`, codegen
 * and other shell commands. Returns [] when the project has no graph.
 */
export async function findStaleGraphFiles(cwd: string, signal?: AbortSignal): Promise<string[]> {
  const root = resolve(cwd);
  const graph = await tryLoadGraph(root);
  if (!graph) return [];
  let graphWrittenAt: number;
  try {
    graphWrittenAt = statSync(graphFilePath(root)).mtimeMs;
  } catch {
    return [];
  }

  const tracked = new Set<string>();
  for (const node of graph.nodes) if (node.kind === "file") tracked.add(node.sourceFile);

  const stale: string[] = [];
  for (const rel of tracked) {
    try {
      if (statSync(join(root, rel)).mtimeMs > graphWrittenAt) stale.push(rel);
    } catch {
      stale.push(rel); // deleted: the update prunes it
    }
  }
  const files = await collectFiles(root, signal, loadProjectConfig(root).graphExclusions ?? []);
  for (const file of files) if (!tracked.has(file.relPath)) stale.push(file.relPath);
  return stale;
}

/** Re-extract every stale file into the graph; null when nothing changed. */
export async function refreshGraph(cwd: string, signal?: AbortSignal): Promise<UpdateSummary | null> {
  const stale = await findStaleGraphFiles(cwd, signal);
  if (stale.length === 0) return null;
  return updateGraphForFiles(cwd, stale);
}
