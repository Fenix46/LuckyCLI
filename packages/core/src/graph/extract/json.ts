/**
 * JSON extractor.
 *
 * JSON is data, not code — there are no functions, classes or calls — so this
 * emits a structural map instead: a node per top-level object key (kind
 * "symbol"), with a `defines` edge from the file. That lets the agent answer
 * "what sections does this config have" (e.g. a package.json's `scripts`,
 * `dependencies`) by querying the graph instead of reading the whole file.
 * Extraction stays at the top level to keep the node count bounded.
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

/** Text of a JSON string key (without the surrounding quotes). */
function keyText(stringNode: Node): string | undefined {
  const content = stringNode.namedChildren.find((c) => c?.type === "string_content");
  if (content) return content.text;
  return stringNode.text.replace(/^"|"$/g, "");
}

function extractJson(ctx: ExtractorContext): Extraction {
  const { path, root } = ctx;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  const fid = fileId(path);
  nodes.push({ id: fid, label: basename(path), kind: "file", sourceFile: path });

  const doc = root.namedChildren.find((c) => c?.type === "object" || c?.type === "array");
  if (doc?.type === "object") {
    for (const pair of doc.namedChildren) {
      if (pair?.type !== "pair") continue;
      const key = pair.namedChildren[0];
      const name = key && key.type === "string" ? keyText(key) : undefined;
      if (!name) continue;
      const id = symbolId(path, name);
      if (seen.has(id)) continue;
      seen.add(id);
      nodes.push({ id, label: name, kind: "symbol", sourceFile: path, sourceLocation: lineLabel(pair) });
      edges.push({ source: fid, target: id, relation: "defines", confidence: "EXTRACTED" });
    }
  }

  return { nodes, edges };
}

export const jsonExtractor: Extractor = { language: "json", extract: extractJson };
