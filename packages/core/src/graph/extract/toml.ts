/**
 * TOML extractor.
 *
 * TOML is configuration, not code, so this emits a structural map: a node per
 * top-level key, a node per `[table]` / `[[array]]` section (kind "symbol",
 * defined by the file), and a node per key inside a section (defined by the
 * section). That lets the agent navigate a config — "what sections/keys does
 * this file have" — by querying the graph instead of reading it whole.
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

/** Dotted/bare/quoted key text of a TOML key node. */
function keyName(node: Node | null | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "bare_key") return node.text;
  if (node.type === "dotted_key") {
    return node.namedChildren
      .map((c) => (c ? keyName(c) : undefined))
      .filter(Boolean)
      .join(".");
  }
  if (node.type === "quoted_key" || node.type === "string") return node.text.replace(/^['"]|['"]$/g, "");
  return undefined;
}

function extractToml(ctx: ExtractorContext): Extraction {
  const { path, root } = ctx;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  const fid = fileId(path);
  nodes.push({ id: fid, label: basename(path), kind: "file", sourceFile: path });

  function addSymbol(name: string, node: Node, parentId: string, qualified: string): string {
    const id = symbolId(path, qualified);
    if (!seen.has(id)) {
      seen.add(id);
      nodes.push({ id, label: name, kind: "symbol", sourceFile: path, sourceLocation: lineLabel(node) });
    }
    edges.push({ source: parentId, target: id, relation: "defines", confidence: "EXTRACTED" });
    return id;
  }

  function pairKey(pair: Node): { name: string; node: Node } | undefined {
    const key = pair.namedChildren[0];
    const name = keyName(key);
    return name ? { name, node: key! } : undefined;
  }

  for (const child of root.namedChildren) {
    if (!child) continue;
    if (child.type === "pair") {
      const k = pairKey(child);
      if (k) addSymbol(k.name, child, fid, k.name);
    } else if (child.type === "table" || child.type === "table_array_element") {
      const header = keyName(child.namedChildren[0]);
      if (!header) continue;
      const sectionId = addSymbol(header, child, fid, header);
      for (const pair of child.namedChildren) {
        if (pair?.type !== "pair") continue;
        const k = pairKey(pair);
        if (k) addSymbol(k.name, pair, sectionId, `${header}.${k.name}`);
      }
    }
  }

  return { nodes, edges };
}

export const tomlExtractor: Extractor = { language: "toml", extract: extractToml };
