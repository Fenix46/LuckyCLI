/**
 * Kotlin extractor.
 *
 * Same Extractor contract and conventions, adapted to Kotlin: `import`
 * directives, `class`/`interface`/`object` declarations and their member
 * functions (qualified by and attached to the declaring type), top-level `fun`
 * (→ function), and an intra-file call-graph second pass. The grammar models
 * interfaces as a `class_declaration` led by an `interface` keyword, and exposes
 * no field names, so children are matched by type. A `call_expression` whose
 * callee is a bare `simple_identifier` resolves to a function in the same scope;
 * calls through a receiver (`obj.m()`) are left to cross-file resolution.
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

/** First named child of the given type. */
function childOfType(node: Node, type: string): Node | undefined {
  return node.namedChildren.find((c) => c?.type === type) ?? undefined;
}

const TYPE_DECLS = new Set(["class_declaration", "object_declaration"]);

/** Declared name of a class/object/interface or function declaration. */
function declName(node: Node): string | undefined {
  return childOfType(node, "type_identifier")?.text ?? childOfType(node, "simple_identifier")?.text;
}

function extractKotlin(ctx: ExtractorContext): Extraction {
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

  // --- Pass 1: declarations --------------------------------------------------
  function collect(container: Node, parentId: string, prefix: string): void {
    for (const child of container.namedChildren) {
      if (!child) continue;
      if (child.type === "import_list") {
        for (const header of child.namedChildren) {
          if (header?.type !== "import_header") continue;
          const specifier = childOfType(header, "identifier")?.text;
          if (specifier) {
            const mid = moduleId(specifier);
            addNode({ id: mid, label: specifier, kind: "module", sourceFile: specifier });
            addEdge({ source: fid, target: mid, relation: "imports", confidence: "EXTRACTED" });
          }
        }
      } else if (TYPE_DECLS.has(child.type)) {
        const name = declName(child);
        if (!name) continue;
        const qualified = qualify(prefix, name);
        const kind = child.child(0)?.type === "interface" ? "interface" : "class";
        const typeId = defineSymbol(name, kind, child, parentId, qualified);
        const body = childOfType(child, "class_body") ?? childOfType(child, "enum_class_body");
        if (body) collect(body, typeId, qualified);
      } else if (child.type === "function_declaration") {
        const name = declName(child);
        if (!name) continue;
        const kind = prefix ? "method" : "function";
        defineSymbol(name, kind, child, parentId, qualify(prefix, name));
      }
    }
  }
  collect(root, fid, "");

  // --- Pass 2: call graph (INFERRED `calls` within the enclosing scope) ------
  function calls(node: Node, prefix: string, current: string | undefined): void {
    let nextPrefix = prefix;
    let nextCurrent = current;
    if (TYPE_DECLS.has(node.type)) {
      const name = declName(node);
      if (name) nextPrefix = qualify(prefix, name);
    } else if (node.type === "function_declaration") {
      const name = declName(node);
      if (name) nextCurrent = symbolId(path, qualify(prefix, name));
    } else if (node.type === "call_expression" && current) {
      const callee = node.namedChildren[0];
      if (callee?.type === "simple_identifier") {
        const target = symbolId(path, qualify(prefix, callee.text));
        if (seenNodes.has(target) && target !== current) {
          addEdge({ source: current, target, relation: "calls", confidence: "INFERRED" });
        }
      }
    }
    for (const child of node.namedChildren) if (child) calls(child, nextPrefix, nextCurrent);
  }
  calls(root, "", undefined);

  return { nodes, edges };
}

export const kotlinExtractor: Extractor = { language: "kotlin", extract: extractKotlin };
