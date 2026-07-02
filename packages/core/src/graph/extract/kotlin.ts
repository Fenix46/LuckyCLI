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
 * calls through a receiver (`obj.m()`, via navigation_expression) can't be
 * resolved locally when the receiver's type isn't a known parameter — the target
 * may be declared in another file — so they're emitted as call candidates (see
 * CallCandidate) for the whole-graph cross-file resolution pass. `this.m()` is
 * still resolved directly within the enclosing type.
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

/** First named child of the given type. */
function childOfType(node: Node, type: string): Node | undefined {
  return node.namedChildren.find((c) => c?.type === type) ?? undefined;
}

const TYPE_DECLS = new Set(["class_declaration", "object_declaration"]);

/** Declared name of a class/object/interface or function declaration. */
function declName(node: Node): string | undefined {
  return childOfType(node, "type_identifier")?.text ?? childOfType(node, "simple_identifier")?.text;
}

/** Parameter name -> declared type, e.g. `(r: Rect)` -> r: Rect. */
function paramTypes(funcDecl: Node): Map<string, string> {
  const out = new Map<string, string>();
  const params = childOfType(funcDecl, "function_value_parameters");
  for (const decl of params?.namedChildren ?? []) {
    if (decl?.type !== "parameter") continue;
    const name = childOfType(decl, "simple_identifier")?.text;
    const type = childOfType(decl, "user_type")?.text;
    if (name && type) out.set(name, type);
  }
  return out;
}

function extractKotlin(ctx: ExtractorContext): Extraction {
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
  function calls(
    node: Node,
    prefix: string,
    current: string | undefined,
    locals: Map<string, string>,
  ): void {
    let nextPrefix = prefix;
    let nextCurrent = current;
    let nextLocals = locals;
    if (TYPE_DECLS.has(node.type)) {
      const name = declName(node);
      if (name) nextPrefix = qualify(prefix, name);
    } else if (node.type === "function_declaration") {
      const name = declName(node);
      if (name) nextCurrent = symbolId(path, qualify(prefix, name));
      nextLocals = paramTypes(node);
    } else if (node.type === "call_expression" && current) {
      const callee = node.namedChildren[0];
      if (callee?.type === "simple_identifier") {
        const target = symbolId(path, qualify(prefix, callee.text));
        if (seenNodes.has(target) && target !== current) {
          addEdge({ source: current, target, relation: "calls", confidence: "INFERRED" });
        }
      } else if (callee?.type === "navigation_expression") {
        const receiver = callee.namedChildren[0];
        const suffix = childOfType(callee, "navigation_suffix");
        const name = suffix ? childOfType(suffix, "simple_identifier")?.text : undefined;
        if (name) {
          if (receiver?.type === "this_expression") {
            // this.m() — same type, resolvable locally like a bare call.
            const target = symbolId(path, qualify(prefix, name));
            if (seenNodes.has(target) && target !== current) {
              addEdge({ source: current, target, relation: "calls", confidence: "INFERRED" });
            }
          } else {
            const receiverHint =
              receiver?.type === "simple_identifier"
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

export const kotlinExtractor: Extractor = { language: "kotlin", extract: extractKotlin };
