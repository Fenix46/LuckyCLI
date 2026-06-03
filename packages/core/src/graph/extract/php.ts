/**
 * PHP extractor.
 *
 * Same Extractor contract and conventions, adapted to PHP: `use` imports,
 * `namespace` blocks (kind "module", defined in the file rather than imported —
 * both the braced form and the bare `namespace X;` form that scopes the rest of
 * the file), class/interface/trait/enum declarations, their methods (qualified
 * by and attached to the declaring type), top-level `function` (→ function), and
 * an intra-file call-graph second pass. `$this->m()` resolves to a method of the
 * enclosing class and a bare `f()` to a top-level function in the same
 * namespace; static/other-object calls are left to cross-file resolution.
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

const TYPE_DECLS = new Set([
  "class_declaration",
  "trait_declaration",
  "enum_declaration",
]);

/** namespace_definition's declaration body, if it's the braced form. */
function namespaceBody(node: Node): Node | undefined {
  const body = node.childForFieldName("body");
  return body?.namedChildren.length ? body : undefined;
}

function extractPhp(ctx: ExtractorContext): Extraction {
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

  function descendants(node: Node, type: string): Node[] {
    const out: Node[] = [];
    const visit = (n: Node): void => {
      if (n.type === type) out.push(n);
      for (const c of n.namedChildren) if (c) visit(c);
    };
    visit(node);
    return out;
  }

  // --- Pass 1: declarations --------------------------------------------------
  function handleType(node: Node, kind: GraphNode["kind"], parentId: string, prefix: string): void {
    const name = node.childForFieldName("name")?.text;
    if (!name) return;
    const qualified = qualify(prefix, name);
    const typeId = defineSymbol(name, kind, node, parentId, qualified);
    const body = node.childForFieldName("body");
    for (const member of body?.namedChildren ?? []) {
      if (member?.type === "method_declaration") {
        const method = member.childForFieldName("name")?.text;
        if (method) defineSymbol(method, "method", member, typeId, qualify(qualified, method));
      }
    }
  }

  function collect(children: readonly (Node | null)[], parentId: string, basePrefix: string): void {
    let prefix = basePrefix;
    let parent = parentId;
    for (const child of children) {
      if (!child) continue;
      switch (child.type) {
        case "namespace_definition": {
          const name = child.childForFieldName("name")?.text;
          if (!name) break;
          const qualified = qualify(basePrefix, name);
          const nsId = defineSymbol(name, "module", child, parentId, qualified);
          const body = namespaceBody(child);
          if (body) {
            collect(body.namedChildren, nsId, qualified); // braced namespace
          } else {
            prefix = qualified; // bare `namespace X;` scopes the rest of the file
            parent = nsId;
          }
          break;
        }
        case "namespace_use_declaration": {
          for (const qn of descendants(child, "qualified_name")) {
            const specifier = qn.text;
            if (!specifier) continue;
            const mid = moduleId(specifier);
            addNode({ id: mid, label: specifier, kind: "module", sourceFile: specifier });
            addEdge({ source: fid, target: mid, relation: "imports", confidence: "EXTRACTED" });
          }
          break;
        }
        case "interface_declaration":
          handleType(child, "interface", parent, prefix);
          break;
        case "class_declaration":
        case "trait_declaration":
        case "enum_declaration":
          handleType(child, "class", parent, prefix);
          break;
        case "function_definition": {
          const name = child.childForFieldName("name")?.text;
          if (name) defineSymbol(name, "function", child, parent, qualify(prefix, name));
          break;
        }
      }
    }
  }
  collect(root.namedChildren, fid, "");

  // --- Pass 2: call graph (INFERRED `calls`) ---------------------------------
  /** Walk a method/function body, recording calls from `current`. */
  function walkBody(
    node: Node,
    nsPrefix: string,
    classPrefix: string | undefined,
    current: string,
  ): void {
    if (node.type === "member_call_expression") {
      const object = node.childForFieldName("object");
      const name = node.childForFieldName("name")?.text;
      if (classPrefix && name && object?.type === "variable_name" && object.text === "$this") {
        const target = symbolId(path, qualify(classPrefix, name));
        if (seenNodes.has(target) && target !== current) {
          addEdge({ source: current, target, relation: "calls", confidence: "INFERRED" });
        }
      }
    } else if (node.type === "function_call_expression") {
      const fn = node.childForFieldName("function");
      if (fn?.type === "name") {
        const target = symbolId(path, qualify(nsPrefix, fn.text));
        if (seenNodes.has(target) && target !== current) {
          addEdge({ source: current, target, relation: "calls", confidence: "INFERRED" });
        }
      }
    }
    for (const child of node.namedChildren) {
      if (child) walkBody(child, nsPrefix, classPrefix, current);
    }
  }

  function callsTop(children: readonly (Node | null)[], basePrefix: string): void {
    let prefix = basePrefix;
    for (const child of children) {
      if (!child) continue;
      switch (child.type) {
        case "namespace_definition": {
          const name = child.childForFieldName("name")?.text;
          if (!name) break;
          const qualified = qualify(basePrefix, name);
          const body = namespaceBody(child);
          if (body) callsTop(body.namedChildren, qualified);
          else prefix = qualified;
          break;
        }
        case "interface_declaration":
        case "class_declaration":
        case "trait_declaration":
        case "enum_declaration": {
          const name = child.childForFieldName("name")?.text;
          if (!name) break;
          const classPrefix = qualify(prefix, name);
          const body = child.childForFieldName("body");
          for (const member of body?.namedChildren ?? []) {
            if (member?.type !== "method_declaration") continue;
            const method = member.childForFieldName("name")?.text;
            if (method) walkBody(member, prefix, classPrefix, symbolId(path, qualify(classPrefix, method)));
          }
          break;
        }
        case "function_definition": {
          const name = child.childForFieldName("name")?.text;
          if (name) walkBody(child, prefix, undefined, symbolId(path, qualify(prefix, name)));
          break;
        }
      }
    }
  }
  callsTop(root.namedChildren, "");

  return { nodes, edges };
}

export const phpExtractor: Extractor = { language: "php", extract: extractPhp };
