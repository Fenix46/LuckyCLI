/**
 * Go extractor.
 *
 * Same Extractor contract and conventions as the other languages, adapted to
 * Go's grammar: package imports, `func` (top-level) and methods (a `func` with a
 * receiver, qualified by its receiver type), `type` declarations for structs
 * (→ class) and interfaces (with their method specs), and an intra-file
 * call-graph second pass. Calls through a selector (pkg.Fn, recv.Method) are
 * left to cross-file resolution and skipped here.
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

/** Collect every descendant of a given type. */
function descendants(node: Node, type: string): Node[] {
  const out: Node[] = [];
  const visit = (n: Node): void => {
    if (n.type === type) out.push(n);
    for (const child of n.namedChildren) if (child) visit(child);
  };
  visit(node);
  return out;
}

function stripQuotes(text: string): string {
  return text.replace(/^[`"]|[`"]$/g, "");
}

/** Receiver type name of a method (handles pointer receivers `*T`). */
function receiverType(method: Node): string | undefined {
  const recv = method.namedChildren.find((c) => c?.type === "parameter_list");
  if (!recv) return undefined;
  return descendants(recv, "type_identifier")[0]?.text;
}

function extractGo(ctx: ExtractorContext): Extraction {
  const { path, root } = ctx;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seenNodes = new Set<string>();
  const seenEdges = new Set<string>();
  const callables = new Map<string, string>();

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

  // --- Pass 1: declarations --------------------------------------------------
  for (const child of root.namedChildren) {
    if (!child) continue;
    switch (child.type) {
      case "import_declaration": {
        for (const spec of descendants(child, "import_spec")) {
          const lit = spec.namedChildren.find(
            (c) => c?.type === "interpreted_string_literal" || c?.type === "raw_string_literal",
          );
          const specifier = lit ? stripQuotes(lit.text) : undefined;
          if (specifier) {
            const mid = moduleId(specifier);
            addNode({ id: mid, label: specifier, kind: "module", sourceFile: specifier });
            addEdge({ source: fid, target: mid, relation: "imports", confidence: "EXTRACTED" });
          }
        }
        break;
      }
      case "type_declaration": {
        for (const spec of child.namedChildren) {
          if (spec?.type !== "type_spec") continue;
          const name = spec.childForFieldName("name")?.text;
          if (!name) continue;
          const body = spec.namedChildren.find(
            (c) => c?.type === "interface_type" || c?.type === "struct_type",
          );
          if (body?.type === "interface_type") {
            const ifaceId = defineSymbol(name, "interface", spec, fid, name);
            for (const m of descendants(body, "method_spec")) {
              const method = m.childForFieldName("name")?.text;
              if (method) defineSymbol(method, "method", m, ifaceId, `${name}.${method}`);
            }
          } else {
            defineSymbol(name, "class", spec, fid, name); // struct (or other named type)
          }
        }
        break;
      }
      case "function_declaration": {
        const name = child.childForFieldName("name")?.text;
        if (name) callables.set(name, defineSymbol(name, "function", child, fid, name));
        break;
      }
      case "method_declaration": {
        const name = child.childForFieldName("name")?.text;
        const recv = receiverType(child);
        if (name && recv) {
          defineSymbol(name, "method", child, symbolId(path, recv), `${recv}.${name}`);
        }
        break;
      }
    }
  }

  // --- Pass 2: call graph (INFERRED `calls` between local symbols) -----------
  function calls(node: Node, enclosing: string | undefined): void {
    let current = enclosing;
    if (node.type === "function_declaration") {
      const name = node.childForFieldName("name")?.text;
      if (name) current = symbolId(path, name);
    } else if (node.type === "method_declaration") {
      const name = node.childForFieldName("name")?.text;
      const recv = receiverType(node);
      if (name && recv) current = symbolId(path, `${recv}.${name}`);
    } else if (node.type === "call_expression" && current) {
      const callee = node.childForFieldName("function");
      if (callee?.type === "identifier") {
        const target = callables.get(callee.text);
        if (target && target !== current) {
          addEdge({ source: current, target, relation: "calls", confidence: "INFERRED" });
        }
      }
    }
    for (const child of node.namedChildren) if (child) calls(child, current);
  }
  calls(root, undefined);

  return { nodes, edges };
}

export const goExtractor: Extractor = { language: "go", extract: extractGo };
