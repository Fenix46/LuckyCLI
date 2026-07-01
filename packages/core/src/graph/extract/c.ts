/**
 * C extractor.
 *
 * Same Extractor contract and conventions, adapted to C, which has no classes or
 * methods: `#include` directives become imports, named `struct`/`union`/`enum`
 * definitions (the ones with a body) become "class" nodes, top-level
 * `function_definition`s become functions, and a second pass wires the
 * intra-file call graph from `call_expression`s whose callee is a plain
 * identifier naming a function defined in the same file. A bare-identifier call
 * to a function NOT defined in this file (declared in a header, defined in
 * another translation unit) can't be resolved locally, so it's emitted as a
 * call candidate (see CallCandidate) for the whole-graph cross-file resolution
 * pass instead of being dropped. Calls through function pointers carry no
 * resolvable name at all and stay out of scope.
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

/** Collect every descendant of a given type (depth-first). */
function descendants(node: Node, type: string): Node[] {
  const out: Node[] = [];
  const visit = (n: Node): void => {
    if (n.type === type) out.push(n);
    for (const c of n.namedChildren) if (c) visit(c);
  };
  visit(node);
  return out;
}

/** The defined name of a function_definition (unwraps pointer return types). */
function functionName(funcDef: Node): string | undefined {
  const declarator = descendants(funcDef, "function_declarator")[0];
  if (!declarator) return undefined;
  const inner = declarator.childForFieldName("declarator");
  if (inner?.type === "identifier") return inner.text;
  return descendants(declarator, "identifier")[0]?.text;
}

function extractC(ctx: ExtractorContext): Extraction {
  const { path, root } = ctx;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seenNodes = new Set<string>();
  const seenEdges = new Set<string>();
  const callables = new Map<string, string>();
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
  function defineSymbol(name: string, kind: GraphNode["kind"], node: Node, qualified: string): string {
    const id = symbolId(path, qualified);
    addNode({ id, label: name, kind, sourceFile: path, sourceLocation: lineLabel(node) });
    addEdge({ source: fid, target: id, relation: "defines", confidence: "EXTRACTED" });
    return id;
  }

  // --- Pass 1: declarations --------------------------------------------------
  for (const inc of descendants(root, "preproc_include")) {
    const sys = inc.namedChildren.find((c) => c?.type === "system_lib_string");
    const str = inc.namedChildren.find((c) => c?.type === "string_literal");
    const content = str?.namedChildren.find((c) => c?.type === "string_content");
    const specifier = sys ? sys.text.replace(/^<|>$/g, "") : content?.text;
    if (specifier) {
      const mid = moduleId(specifier);
      addNode({ id: mid, label: specifier, kind: "module", sourceFile: specifier });
      addEdge({ source: fid, target: mid, relation: "imports", confidence: "EXTRACTED" });
    }
  }

  // Named aggregate types that actually carry a body (a definition, not a ref).
  for (const spec of [
    ...descendants(root, "struct_specifier"),
    ...descendants(root, "union_specifier"),
    ...descendants(root, "enum_specifier"),
  ]) {
    const hasBody = spec.namedChildren.some(
      (c) => c?.type === "field_declaration_list" || c?.type === "enumerator_list",
    );
    const name = spec.childForFieldName("name")?.text;
    if (hasBody && name) defineSymbol(name, "class", spec, name);
  }

  for (const fn of descendants(root, "function_definition")) {
    const name = functionName(fn);
    if (name) callables.set(name, defineSymbol(name, "function", fn, name));
  }

  // --- Pass 2: call graph (INFERRED `calls` between local functions) ---------
  function calls(node: Node, current: string | undefined): void {
    let next = current;
    if (node.type === "function_definition") {
      const name = functionName(node);
      if (name) next = symbolId(path, name);
    } else if (node.type === "call_expression" && current) {
      const callee = node.childForFieldName("function");
      if (callee?.type === "identifier") {
        const target = callables.get(callee.text);
        if (target && target !== current) {
          addEdge({ source: current, target, relation: "calls", confidence: "INFERRED" });
        } else if (!target) {
          // Not defined in this file — could be declared in a header and
          // defined in another translation unit. Defer to cross-file resolution.
          callCandidates.push({ callerId: current, calleeName: callee.text });
        }
      }
    }
    for (const child of node.namedChildren) if (child) calls(child, next);
  }
  calls(root, undefined);

  return { nodes, edges, ...(callCandidates.length ? { callCandidates } : {}) };
}

export const cExtractor: Extractor = { language: "c", extract: extractC };
