/**
 * Ruby extractor.
 *
 * Same Extractor contract and conventions, adapted to Ruby: `require` /
 * `require_relative` imports, `module` namespaces (kind "module", defined in the
 * file rather than imported), `class` definitions, their instance and singleton
 * (`def self.x`) methods, top-level `def` (→ function), and an intra-file
 * call-graph second pass. A receiver-less call (`foo`, `foo(...)`) inside a
 * class/module resolves to a method of the same enclosing scope; calls through a
 * receiver (`obj.m`, `Type.m`) are left to cross-file resolution and skipped.
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

function qualify(prefix: string, name: string): string {
  return prefix ? `${prefix}.${name}` : name;
}

/** String literal text of a require's first argument, unquoted. */
function requireArg(call: Node): string | undefined {
  const args = call.childForFieldName("arguments");
  const str = args?.namedChildren.find((c) => c?.type === "string");
  const content = str?.namedChildren.find((c) => c?.type === "string_content");
  return content?.text;
}

function extractRuby(ctx: ExtractorContext): Extraction {
  const { path, root } = ctx;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seenNodes = new Set<string>();
  const seenEdges = new Set<string>();

  const fid = fileId(path);
  addNode({ id: fid, label: basename(path), kind: "file", sourceFile: path });

  function addNode(node: GraphNode): void {
    if (seenNodes.has(node.id)) return;
    seenNodes.add(node.id);
    nodes.push(node);
  }
  function addEdge(edge: GraphEdge): void {
    const key = `${edge.source}->${edge.target}:${edge.relation}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push(edge);
  }
  function defineSymbol(
    name: string,
    kind: GraphNode["kind"],
    node: Node,
    parentId: string,
    qualified: string,
  ): string {
    const id = symbolId(path, qualified);
    addNode({ id, label: name, kind, sourceFile: path, sourceLocation: lineLabel(node) });
    addEdge({ source: parentId, target: id, relation: "defines", confidence: "EXTRACTED" });
    return id;
  }

  // --- Pass 1: declarations (recurses into modules and classes) --------------
  function collect(container: Node, parentId: string, prefix: string): void {
    for (const child of container.namedChildren) {
      if (!child) continue;
      switch (child.type) {
        case "call": {
          const method = child.childForFieldName("method")?.text;
          if (method === "require" || method === "require_relative") {
            const specifier = requireArg(child);
            if (specifier) {
              const mid = moduleId(specifier);
              addNode({ id: mid, label: specifier, kind: "module", sourceFile: specifier });
              addEdge({ source: fid, target: mid, relation: "imports", confidence: "EXTRACTED" });
            }
          }
          break;
        }
        case "module":
        case "class": {
          const name = child.childForFieldName("name")?.text;
          if (!name) break;
          const qualified = qualify(prefix, name);
          const kind = child.type === "module" ? "module" : "class";
          const id = defineSymbol(name, kind, child, parentId, qualified);
          const body = child.childForFieldName("body");
          if (body) collect(body, id, qualified);
          break;
        }
        case "method":
        case "singleton_method": {
          const name = child.childForFieldName("name")?.text;
          if (!name) break;
          // Top-level defs are functions; defs inside a class/module are methods.
          const kind = prefix ? "method" : "function";
          defineSymbol(name, kind, child, parentId, qualify(prefix, name));
          break;
        }
      }
    }
  }
  collect(root, fid, "");

  // --- Pass 2: call graph (INFERRED `calls` within the enclosing scope) ------
  function calls(node: Node, prefix: string, current: string | undefined): void {
    let nextPrefix = prefix;
    let nextCurrent = current;
    switch (node.type) {
      case "module":
      case "class": {
        const name = node.childForFieldName("name")?.text;
        if (name) nextPrefix = qualify(prefix, name);
        break;
      }
      case "method":
      case "singleton_method": {
        const name = node.childForFieldName("name")?.text;
        if (name) nextCurrent = symbolId(path, qualify(prefix, name));
        break;
      }
      case "call": {
        const receiver = node.childForFieldName("receiver");
        const name = node.childForFieldName("method")?.text;
        if (!receiver && name && current) {
          const target = symbolId(path, qualify(prefix, name));
          if (seenNodes.has(target) && target !== current) {
            addEdge({ source: current, target, relation: "calls", confidence: "INFERRED" });
          }
        }
        break;
      }
    }
    for (const child of node.namedChildren) if (child) calls(child, nextPrefix, nextCurrent);
  }
  calls(root, "", undefined);

  return { nodes, edges };
}

export const rubyExtractor: Extractor = { language: "ruby", extract: extractRuby };
