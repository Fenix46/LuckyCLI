/**
 * Rust extractor.
 *
 * Same contract and conventions, adapted to Rust: `use` imports, `fn`
 * (function_item) top-level or inside an `impl` (method, qualified by and
 * attached to the implementing type), `struct`/`enum` (→ class), `trait`
 * (→ interface, with its signature methods), `mod` (recursed into), and
 * intra-file calls. Method/associated calls via `self.x()` or `Type::x()`
 * (field/scoped expressions) can't be resolved locally — the target may be
 * defined in another file/module — so they're emitted as call candidates
 * (see CallCandidate) for the whole-graph cross-file resolution pass.
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

function extractRust(ctx: ExtractorContext): Extraction {
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

  // --- Pass 1: declarations (recurses into modules) --------------------------
  function collectItems(container: Node): void {
    for (const child of container.namedChildren) {
      if (!child) continue;
      switch (child.type) {
        case "use_declaration": {
          const arg = child.childForFieldName("argument") ?? child.namedChildren[0];
          const specifier = arg?.text;
          if (specifier) {
            const mid = moduleId(specifier);
            addNode({ id: mid, label: specifier, kind: "module", sourceFile: specifier });
            addEdge({ source: fid, target: mid, relation: "imports", confidence: "EXTRACTED" });
          }
          break;
        }
        case "struct_item":
        case "enum_item":
        case "union_item": {
          const name = child.childForFieldName("name")?.text;
          if (name) defineSymbol(name, "class", child, fid, name);
          break;
        }
        case "trait_item": {
          const name = child.childForFieldName("name")?.text;
          if (name) {
            const traitId = defineSymbol(name, "interface", child, fid, name);
            const body = child.childForFieldName("body");
            for (const m of body?.namedChildren ?? []) {
              if (m?.type !== "function_signature_item" && m?.type !== "function_item") continue;
              const method = m.childForFieldName("name")?.text;
              if (method) defineSymbol(method, "method", m, traitId, `${name}.${method}`);
            }
          }
          break;
        }
        case "impl_item": {
          const typeName = child.childForFieldName("type")?.text;
          const body = child.childForFieldName("body");
          if (typeName) {
            for (const m of body?.namedChildren ?? []) {
              if (m?.type !== "function_item") continue;
              const method = m.childForFieldName("name")?.text;
              if (method) defineSymbol(method, "method", m, symbolId(path, typeName), `${typeName}.${method}`);
            }
          }
          break;
        }
        case "function_item": {
          const name = child.childForFieldName("name")?.text;
          if (name) callables.set(name, defineSymbol(name, "function", child, fid, name));
          break;
        }
        case "mod_item": {
          const body = child.childForFieldName("body");
          if (body) collectItems(body);
          break;
        }
      }
    }
  }
  collectItems(root);

  // --- Pass 2: call graph (INFERRED `calls` between local symbols) -----------
  // `implType` tracks the type of the *nearest enclosing* impl block — kept
  // alive through the whole function body (unlike `enclosingImpl`, which is
  // only used to attribute a nested `impl_item`) so `self.x()` calls deep
  // inside a method can still be hinted with their receiver's real type.
  function calls(
    node: Node,
    enclosing: string | undefined,
    enclosingImpl: string | undefined,
    implType: string | undefined,
  ): void {
    let current = enclosing;
    let nextEnclosingImpl = enclosingImpl;
    let nextImplType = implType;
    switch (node.type) {
      case "impl_item":
        nextEnclosingImpl = node.childForFieldName("type")?.text ?? enclosingImpl;
        nextImplType = nextEnclosingImpl;
        break;
      case "function_item": {
        const name = node.childForFieldName("name")?.text;
        if (name) current = symbolId(path, enclosingImpl ? `${enclosingImpl}.${name}` : name);
        nextImplType = enclosingImpl; // self.x() inside this body resolves to its own impl type
        break;
      }
      case "call_expression": {
        const callee = node.childForFieldName("function");
        if (!current) break;
        if (callee?.type === "identifier") {
          const target = callables.get(callee.text);
          if (target && target !== current) {
            addEdge({ source: current, target, relation: "calls", confidence: "INFERRED" });
          }
        } else if (callee?.type === "field_expression") {
          // self.x() / recv.x() — self resolves to the enclosing impl type.
          const receiver = callee.namedChildren[0];
          const method = callee.childForFieldName("field")?.text;
          if (method && receiver) {
            const receiverHint = receiver.type === "self" ? implType : receiver.text;
            callCandidates.push({
              callerId: current,
              calleeName: method,
              ...(receiverHint ? { receiverHint } : {}),
            });
          }
        } else if (callee?.type === "scoped_identifier") {
          // Type::x() — associated function/const call.
          const receiver = callee.namedChildren[0];
          const method = callee.namedChildren[1]?.text;
          if (method && receiver?.type === "identifier") {
            callCandidates.push({ callerId: current, calleeName: method, receiverHint: receiver.text });
          }
        }
        break;
      }
    }
    for (const child of node.namedChildren) {
      if (child) calls(child, current, nextEnclosingImpl, nextImplType);
    }
  }
  calls(root, undefined, undefined, undefined);

  return { nodes, edges, ...(callCandidates.length ? { callCandidates } : {}) };
}

export const rustExtractor: Extractor = { language: "rust", extract: extractRust };
