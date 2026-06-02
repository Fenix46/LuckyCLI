/**
 * Java extractor.
 *
 * Same contract and conventions, adapted to Java: import declarations,
 * class/interface/enum declarations, their methods (qualified by and attached to
 * the declaring type), and intra-file calls. A bare `method_invocation` (no
 * receiver object) is a call to a method of the same class, so it's resolved to
 * `Class.name`; qualified calls (obj.m(), Type.m()) are left to cross-file
 * resolution and skipped.
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

function extractJava(ctx: ExtractorContext): Extraction {
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
  function handleType(node: Node, kind: GraphNode["kind"]): void {
    const name = node.childForFieldName("name")?.text;
    if (!name) return;
    const typeId = defineSymbol(name, kind, node, fid, name);
    const body = node.childForFieldName("body");
    for (const member of body?.namedChildren ?? []) {
      if (!member) continue;
      if (member.type === "method_declaration") {
        const method = member.childForFieldName("name")?.text;
        if (method) defineSymbol(method, "method", member, typeId, `${name}.${method}`);
      } else if (
        member.type === "class_declaration" ||
        member.type === "enum_declaration"
      ) {
        handleType(member, "class");
      } else if (member.type === "interface_declaration") {
        handleType(member, "interface");
      }
    }
  }

  for (const child of root.namedChildren) {
    if (!child) continue;
    switch (child.type) {
      case "import_declaration": {
        const spec = child.namedChildren.find(
          (c) => c?.type === "scoped_identifier" || c?.type === "identifier",
        );
        const specifier = spec?.text;
        if (specifier) {
          const mid = moduleId(specifier);
          addNode({ id: mid, label: specifier, kind: "module", sourceFile: specifier });
          addEdge({ source: fid, target: mid, relation: "imports", confidence: "EXTRACTED" });
        }
        break;
      }
      case "class_declaration":
      case "enum_declaration":
        handleType(child, "class");
        break;
      case "interface_declaration":
        handleType(child, "interface");
        break;
    }
  }

  // --- Pass 2: call graph (INFERRED `calls` within a class) ------------------
  function calls(node: Node, current: string | undefined, className: string | undefined): void {
    let nextCurrent = current;
    let nextClass = className;
    switch (node.type) {
      case "class_declaration":
      case "enum_declaration":
      case "interface_declaration":
        nextClass = node.childForFieldName("name")?.text ?? className;
        break;
      case "method_declaration": {
        const name = node.childForFieldName("name")?.text;
        if (name && className) nextCurrent = symbolId(path, `${className}.${name}`);
        break;
      }
      case "method_invocation": {
        const object = node.childForFieldName("object");
        const name = node.childForFieldName("name")?.text;
        if (!object && name && current && className) {
          const target = symbolId(path, `${className}.${name}`);
          if (seenNodes.has(target) && target !== current) {
            addEdge({ source: current, target, relation: "calls", confidence: "INFERRED" });
          }
        }
        break;
      }
    }
    for (const child of node.namedChildren) if (child) calls(child, nextCurrent, nextClass);
  }
  calls(root, undefined, undefined);

  return { nodes, edges };
}

export const javaExtractor: Extractor = { language: "java", extract: extractJava };
