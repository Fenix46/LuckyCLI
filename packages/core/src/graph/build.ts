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
  type CallCandidate,
  type Graph,
  type GraphEdge,
  type GraphNode,
  assertValidGraph,
  emptyGraph,
  markExternalNodes,
  resolveCrossFileCalls,
  resolveInternalImports,
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
  const callCandidates: CallCandidate[] = [];
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
      if (extraction.callCandidates) callCandidates.push(...extraction.callCandidates);
    } catch (err) {
      skipped.push({ file: file.relPath, reason: `extract failed: ${errorMessage(err)}` });
    } finally {
      parsed.dispose();
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

  // Connect the project's own graph: rewrite relative imports (./x, ../y) to the
  // real file node they target, dropping the stub module. Then flag whatever
  // `module` nodes remain unresolved as external libraries (androidx.*, os, …),
  // so queries can separate project code from its dependencies. Order matters:
  // resolution removes internal stubs before marking, so only true externals
  // stay flagged.
  resolveInternalImports(graph);
  markExternalNodes(graph.nodes);
  // Cross-file `calls` edges (see resolveCrossFileCalls): needs every file's
  // symbols in the graph, so it runs last, once the whole project is merged.
  resolveCrossFileCalls(graph, callCandidates);
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
