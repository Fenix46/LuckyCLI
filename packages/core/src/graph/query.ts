/**
 * Pure query helpers over a loaded graph — the read side that lets the agent
 * answer "where is X / who calls Y / what does this project look like" without
 * re-reading source files. Kept separate from the tool wrappers so the graph
 * traversal is unit-testable on its own.
 *
 * The overview distills graphify's report/analyze "god node" idea (most-
 * connected nodes) without the heavy clustering — enough to orient the agent.
 */
import { edgesFrom, edgesTo, getNode } from "./store.js";
import type { Graph, GraphNode } from "./types.js";

/** Resolve a free-text query to nodes: exact id, then label, then file path. */
export function resolveNodes(graph: Graph, query: string): GraphNode[] {
  const byId = getNode(graph, query);
  if (byId) return [byId];
  const needle = query.toLowerCase();
  const byLabel = graph.nodes.filter((n) => n.label.toLowerCase() === needle);
  if (byLabel.length > 0) return byLabel;
  return graph.nodes.filter((n) => n.sourceFile === query);
}

/** Nodes that call `id` (incoming `calls` edges). */
export function callersOf(graph: Graph, id: string): GraphNode[] {
  return nodesFor(graph, edgesTo(graph, id).filter((e) => e.relation === "calls").map((e) => e.source));
}

/** Nodes `id` calls (outgoing `calls` edges). */
export function calleesOf(graph: Graph, id: string): GraphNode[] {
  return nodesFor(graph, edgesFrom(graph, id).filter((e) => e.relation === "calls").map((e) => e.target));
}

export interface Neighbor {
  node: GraphNode;
  relation: string;
  direction: "out" | "in";
}

/** Every edge touching `id`, as resolved neighbour nodes with direction. */
export function neighborsOf(graph: Graph, id: string): Neighbor[] {
  const out: Neighbor[] = [];
  for (const edge of edgesFrom(graph, id)) {
    const node = getNode(graph, edge.target);
    if (node) out.push({ node, relation: edge.relation, direction: "out" });
  }
  for (const edge of edgesTo(graph, id)) {
    const node = getNode(graph, edge.source);
    if (node) out.push({ node, relation: edge.relation, direction: "in" });
  }
  return out;
}

/** Total degree (edges where the node is an endpoint) for every node. */
function degrees(graph: Graph): Map<string, number> {
  const degree = new Map<string, number>();
  for (const edge of graph.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  return degree;
}

export interface RankedNode {
  node: GraphNode;
  degree: number;
}

/** The most-connected non-file, non-module nodes ("god nodes"). */
export function godNodes(graph: Graph, limit = 10): RankedNode[] {
  const degree = degrees(graph);
  return graph.nodes
    .filter((n) => n.kind !== "file" && n.kind !== "module")
    .map((node) => ({ node, degree: degree.get(node.id) ?? 0 }))
    .filter((r) => r.degree > 0)
    .sort((a, b) => b.degree - a.degree || a.node.label.localeCompare(b.node.label))
    .slice(0, limit);
}

/** The most-imported modules (incoming `imports` edges). */
export function topModules(graph: Graph, limit = 10): RankedNode[] {
  const counts = new Map<string, number>();
  for (const edge of graph.edges) {
    if (edge.relation === "imports") counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1);
  }
  return graph.nodes
    .filter((n) => n.kind === "module")
    .map((node) => ({ node, degree: counts.get(node.id) ?? 0 }))
    .filter((r) => r.degree > 0)
    .sort((a, b) => b.degree - a.degree || a.node.label.localeCompare(b.node.label))
    .slice(0, limit);
}

export interface GraphOverview {
  fileCount: number;
  nodeCount: number;
  edgeCount: number;
  kindCounts: Record<string, number>;
  godNodes: RankedNode[];
  topModules: RankedNode[];
}

/** A compact, structured summary of the whole graph. */
export function summarize(graph: Graph, limit = 10): GraphOverview {
  const kindCounts: Record<string, number> = {};
  for (const node of graph.nodes) kindCounts[node.kind] = (kindCounts[node.kind] ?? 0) + 1;
  return {
    fileCount: graph.meta.fileCount,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    kindCounts,
    godNodes: godNodes(graph, limit),
    topModules: topModules(graph, limit),
  };
}

function nodesFor(graph: Graph, ids: string[]): GraphNode[] {
  const out: GraphNode[] = [];
  for (const id of ids) {
    const node = getNode(graph, id);
    if (node) out.push(node);
  }
  return out;
}
