/**
 * Incremental graph update — refresh only the files that changed.
 *
 * Ported in spirit from graphify's affected.py / watch flow: instead of
 * rebuilding the whole graph after every edit, re-extract just the touched
 * files and merge them back. This is what makes autonomous maintenance cheap —
 * the agent's file tools call it after each successful write, so the graph stays
 * current without the model having to think about it.
 *
 * For each target file we drop everything that file owned (its file/symbol nodes
 * and every edge originating from them), then re-extract it from disk. New files
 * are simply added; deleted/unparseable files are left removed. Dangling edges
 * are dropped and orphaned module nodes pruned, so the result is always valid.
 */
import { readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { PROJECT_MEMORY_DIR } from "../project-memory.js";
import { languageForPath } from "./detect.js";
import { extractorFor } from "./extract/index.js";
import { parse } from "./extract/parser.js";
import { saveGraph, tryLoadGraph } from "./store.js";
import {
  type GraphEdge,
  type GraphNode,
  assertValidGraph,
  markExternalNodes,
  resolveInternalImports,
} from "./types.js";

export interface UpdateSummary {
  /** Repo-relative files that were re-extracted. */
  updated: string[];
  /** Repo-relative files removed from the graph (deleted or unreadable). */
  removed: string[];
  nodeCount: number;
  edgeCount: number;
}

/**
 * Re-extract the given files (relative or absolute paths) into the existing
 * graph at `.lucky/graph/graph.json`. Returns null if no graph exists yet (we
 * never create one implicitly) or if none of the paths are extractable code.
 */
export async function updateGraphForFiles(
  cwd: string,
  paths: string[],
): Promise<UpdateSummary | null> {
  const graph = await tryLoadGraph(cwd);
  if (!graph) return null;

  const root = resolve(cwd);
  const memoryPrefix = `${PROJECT_MEMORY_DIR}${sep}`;
  const targets = new Set<string>();
  for (const p of paths) {
    const rel = relative(root, resolve(root, p));
    if (rel.startsWith("..")) continue; // outside the repo
    if (rel === PROJECT_MEMORY_DIR || rel.startsWith(memoryPrefix)) continue;
    if (!languageForPath(rel)) continue; // only code files affect the graph
    targets.add(rel);
  }
  if (targets.size === 0) return null;

  const oldNodeById = new Map(graph.nodes.map((n) => [n.id, n]));

  // Keep everything not owned by a target file (modules are never file-owned).
  const nodes = new Map<string, GraphNode>();
  for (const node of graph.nodes) {
    if (!targets.has(node.sourceFile)) nodes.set(node.id, node);
  }
  // Keep edges whose source isn't owned by a target file (these get re-emitted).
  const candidateEdges: GraphEdge[] = graph.edges.filter((edge) => {
    const src = oldNodeById.get(edge.source);
    return src ? !targets.has(src.sourceFile) : false;
  });

  const updated: string[] = [];
  const removed: string[] = [];
  for (const rel of targets) {
    const language = languageForPath(rel);
    const extractor = language ? extractorFor(language) : undefined;
    if (!language || !extractor) {
      removed.push(rel);
      continue;
    }
    let source: string;
    try {
      source = await readFile(join(root, rel), "utf8");
    } catch {
      removed.push(rel); // deleted or unreadable: stays removed
      continue;
    }
    let parsed: Awaited<ReturnType<typeof parse>>;
    try {
      parsed = await parse(language, source);
    } catch {
      removed.push(rel);
      continue;
    }
    try {
      const extraction = extractor.extract({ path: rel, source, root: parsed.root });
      for (const node of extraction.nodes) nodes.set(node.id, node);
      for (const edge of extraction.edges) candidateEdges.push(edge);
      updated.push(rel);
    } finally {
      parsed.dispose();
    }
  }

  // Drop dangling edges and dedup.
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const edge of candidateEdges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
    const key = `${edge.source}->${edge.target}:${edge.relation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push(edge);
  }

  graph.nodes = [...nodes.values()];
  graph.edges = edges;

  // Same passes as the full build, so an incremental update can't re-dirty the
  // graph: rewrite relative imports to real file nodes (dropping their stubs),
  // then re-flag the remaining unresolved `module` nodes as external libraries.
  resolveInternalImports(graph);
  markExternalNodes(graph.nodes);

  // Prune module nodes that no longer have any edge (no longer imported).
  const incident = new Set<string>();
  for (const edge of graph.edges) {
    incident.add(edge.source);
    incident.add(edge.target);
  }
  graph.nodes = graph.nodes.filter(
    (node) => node.kind !== "module" || incident.has(node.id),
  );

  graph.meta.builtAt = new Date().toISOString();
  graph.meta.fileCount = graph.nodes.filter((n) => n.kind === "file").length;
  assertValidGraph(graph);
  await saveGraph(cwd, graph);

  return { updated, removed, nodeCount: graph.nodes.length, edgeCount: graph.edges.length };
}
