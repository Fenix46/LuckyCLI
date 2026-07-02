/**
 * C++ extractor.
 *
 * Same Extractor contract and conventions, adapted to C++: `#include` imports,
 * `namespace` blocks (kind "module", defined in the file and recursed into),
 * `class`/`struct` specifiers and their member functions (inline definitions and
 * prototypes), out-of-line `Class::method` definitions attached back to the
 * declaring class, free functions, and an intra-file call-graph second pass. A
 * bare `call_expression` whose callee is a plain identifier resolves to a member
 * of the enclosing class (inside a method) or a free function (inside a free
 * function); when that fails locally, and for calls through an object
 * (`obj.m()`, `ptr->m()`) or a scope (`Type::m()`, `ns::fn()`), a CallCandidate
 * is emitted for the whole-graph cross-file resolution pass — the receiverHint
 * carries a parameter's declared type when the receiver is a known local, else
 * the scope/identifier as written.
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

function descendants(node: Node, type: string): Node[] {
  const out: Node[] = [];
  const visit = (n: Node): void => {
    if (n.type === type) out.push(n);
    for (const c of n.namedChildren) if (c) visit(c);
  };
  visit(node);
  return out;
}

/** Flatten a (possibly nested) qualified_identifier into its name parts. */
function flattenQualified(qid: Node): string[] {
  const parts: string[] = [];
  let cur: Node | null = qid;
  while (cur && cur.type === "qualified_identifier") {
    const scope = cur.childForFieldName("scope");
    if (scope) parts.push(scope.text);
    cur = cur.childForFieldName("name");
  }
  if (cur) parts.push(cur.text);
  return parts;
}

interface DeclInfo {
  /** Bare function/method name. */
  name: string;
  /** Class path parts for an out-of-line `A::B::m` declarator (empty otherwise). */
  scopeParts: string[];
}

/** Name (and any `Class::` scope) declared by a function_declarator. */
function declInfo(funcDef: Node): DeclInfo | undefined {
  const fdec = descendants(funcDef, "function_declarator")[0];
  const d = fdec?.childForFieldName("declarator");
  if (!d) return undefined;
  if (d.type === "field_identifier" || d.type === "identifier") {
    return { name: d.text, scopeParts: [] };
  }
  if (d.type === "qualified_identifier") {
    const parts = flattenQualified(d);
    const name = parts.pop();
    if (name) return { name, scopeParts: parts };
  }
  return undefined;
}

/** Parameter name -> declared type name, e.g. `(const Rect &r)` -> r: Rect. */
function paramTypes(funcDef: Node): Map<string, string> {
  const out = new Map<string, string>();
  const fdec = descendants(funcDef, "function_declarator")[0];
  const params = fdec?.childForFieldName("parameters");
  for (const decl of params?.namedChildren ?? []) {
    if (decl?.type !== "parameter_declaration") continue;
    const type = decl.childForFieldName("type")?.text;
    const name = descendants(decl, "identifier")[0]?.text;
    if (type && name) out.set(name, type);
  }
  return out;
}

function extractCpp(ctx: ExtractorContext): Extraction {
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

  /** Define a class member function from an inline def or a prototype. */
  function defineMember(member: Node, classId: string, classPrefix: string): void {
    const info = declInfo(member);
    if (info?.name) defineSymbol(info.name, "method", member, classId, qualify(classPrefix, info.name));
  }

  function handleClass(node: Node, parentId: string, prefix: string): void {
    const name = node.childForFieldName("name")?.text;
    if (!name) return;
    const qualified = qualify(prefix, name);
    const classId = defineSymbol(name, "class", node, parentId, qualified);
    const body = node.childForFieldName("body");
    for (const member of body?.namedChildren ?? []) {
      if (!member) continue;
      if (member.type === "function_definition") {
        defineMember(member, classId, qualified);
      } else if (member.type === "field_declaration" && descendants(member, "function_declarator").length) {
        defineMember(member, classId, qualified);
      } else if (member.type === "class_specifier" || member.type === "struct_specifier") {
        handleClass(member, classId, qualified);
      }
    }
  }

  function collect(container: Node, parentId: string, prefix: string): void {
    for (const child of container.namedChildren) {
      if (!child) continue;
      switch (child.type) {
        case "namespace_definition": {
          const name = child.childForFieldName("name")?.text;
          const body = child.childForFieldName("body");
          if (name && body) {
            const nsId = defineSymbol(name, "module", child, parentId, qualify(prefix, name));
            collect(body, nsId, qualify(prefix, name));
          } else if (body) {
            collect(body, parentId, prefix); // anonymous namespace
          }
          break;
        }
        case "class_specifier":
        case "struct_specifier":
          handleClass(child, parentId, prefix);
          break;
        case "function_definition": {
          const info = declInfo(child);
          if (!info?.name) break;
          if (info.scopeParts.length) {
            // Out-of-line `Class::method` — attach to the (already defined) class.
            const classPrefix = qualify(prefix, info.scopeParts.join("."));
            const classId = symbolId(path, classPrefix);
            const parent = seenNodes.has(classId) ? classId : parentId;
            defineSymbol(info.name, "method", child, parent, qualify(classPrefix, info.name));
          } else {
            defineSymbol(info.name, "function", child, parentId, qualify(prefix, info.name));
          }
          break;
        }
      }
    }
  }
  collect(root, fid, "");

  // --- Pass 2: call graph (INFERRED `calls`) ---------------------------------
  function addCandidate(callerId: string, calleeName: string, receiverHint?: string): void {
    callCandidates.push({
      callerId,
      calleeName,
      ...(receiverHint ? { receiverHint } : {}),
    });
  }

  function calls(
    node: Node,
    prefix: string,
    scope: string | undefined,
    current: string | undefined,
    locals: Map<string, string>,
  ): void {
    let nextPrefix = prefix;
    let nextScope = scope;
    let nextCurrent = current;
    let nextLocals = locals;
    switch (node.type) {
      case "namespace_definition": {
        const name = node.childForFieldName("name")?.text;
        if (name) nextPrefix = qualify(prefix, name);
        break;
      }
      case "class_specifier":
      case "struct_specifier": {
        const name = node.childForFieldName("name")?.text;
        if (name) nextPrefix = qualify(prefix, name);
        break;
      }
      case "function_definition": {
        const info = declInfo(node);
        if (info?.name) {
          // Where to resolve bare callees: the class for a method, else the namespace.
          const classPrefix = info.scopeParts.length
            ? qualify(prefix, info.scopeParts.join("."))
            : prefix;
          nextScope = classPrefix;
          nextCurrent = symbolId(path, qualify(classPrefix, info.name));
          nextLocals = paramTypes(node);
        }
        break;
      }
      case "call_expression": {
        const callee = node.childForFieldName("function");
        if (!callee || !current) break;
        if (callee.type === "identifier" && scope !== undefined) {
          const target = symbolId(path, qualify(scope, callee.text));
          if (seenNodes.has(target) && target !== current) {
            addEdge({ source: current, target, relation: "calls", confidence: "INFERRED" });
          } else if (!seenNodes.has(target)) {
            // Not defined in this file (e.g. header-declared free function).
            addCandidate(current, callee.text);
          }
        } else if (callee.type === "field_expression") {
          // obj.method() / ptr->method(): hint with the local's declared type.
          const object = callee.childForFieldName("argument");
          const name = callee.childForFieldName("field")?.text;
          if (!name) break;
          const receiverHint =
            object?.type === "identifier" ? (locals.get(object.text) ?? object.text) : undefined;
          addCandidate(current, name, receiverHint);
        } else if (callee.type === "qualified_identifier") {
          // Type::method() / ns::fn(): hint with the innermost scope.
          const parts = flattenQualified(callee);
          const name = parts.pop();
          if (name) addCandidate(current, name, parts[parts.length - 1]);
        }
        break;
      }
    }
    for (const child of node.namedChildren) {
      if (child) calls(child, nextPrefix, nextScope, nextCurrent, nextLocals);
    }
  }
  calls(root, "", undefined, undefined, new Map());

  return { nodes, edges, ...(callCandidates.length ? { callCandidates } : {}) };
}

export const cppExtractor: Extractor = { language: "cpp", extract: extractCpp };
