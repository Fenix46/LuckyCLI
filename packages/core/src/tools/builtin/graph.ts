import { z } from "zod";
import {
  type GraphNode,
  type Neighbor,
  type RankedNode,
  callersOf,
  calleesOf,
  neighborsOf,
  nodesInFile,
  resolveNodes,
  summarize,
  tryLoadGraph,
} from "../../graph/index.js";
import { defineTool } from "../types.js";

const NO_GRAPH =
  "No project graph found. Run `lucky graph build` to create one in .lucky/graph/.";

/** "label (kind) — path:L42" for one node. */
function formatNode(node: GraphNode): string {
  const where = node.sourceLocation ? `${node.sourceFile}:${node.sourceLocation}` : node.sourceFile;
  return `${node.label} (${node.kind}) — ${where}`;
}

export const graphQueryTool = defineTool({
  name: "graph_query",
  description:
    "Query the project knowledge graph instead of reading files. Resolves a " +
    "symbol name, module name, or file path and returns where it is and how it " +
    "connects. Use this first to locate definitions, callers, and call targets " +
    "cheaply before opening source. Relations: 'find' (default, where a symbol " +
    "is defined), 'callers', 'callees', 'neighbors' (all links), 'file' (symbols " +
    "declared in a file path).",
  readonly: true,
  schema: z.object({
    query: z.string().describe("Symbol name, module name, or repo-relative file path."),
    relation: z
      .enum(["find", "callers", "callees", "neighbors", "file"])
      .optional()
      .describe("What to return about the query (default 'find')."),
  }),
  async execute({ query, relation = "find" }, ctx) {
    const graph = await tryLoadGraph(ctx.cwd);
    if (!graph) return { content: NO_GRAPH };

    if (relation === "file") {
      const nodes = nodesInFile(graph, query);
      return { content: list(`Symbols in ${query}`, nodes.map(formatNode)) };
    }

    const matches = resolveNodes(graph, query);
    if (matches.length === 0) {
      return { content: `No node found for "${query}".` };
    }
    if (relation === "find") {
      return { content: list(`Matches for "${query}"`, matches.map(formatNode)) };
    }

    const lines: string[] = [];
    for (const node of matches) {
      if (relation === "callers") {
        lines.push(section(`Callers of ${formatNode(node)}`, callersOf(graph, node.id).map(formatNode)));
      } else if (relation === "callees") {
        lines.push(section(`Called by ${formatNode(node)}`, calleesOf(graph, node.id).map(formatNode)));
      } else {
        lines.push(section(`Neighbors of ${formatNode(node)}`, neighborsOf(graph, node.id).map(formatNeighbor)));
      }
    }
    return { content: lines.join("\n\n") };
  },
});

export const graphOverviewTool = defineTool({
  name: "graph_overview",
  description:
    "Summarize the project knowledge graph: file/node/edge counts, the most " +
    "connected symbols ('god nodes'), and the most-imported modules. Use this to " +
    "orient yourself in an unfamiliar codebase before diving into files.",
  readonly: true,
  schema: z.object({
    limit: z
      .number()
      .int()
      .positive()
      .max(50)
      .optional()
      .describe("How many god nodes / modules to list (default 10)."),
  }),
  async execute({ limit = 10 }, ctx) {
    const graph = await tryLoadGraph(ctx.cwd);
    if (!graph) return { content: NO_GRAPH };

    const o = summarize(graph, limit);
    const kinds = Object.entries(o.kindCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([kind, count]) => `${count} ${kind}`)
      .join(", ");

    const parts = [
      `Project graph: ${o.fileCount} files, ${o.nodeCount} nodes, ${o.edgeCount} edges.`,
      `By kind: ${kinds}.`,
      section("Most connected symbols", o.godNodes.map(formatRanked)),
      section("Most imported modules", o.topModules.map(formatRanked)),
    ];
    return { content: parts.join("\n\n") };
  },
});

function formatNeighbor(n: Neighbor): string {
  const arrow = n.direction === "out" ? `${n.relation} →` : `← ${n.relation}`;
  return `${arrow} ${formatNode(n.node)}`;
}

function formatRanked(r: RankedNode): string {
  return `${formatNode(r.node)}  [${r.degree}]`;
}

function list(title: string, items: string[]): string {
  return section(title, items);
}

function section(title: string, items: string[]): string {
  if (items.length === 0) return `${title}: none.`;
  return `${title}:\n${items.map((i) => `  - ${i}`).join("\n")}`;
}
