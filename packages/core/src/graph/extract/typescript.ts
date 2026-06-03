/**
 * TypeScript / JavaScript / TSX extractor.
 *
 * Adapted from graphify's extract_js pattern (parse → walk → nodes+edges, then
 * a call-graph second pass for INFERRED `calls`), rewritten as a focused
 * LuckyCLI extractor instead of porting graphify's config-driven generic
 * machine. It emits:
 *   - one `file` node per source file,
 *   - `function` / `class` / `method` / `interface` symbol nodes,
 *   - `module` nodes for import specifiers,
 *   - `defines` edges (file→symbol, class→method) — EXTRACTED,
 *   - `imports` edges (file→module) — EXTRACTED,
 *   - `calls` edges between symbols defined in the same file — INFERRED.
 *
 * Cross-file call resolution (graphify's symbol_resolution pass) is deliberately
 * out of scope here: we only emit `calls` whose callee resolves to a symbol in
 * the same file, so every edge endpoint exists and the graph stays valid.
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

/** The module specifier of an import_statement, sans quotes. */
function importSpecifier(node: Node): string | undefined {
  const source = node.childForFieldName("source");
  if (!source) return undefined;
  const fragment = source.namedChildren.find((c) => c?.type === "string_fragment");
  const raw = (fragment ?? source).text;
  return raw.replace(/^['"`]|['"`]$/g, "") || undefined;
}

/** Is this declarator's value an (arrow) function? */
function declaratorIsCallable(declarator: Node): boolean {
  const value = declarator.childForFieldName("value");
  return value?.type === "arrow_function" || value?.type === "function_expression";
}

function extractTypeScript(ctx: ExtractorContext): Extraction {
  const { path, root } = ctx;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seenNodes = new Set<string>();
  const seenEdges = new Set<string>();
  /** Local callables addressable by a bare `name()` call → node id. */
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
    qualified = name,
  ): string {
    const id = symbolId(path, qualified);
    addNode({ id, label: name, kind, sourceFile: path, sourceLocation: lineLabel(node) });
    addEdge({ source: parentId, target: id, relation: "defines", confidence: "EXTRACTED" });
    return id;
  }

  // --- Pass 1: declarations (nodes + defines/imports edges) ------------------
  function collect(node: Node): void {
    switch (node.type) {
      case "import_statement": {
        const spec = importSpecifier(node);
        if (spec) {
          const mid = moduleId(spec);
          addNode({ id: mid, label: spec, kind: "module", sourceFile: spec });
          addEdge({ source: fid, target: mid, relation: "imports", confidence: "EXTRACTED" });
        }
        return;
      }
      case "function_declaration": {
        const name = node.childForFieldName("name")?.text;
        if (name) callables.set(name, defineSymbol(name, "function", node, fid));
        break;
      }
      case "class_declaration": {
        const name = node.childForFieldName("name")?.text;
        if (name) {
          const classNodeId = defineSymbol(name, "class", node, fid);
          const body = node.childForFieldName("body");
          for (const member of body?.namedChildren ?? []) {
            if (member?.type !== "method_definition") continue;
            const method = member.childForFieldName("name")?.text;
            if (method) defineSymbol(method, "method", member, classNodeId, `${name}.${method}`);
          }
        }
        break;
      }
      case "interface_declaration": {
        const name = node.childForFieldName("name")?.text;
        if (name) defineSymbol(name, "interface", node, fid);
        break;
      }
      case "variable_declarator": {
        if (declaratorIsCallable(node)) {
          const name = node.childForFieldName("name")?.text;
          if (name) callables.set(name, defineSymbol(name, "function", node, fid));
        }
        break;
      }
    }
    for (const child of node.namedChildren) if (child) collect(child);
  }
  collect(root);

  // --- Pass 2: call graph (INFERRED `calls` between local symbols) -----------
  // Track the enclosing symbol id (and class name, so methods get the right
  // qualified id) so each call is attributed to the function/method it sits in.
  function calls(node: Node, enclosing: string | undefined, className: string | undefined): void {
    let current = enclosing;
    let nextClass = className;
    switch (node.type) {
      case "class_declaration":
        nextClass = node.childForFieldName("name")?.text ?? className;
        break;
      case "function_declaration": {
        const name = node.childForFieldName("name")?.text;
        if (name) current = symbolId(path, name);
        break;
      }
      case "method_definition": {
        const name = node.childForFieldName("name")?.text;
        if (name && className) current = symbolId(path, `${className}.${name}`);
        break;
      }
      case "variable_declarator": {
        if (declaratorIsCallable(node)) {
          const name = node.childForFieldName("name")?.text;
          if (name) current = symbolId(path, name);
        }
        break;
      }
      case "call_expression": {
        const callee = node.childForFieldName("function");
        if (current && callee?.type === "identifier") {
          const target = callables.get(callee.text);
          if (target && target !== current) {
            addEdge({ source: current, target, relation: "calls", confidence: "INFERRED" });
          }
        }
        break;
      }
    }
    for (const child of node.namedChildren) if (child) calls(child, current, nextClass);
  }
  calls(root, undefined, undefined);

  return { nodes, edges };
}

export const typescriptExtractor: Extractor = {
  language: "typescript",
  extract: extractTypeScript,
};

export const tsxExtractor: Extractor = { language: "tsx", extract: extractTypeScript };
export const javascriptExtractor: Extractor = {
  language: "javascript",
  extract: extractTypeScript,
};
