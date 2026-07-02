/**
 * C# extractor.
 *
 * Same Extractor contract and conventions, adapted to C#: `using` imports,
 * `namespace` blocks (kind "module", defined in the file rather than imported,
 * and recursed into), class/struct/record/interface/enum declarations, their
 * methods (qualified by and attached to the declaring type), and an intra-file
 * call-graph second pass. A bare `invocation_expression` whose function is a
 * plain identifier (no receiver) is a call to a method of the same class, so it
 * resolves to `Type.name`; member-access calls (obj.M(), Type.M()) can't be
 * resolved locally when the receiver's type isn't a known local parameter — the
 * target may be declared in another file — so they're emitted as call
 * candidates (see CallCandidate) for the whole-graph cross-file resolution
 * pass. `this.M()` is still resolved directly within the class.
 */
import { basename } from "node:path";
import type { Node } from "web-tree-sitter";
import {
  type CallCandidate,
  type Extraction,
  type GraphEdge,
  type GraphNode,
  makeNodeId,
} from "../types.js";
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
  "struct_declaration",
  "record_declaration",
  "enum_declaration",
]);

/** Parameter name -> declared type, e.g. `(Rect r)` -> r: Rect. */
function paramTypes(params: Node | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!params) return out;
  for (const decl of params.namedChildren) {
    if (decl?.type !== "parameter") continue;
    const type = decl.childForFieldName("type")?.text;
    const name = decl.childForFieldName("name")?.text;
    if (type && name) out.set(name, type);
  }
  return out;
}

function extractCSharp(ctx: ExtractorContext): Extraction {
  const { path, root } = ctx;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seenNodes = new Set<string>();
  const seenEdges = new Set<string>();
  const callCandidates: CallCandidate[] = [];

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

  // --- Pass 1: declarations (recurses into namespaces and types) -------------
  function handleType(node: Node, parentId: string, prefix: string): void {
    const name = node.childForFieldName("name")?.text;
    if (!name) return;
    const qualified = qualify(prefix, name);
    const kind = node.type === "interface_declaration" ? "interface" : "class";
    const typeId = defineSymbol(name, kind, node, parentId, qualified);
    const body = node.childForFieldName("body");
    for (const member of body?.namedChildren ?? []) {
      if (!member) continue;
      if (member.type === "method_declaration") {
        const method = member.childForFieldName("name")?.text;
        if (method) defineSymbol(method, "method", member, typeId, qualify(qualified, method));
      } else if (TYPE_DECLS.has(member.type) || member.type === "interface_declaration") {
        handleType(member, typeId, qualified);
      }
    }
  }

  function collect(container: Node, parentId: string, prefix: string): void {
    for (const child of container.namedChildren) {
      if (!child) continue;
      if (child.type === "using_directive") {
        const spec = child.namedChildren.find(
          (c) => c?.type === "identifier" || c?.type === "qualified_name",
        );
        const specifier = spec?.text;
        if (specifier) {
          const mid = moduleId(specifier);
          addNode({ id: mid, label: specifier, kind: "module", sourceFile: specifier });
          addEdge({ source: fid, target: mid, relation: "imports", confidence: "EXTRACTED" });
        }
      } else if (
        child.type === "namespace_declaration" ||
        child.type === "file_scoped_namespace_declaration"
      ) {
        const name = child.childForFieldName("name")?.text;
        if (!name) continue;
        const qualified = qualify(prefix, name);
        const nsId = defineSymbol(name, "module", child, parentId, qualified);
        const body = child.childForFieldName("body");
        if (body) collect(body, nsId, qualified);
      } else if (TYPE_DECLS.has(child.type) || child.type === "interface_declaration") {
        handleType(child, parentId, prefix);
      }
    }
  }
  collect(root, fid, "");

  // --- Pass 2: call graph (INFERRED `calls` within a type) -------------------
  function calls(
    node: Node,
    prefix: string,
    current: string | undefined,
    locals: Map<string, string>,
  ): void {
    let nextPrefix = prefix;
    let nextCurrent = current;
    let nextLocals = locals;
    if (
      node.type === "namespace_declaration" ||
      node.type === "file_scoped_namespace_declaration" ||
      TYPE_DECLS.has(node.type) ||
      node.type === "interface_declaration"
    ) {
      const name = node.childForFieldName("name")?.text;
      if (name) nextPrefix = qualify(prefix, name);
    } else if (node.type === "method_declaration") {
      const name = node.childForFieldName("name")?.text;
      if (name) nextCurrent = symbolId(path, qualify(prefix, name));
      nextLocals = paramTypes(node.childForFieldName("parameters"));
    } else if (node.type === "invocation_expression") {
      const fn = node.childForFieldName("function");
      if (!fn || !current) {
        // fall through to children
      } else if (fn.type === "identifier") {
        const target = symbolId(path, qualify(prefix, fn.text));
        if (seenNodes.has(target) && target !== current) {
          addEdge({ source: current, target, relation: "calls", confidence: "INFERRED" });
        }
      } else if (fn.type === "member_access_expression") {
        const receiver = fn.childForFieldName("expression");
        const name = fn.childForFieldName("name")?.text;
        if (name) {
          if (receiver?.type === "this_expression") {
            // this.M() — same class, resolvable locally like a bare call.
            const target = symbolId(path, qualify(prefix, name));
            if (seenNodes.has(target) && target !== current) {
              addEdge({ source: current, target, relation: "calls", confidence: "INFERRED" });
            }
          } else {
            const receiverHint =
              receiver?.type === "identifier"
                ? (locals.get(receiver.text) ?? receiver.text)
                : undefined;
            callCandidates.push({
              callerId: current,
              calleeName: name,
              ...(receiverHint ? { receiverHint } : {}),
            });
          }
        }
      }
    }
    for (const child of node.namedChildren) if (child) calls(child, nextPrefix, nextCurrent, nextLocals);
  }
  calls(root, "", undefined, new Map());

  return { nodes, edges, ...(callCandidates.length ? { callCandidates } : {}) };
}

export const csharpExtractor: Extractor = { language: "csharp", extract: extractCSharp };
