/**
 * On-disk persistence and basic queries for the native knowledge graph.
 *
 * The graph lives alongside project memory under the project's `.lucky/`
 * directory (see project-memory.ts), in `.lucky/graph/graph.json`. Save
 * validates before writing; load validates after reading, so a corrupt or
 * hand-edited file fails loudly instead of poisoning the agent's context.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { PROJECT_MEMORY_DIR } from "../project-memory.js";
import {
  type Graph,
  type GraphEdge,
  type GraphNode,
  assertValidGraph,
  parseGraph,
} from "./types.js";

export const GRAPH_DIR = "graph";
export const GRAPH_FILE = "graph.json";

/** Absolute path of the `.lucky/graph` directory for a project root. */
export function graphDirPath(cwd: string): string {
  return join(resolve(cwd), PROJECT_MEMORY_DIR, GRAPH_DIR);
}

/** Absolute path of the persisted graph file for a project root. */
export function graphFilePath(cwd: string): string {
  return join(graphDirPath(cwd), GRAPH_FILE);
}

/** Validate and write the graph as pretty JSON, creating dirs as needed. */
export async function saveGraph(cwd: string, graph: Graph): Promise<string> {
  assertValidGraph(graph);
  const path = graphFilePath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
  return path;
}

/**
 * Read, parse, and validate the persisted graph. Throws if the file is
 * missing, malformed, or fails referential integrity. Use {@link tryLoadGraph}
 * when absence is expected (e.g. graph not built yet).
 */
export async function loadGraph(cwd: string): Promise<Graph> {
  const raw = await readFile(graphFilePath(cwd), "utf8");
  const graph = parseGraph(JSON.parse(raw));
  assertValidGraph(graph);
  return graph;
}

/** Like {@link loadGraph} but returns null when the graph file doesn't exist. */
export async function tryLoadGraph(cwd: string): Promise<Graph | null> {
  try {
    return await loadGraph(cwd);
  } catch (err) {
    if ((err as { code?: unknown }).code === "ENOENT") return null;
    throw err;
  }
}

// --- Basic queries (richer querying lands with the graph tools slice) --------

/** The node with this id, or undefined. */
export function getNode(graph: Graph, id: string): GraphNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

/** All nodes whose label matches `label` case-insensitively. */
export function findNodesByLabel(graph: Graph, label: string): GraphNode[] {
  const needle = label.toLowerCase();
  return graph.nodes.filter((n) => n.label.toLowerCase() === needle);
}

/** All nodes declared in a given (repo-relative) source file. */
export function nodesInFile(graph: Graph, sourceFile: string): GraphNode[] {
  return graph.nodes.filter((n) => n.sourceFile === sourceFile);
}

/** Edges originating from a node id. */
export function edgesFrom(graph: Graph, id: string): GraphEdge[] {
  return graph.edges.filter((e) => e.source === id);
}

/** Edges pointing at a node id. */
export function edgesTo(graph: Graph, id: string): GraphEdge[] {
  return graph.edges.filter((e) => e.target === id);
}
