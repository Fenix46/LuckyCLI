/**
 * HTML extractor.
 *
 * HTML is markup, not code, so this emits a structural map of what matters for
 * navigation: external resources the page pulls in — `<script src>`, `<link
 * href>`, `<img src>` — become "module" imports (defined by the file), and every
 * element carrying an `id` becomes a "symbol" anchor. That lets the agent answer
 * "what does this page load / where is element #x" by querying the graph instead
 * of scanning the markup. In-page `<a href>` navigation links are intentionally
 * skipped to avoid noise.
 */
import { basename } from "node:path";
import type { Node } from "web-tree-sitter";
import { type Extraction, type GraphEdge, type GraphNode, makeNodeId } from "../types.js";
import type { Extractor, ExtractorContext } from "./types.js";
import { lineLabel } from "./types.js";

function fileId(path: string): string {
  return makeNodeId(path);
}
function symbolId(path: string, qualifiedName: string): string {
  return makeNodeId(`${path}::${qualifiedName}`);
}
function moduleId(specifier: string): string {
  return makeNodeId(`module::${specifier}`);
}

/** Which attribute holds the external resource URL for a given tag, if any. */
const RESOURCE_ATTR: Record<string, string> = {
  script: "src",
  link: "href",
  img: "src",
  source: "src",
  iframe: "src",
};

/** Attribute name → value map for a start/self-closing tag. */
function attributes(tag: Node): Map<string, string> {
  const out = new Map<string, string>();
  for (const attr of tag.namedChildren) {
    if (attr?.type !== "attribute") continue;
    const name = attr.namedChildren.find((c) => c?.type === "attribute_name")?.text;
    const valueNode = attr.namedChildren.find(
      (c) => c?.type === "quoted_attribute_value" || c?.type === "attribute_value",
    );
    const value =
      valueNode?.namedChildren.find((c) => c?.type === "attribute_value")?.text ??
      (valueNode?.type === "attribute_value" ? valueNode.text : undefined);
    if (name && value !== undefined) out.set(name.toLowerCase(), value);
  }
  return out;
}

function extractHtml(ctx: ExtractorContext): Extraction {
  const { path, root } = ctx;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seenNodes = new Set<string>();
  const seenEdges = new Set<string>();

  const fid = fileId(path);
  nodes.push({ id: fid, label: basename(path), kind: "file", sourceFile: path });

  function addNode(node: GraphNode): boolean {
    if (seenNodes.has(node.id)) return false;
    seenNodes.add(node.id);
    nodes.push(node);
    return true;
  }
  function addEdge(edge: GraphEdge): void {
    const key = `${edge.source}->${edge.target}:${edge.relation}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push(edge);
  }

  function visit(node: Node): void {
    if (node.type === "start_tag" || node.type === "self_closing_tag") {
      const tag = node.namedChildren.find((c) => c?.type === "tag_name")?.text?.toLowerCase();
      const attrs = attributes(node);

      if (tag) {
        const resourceAttr = RESOURCE_ATTR[tag];
        const url = resourceAttr ? attrs.get(resourceAttr) : undefined;
        if (url) {
          const mid = moduleId(url);
          addNode({ id: mid, label: url, kind: "module", sourceFile: url });
          addEdge({ source: fid, target: mid, relation: "imports", confidence: "EXTRACTED" });
        }
      }

      const id = attrs.get("id");
      if (id) {
        const sid = symbolId(path, `#${id}`);
        if (addNode({ id: sid, label: id, kind: "symbol", sourceFile: path, sourceLocation: lineLabel(node) })) {
          addEdge({ source: fid, target: sid, relation: "defines", confidence: "EXTRACTED" });
        }
      }
    }
    for (const child of node.namedChildren) if (child) visit(child);
  }
  visit(root);

  return { nodes, edges };
}

export const htmlExtractor: Extractor = { language: "html", extract: extractHtml };
