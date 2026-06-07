/**
 * Build pipeline: detect → extract → assemble → persist.
 *
 * Ported from graphify's build stage (detect.collect_files → per-file
 * extraction → build_graph): walk the project, run each file's extractor, then
 * merge all extractions into one graph. Two graphify behaviours are preserved:
 *   - node ids are idempotent across files (the same module/symbol id collapses
 *     to one node), and
 *   - edges whose endpoints don't resolve to a real node are dropped, so a
 *     `calls`/`imports` edge to something outside the graph never dangles.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { collectFiles } from "./detect.js";
import { extractorFor } from "./extract/index.js";
import { parse } from "./extract/parser.js";
import { saveGraph } from "./store.js";
import {
  type Graph,
  type GraphEdge,
  type GraphNode,
  assertValidGraph,
  emptyGraph,
} from "./types.js";

export interface BuildProgress {
  /** Repo-relative path being processed. */
  file: string;
  /** 1-based index of this file. */
  index: number;
  /** Total files to process. */
  total: number;
}

export interface BuildOptions {
  signal?: AbortSignal;
  onProgress?: (progress: BuildProgress) => void;
}

export interface GraphBuildSummary {
  graph: Graph;
  fileCount: number;
  nodeCount: number;
  edgeCount: number;
  /** Edges discarded because an endpoint had no matching node. */
  droppedEdges: number;
  /** Files skipped, with why (parse/read failure). */
  skipped: { file: string; reason: string }[];
}

/** Build the project graph in memory without persisting it. */
export async function buildGraph(cwd: string, options: BuildOptions = {}): Promise<GraphBuildSummary> {
  const root = resolve(cwd);
  const files = await collectFiles(root, options.signal);

  const nodes = new Map<string, GraphNode>();
  const rawEdges: GraphEdge[] = [];
  const skipped: { file: string; reason: string }[] = [];

  let index = 0;
  for (const file of files) {
    if (options.signal?.aborted) break;
    index += 1;
    options.onProgress?.({ file: file.relPath, index, total: files.length });

    const extractor = extractorFor(file.language);
    if (!extractor) continue;

    let source: string;
    try {
      source = await readFile(file.absPath, "utf8");
    } catch (err) {
      skipped.push({ file: file.relPath, reason: `read failed: ${errorMessage(err)}` });
      continue;
    }

    let parsed: Awaited<ReturnType<typeof parse>>;
    try {
      parsed = await parse(file.language, source);
    } catch (err) {
      skipped.push({ file: file.relPath, reason: `parse failed: ${errorMessage(err)}` });
      continue;
    }
    try {
      const extraction = extractor.extract({ path: file.relPath, source, root: parsed.root });
      for (const node of extraction.nodes) nodes.set(node.id, node);
      rawEdges.push(...extraction.edges);
    } catch (err) {
      skipped.push({ file: file.relPath, reason: `extract failed: ${errorMessage(err)}` });
    } finally {
      parsed.dispose();
    }
  }

  // Mark external dependency nodes. Extractors emit a `module` node per import
  // without knowing whether the target is a repo file or a third-party library —
  // they only ever see one file at a time. Here we finally know the full set of
  // real project files, so a `module` whose sourceFile isn't one of them is an
  // external library (androidx.*, react, os, …). We keep it but flag it
  // `external: true` so queries can separate the project's own graph from its
  // dependencies instead of drowning in import noise.
  const projectFiles = new Set(files.map((f) => f.relPath));
  for (const node of nodes.values()) {
    if (node.kind === "module" && !projectFiles.has(node.sourceFile)) {
      node.external = true;
    }
  }

  // Drop dangling edges (endpoint not a real node) and dedup, like build_graph.
  const seenEdges = new Set<string>();
  const edges: GraphEdge[] = [];
  let droppedEdges = 0;
  for (const edge of rawEdges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) {
      droppedEdges += 1;
      continue;
    }
    const key = `${edge.source}->${edge.target}:${edge.relation}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edges.push(edge);
  }

  const graph = emptyGraph(root);
  graph.meta.fileCount = files.length;
  graph.nodes = [...nodes.values()];
  graph.edges = edges;
  assertValidGraph(graph);

  return {
    graph,
    fileCount: files.length,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    droppedEdges,
    skipped,
  };
}

/** Build the project graph and persist it to `.lucky/graph/graph.json`. */
export async function buildAndSaveGraph(
  cwd: string,
  options: BuildOptions = {},
): Promise<GraphBuildSummary & { path: string }> {
  const summary = await buildGraph(cwd, options);
  const path = await saveGraph(cwd, summary.graph);
  return { ...summary, path };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
