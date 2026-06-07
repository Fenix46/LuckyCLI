/**
 * Human-facing visualization of the knowledge graph — the one part of the graph
 * layer meant for a person, not the model. {@link renderGraphHtml} turns a
 * loaded {@link Graph} into a single self-contained interactive HTML page
 * (force-directed, zoom/pan/click) so the developer can explore the codebase
 * and so it makes a good demo.
 *
 * Explicitly NOT a token-saving feature: SVG/HTML are the least token-dense
 * format, so the model never reads this — it's generated on demand for the
 * human. The function is pure (no fs): the CLI handles loading/writing, this
 * just builds the string, mirroring how query.ts stays I/O-free and testable.
 *
 * The layout reuses the data model's "town vs neighbouring towns" framing from
 * types.ts: the project's own nodes are solid and coloured by kind; external
 * dependency nodes (`external: true`) are dimmed and dashed.
 */
import { summarize } from "./query.js";
import type { Graph, GraphNode } from "./types.js";

/** Colour per node kind (project's own code). Picked for contrast on a dark canvas. */
const KIND_COLORS: Record<string, string> = {
  file: "#8aa2c8",
  module: "#c8a45a",
  function: "#4fb286",
  method: "#5aa9c8",
  class: "#c85a8a",
  interface: "#9b6bc8",
  variable: "#8a8a8a",
  symbol: "#b0b0b0",
};

/** Fallback colour for any future kind not in the map above. */
const DEFAULT_KIND_COLOR = "#999999";

/** vis-network node shape per kind — files stand out as boxes, the rest as dots. */
function shapeFor(kind: string): string {
  if (kind === "file") return "box";
  if (kind === "module") return "diamond";
  return "dot";
}

/** Lower-confidence edges render fainter so EXTRACTED relations read as primary. */
const CONFIDENCE_OPACITY: Record<string, number> = {
  EXTRACTED: 1,
  INFERRED: 0.55,
  AMBIGUOUS: 0.3,
};

interface VisNode {
  id: string;
  label: string;
  title: string;
  shape: string;
  color: { background: string; border: string };
  borderWidth: number;
  shapeProperties?: { borderDashes: number[] };
  font: { color: string };
  value: number;
}

interface VisEdge {
  from: string;
  to: string;
  label: string;
  arrows: string;
  dashes: boolean;
  color: { color: string; opacity: number };
}

/** Hover tooltip for a node: kind, file, location, and external marker. */
function nodeTitle(node: GraphNode): string {
  const parts = [`${node.kind}: ${node.label}`, node.sourceFile];
  if (node.sourceLocation) parts.push(node.sourceLocation);
  if (node.external) parts.push("(external dependency)");
  return parts.join("\n");
}

/** Degree per node id, used to size nodes (busier nodes render larger). */
function degrees(graph: Graph): Map<string, number> {
  const degree = new Map<string, number>();
  for (const edge of graph.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  return degree;
}

function toVisNodes(graph: Graph): VisNode[] {
  const degree = degrees(graph);
  return graph.nodes.map((node) => {
    const base = KIND_COLORS[node.kind] ?? DEFAULT_KIND_COLOR;
    const external = node.external === true;
    return {
      id: node.id,
      label: node.label,
      title: nodeTitle(node),
      shape: shapeFor(node.kind),
      // External nodes are dimmed (muted fill, dashed border) — the "neighbouring towns".
      color: external
        ? { background: "#2b2b33", border: base }
        : { background: base, border: "#1b1b22" },
      borderWidth: external ? 1 : 2,
      ...(external ? { shapeProperties: { borderDashes: [4, 4] } } : {}),
      font: { color: external ? "#9aa" : "#f0f0f0" },
      value: (degree.get(node.id) ?? 0) + 1,
    };
  });
}

function toVisEdges(graph: Graph): VisEdge[] {
  return graph.edges.map((edge) => ({
    from: edge.source,
    to: edge.target,
    label: edge.relation,
    arrows: "to",
    dashes: edge.confidence !== "EXTRACTED",
    color: {
      color: "#6a6a78",
      opacity: CONFIDENCE_OPACITY[edge.confidence] ?? 0.5,
    },
  }));
}

/** A `kind → color` legend row list for the side panel. */
function legendRows(): string {
  return Object.entries(KIND_COLORS)
    .map(
      ([kind, color]) =>
        `<div class="legend-row"><span class="swatch" style="background:${color}"></span>${kind}</div>`,
    )
    .join("");
}

/** Build the ranked-list HTML (god nodes / top modules) for the side panel. */
function rankedList(items: { node: GraphNode; degree: number }[]): string {
  if (items.length === 0) return `<div class="muted">—</div>`;
  return items
    .map(
      (r) =>
        `<div class="rank-row"><span class="rank-label">${escapeHtml(r.node.label)}</span>` +
        `<span class="rank-degree">${r.degree}</span></div>`,
    )
    .join("");
}

/** Minimal HTML-escape for text injected into the page chrome. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** vis-network UMD build, pinned, loaded from CDN to keep the file tiny. */
const VIS_NETWORK_CDN = "https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js";

/**
 * Render a graph to a single self-contained interactive HTML document.
 * Pure: returns the HTML string; the caller writes it to disk.
 */
export function renderGraphHtml(graph: Graph): string {
  const overview = summarize(graph);
  const visNodes = toVisNodes(graph);
  const visEdges = toVisEdges(graph);

  const kindCountRows = Object.entries(overview.kindCounts)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([kind, count]) =>
        `<div class="rank-row"><span class="rank-label">${kind}</span>` +
        `<span class="rank-degree">${count}</span></div>`,
    )
    .join("");

  const builtAt = escapeHtml(graph.meta.builtAt);
  const root = escapeHtml(graph.meta.root);

  // Data is embedded as JSON; vis-network does the layout/interaction.
  const nodesJson = JSON.stringify(visNodes);
  const edgesJson = JSON.stringify(visEdges);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>LuckyCLI — knowledge graph</title>
<script src="${VIS_NETWORK_CDN}"></script>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #16161c; color: #e8e8ef;
    font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  #app { display: flex; height: 100vh; }
  #graph { flex: 1; height: 100%; }
  #panel { width: 280px; padding: 16px; overflow-y: auto; border-left: 1px solid #2a2a33;
    background: #1b1b22; }
  h1 { font-size: 15px; margin: 0 0 2px; }
  .sub { color: #8a8a96; font-size: 11px; margin-bottom: 16px; word-break: break-all; }
  .section { margin-bottom: 18px; }
  .section h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .05em;
    color: #8a8a96; margin: 0 0 8px; }
  .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; }
  .stat { background: #22222b; border-radius: 6px; padding: 8px; }
  .stat .n { font-size: 18px; font-weight: 600; }
  .stat .k { font-size: 10px; color: #8a8a96; text-transform: uppercase; }
  .legend-row, .rank-row { display: flex; align-items: center; gap: 8px; padding: 2px 0; }
  .rank-row { justify-content: space-between; }
  .rank-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
  .rank-degree { color: #8a8a96; font-variant-numeric: tabular-nums; }
  .swatch { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
  .muted { color: #6a6a78; }
</style>
</head>
<body>
<div id="app">
  <div id="graph"></div>
  <aside id="panel">
    <h1>LuckyCLI knowledge graph</h1>
    <div class="sub">${root}<br/>built ${builtAt}</div>

    <div class="section">
      <h2>Overview</h2>
      <div class="stat-grid">
        <div class="stat"><div class="n">${overview.fileCount}</div><div class="k">files</div></div>
        <div class="stat"><div class="n">${overview.nodeCount}</div><div class="k">nodes</div></div>
        <div class="stat"><div class="n">${overview.edgeCount}</div><div class="k">edges</div></div>
        <div class="stat"><div class="n">${overview.internalNodeCount}</div><div class="k">internal</div></div>
        <div class="stat"><div class="n">${overview.externalNodeCount}</div><div class="k">external</div></div>
      </div>
    </div>

    <div class="section">
      <h2>Node kinds (own code)</h2>
      ${kindCountRows || '<div class="muted">—</div>'}
    </div>

    <div class="section">
      <h2>God nodes (most connected)</h2>
      ${rankedList(overview.godNodes)}
    </div>

    <div class="section">
      <h2>Top modules (most imported)</h2>
      ${rankedList(overview.topModules)}
    </div>

    <div class="section">
      <h2>Legend</h2>
      ${legendRows()}
      <div class="legend-row" style="margin-top:6px"><span class="swatch"
        style="background:#2b2b33;border:1px dashed #c8a45a"></span>external dep</div>
    </div>
  </aside>
</div>
<script>
  const nodes = new vis.DataSet(${nodesJson});
  const edges = new vis.DataSet(${edgesJson});
  const container = document.getElementById("graph");
  const network = new vis.Network(container, { nodes, edges }, {
    nodes: { scaling: { min: 8, max: 36 }, font: { size: 12 } },
    edges: { font: { size: 9, color: "#7a7a88", strokeWidth: 0, align: "middle" },
      smooth: { type: "continuous" }, width: 0.5 },
    physics: { stabilization: { iterations: 200 },
      barnesHut: { gravitationalConstant: -8000, springLength: 120, springConstant: 0.02 } },
    interaction: { hover: true, tooltipDelay: 120, navigationButtons: true, keyboard: true },
  });
</script>
</body>
</html>
`;
}
