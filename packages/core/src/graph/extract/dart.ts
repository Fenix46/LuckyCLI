/**
 * Dart extractor (covers Flutter — Flutter apps are Dart `.dart` files).
 *
 * Same Extractor contract and conventions, adapted to Dart: `import` directives,
 * `class`/`mixin`/`enum` definitions (abstract classes → interface) with their
 * methods, top-level functions, and an intra-file call-graph second pass. In the
 * grammar a method's body is a `function_body` *sibling* of its `method_signature`
 * (not a child), and a call is an `identifier` followed by a `selector` carrying
 * an `argument_part` — so the call pass pairs each signature with its following
 * body and matches that shape. Bare calls (`f()`) resolve to a function/method in
 * the same scope; calls through a receiver are left to cross-file resolution.
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

function childOfType(node: Node, type: string): Node | undefined {
  return node.namedChildren.find((c) => c?.type === type) ?? undefined;
}

const TYPE_DECLS = new Set(["class_definition", "mixin_declaration", "enum_declaration"]);

/** Name declared by a `function_signature` (a method or top-level function). */
function signatureName(sig: Node): string | undefined {
  return sig.childForFieldName("name")?.text ?? childOfType(sig, "identifier")?.text;
}

function extractDart(ctx: ExtractorContext): Extraction {
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

  function importUri(node: Node): string | undefined {
    const str = (function find(n: Node): Node | undefined {
      if (n.type === "string_literal") return n;
      for (const c of n.namedChildren) {
        if (!c) continue;
        const r = find(c);
        if (r) return r;
      }
      return undefined;
    })(node);
    return str?.text.replace(/^['"]|['"]$/g, "");
  }

  // --- Pass 1: declarations --------------------------------------------------
  function collect(container: Node, parentId: string, prefix: string): void {
    for (const child of container.namedChildren) {
      if (!child) continue;
      if (child.type === "import_or_export") {
        const specifier = importUri(child);
        if (specifier) {
          const mid = moduleId(specifier);
          addNode({ id: mid, label: specifier, kind: "module", sourceFile: specifier });
          addEdge({ source: fid, target: mid, relation: "imports", confidence: "EXTRACTED" });
        }
      } else if (TYPE_DECLS.has(child.type)) {
        const name = child.childForFieldName("name")?.text ?? childOfType(child, "identifier")?.text;
        if (!name) continue;
        const qualified = qualify(prefix, name);
        const kind = child.child(0)?.type === "abstract" ? "interface" : "class";
        const typeId = defineSymbol(name, kind, child, parentId, qualified);
        const body = child.childForFieldName("body") ?? childOfType(child, "class_body");
        if (body) collect(body, typeId, qualified);
      } else if (child.type === "method_signature") {
        const sig = childOfType(child, "function_signature");
        const name = sig && signatureName(sig);
        if (name) defineSymbol(name, "method", child, parentId, qualify(prefix, name));
      } else if (child.type === "function_signature") {
        const name = signatureName(child);
        if (name) {
          const kind = prefix ? "method" : "function";
          defineSymbol(name, kind, child, parentId, qualify(prefix, name));
        }
      } else if (child.type === "declaration") {
        const sig = childOfType(child, "function_signature");
        const name = sig && signatureName(sig);
        if (name) defineSymbol(name, prefix ? "method" : "function", child, parentId, qualify(prefix, name));
      }
    }
  }
  collect(root, fid, "");

  // --- Pass 2: call graph (INFERRED `calls` within the enclosing scope) ------
  /** Record bare `name(...)` calls found anywhere under `body` from `current`. */
  function walkCalls(node: Node, prefix: string, current: string): void {
    const kids = node.namedChildren;
    for (let i = 0; i < kids.length; i++) {
      const id = kids[i];
      const sel = kids[i + 1];
      if (
        id?.type === "identifier" &&
        sel?.type === "selector" &&
        childOfType(sel, "argument_part")
      ) {
        const target = symbolId(path, qualify(prefix, id.text));
        if (seenNodes.has(target) && target !== current) {
          addEdge({ source: current, target, relation: "calls", confidence: "INFERRED" });
        }
      }
    }
    for (const child of kids) if (child) walkCalls(child, prefix, current);
  }

  function callsContainer(container: Node, prefix: string): void {
    const kids = container.namedChildren;
    for (let i = 0; i < kids.length; i++) {
      const child = kids[i];
      if (!child) continue;
      if (TYPE_DECLS.has(child.type)) {
        const name = child.childForFieldName("name")?.text ?? childOfType(child, "identifier")?.text;
        const body = child.childForFieldName("body") ?? childOfType(child, "class_body");
        if (name && body) callsContainer(body, qualify(prefix, name));
      } else if (child.type === "method_signature" || child.type === "function_signature") {
        const sig = child.type === "method_signature" ? childOfType(child, "function_signature") : child;
        const name = sig && signatureName(sig);
        const body = kids[i + 1];
        if (name && body?.type === "function_body") {
          walkCalls(body, prefix, symbolId(path, qualify(prefix, name)));
        }
      }
    }
  }
  callsContainer(root, "");

  return { nodes, edges };
}

export const dartExtractor: Extractor = { language: "dart", extract: extractDart };
