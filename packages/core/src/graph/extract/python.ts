/**
 * Python extractor.
 *
 * Same contract and conventions as the TypeScript extractor, adapted to
 * Python's grammar: `def` (function_definition) and `class` (class_definition),
 * `import` / `from ... import`, and an intra-file call-graph second pass.
 *
 * A `def` directly inside a class body is a `method`; anywhere else it is a
 * `function`. Functions nested inside other functions are plain functions, so
 * the class context is cleared when descending into a function body — this
 * keeps method ids (`Class.method`) distinct from function ids and matches what
 * the call-graph pass recomputes.
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

/** The module a `def` child of `aliased_import`/`dotted_name` refers to. */
function moduleOfChild(node: Node): string | undefined {
  if (node.type === "dotted_name" || node.type === "relative_import") return node.text;
  if (node.type === "aliased_import") {
    const name = node.namedChildren.find((c) => c?.type === "dotted_name");
    return name?.text;
  }
  return undefined;
}

/** Module specifiers introduced by an import / from-import statement. */
function importSpecifiers(node: Node): string[] {
  if (node.type === "import_from_statement") {
    const moduleName = node.childForFieldName("module_name");
    if (moduleName) return [moduleName.text];
    const first = node.namedChildren.find(
      (c) => c?.type === "dotted_name" || c?.type === "relative_import",
    );
    return first ? [first.text] : [];
  }
  // plain `import a, b as c`
  const specs: string[] = [];
  for (const child of node.namedChildren) {
    const mod = child ? moduleOfChild(child) : undefined;
    if (mod) specs.push(mod);
  }
  return specs;
}

function extractPython(ctx: ExtractorContext): Extraction {
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
    qualified: string,
  ): string {
    const id = symbolId(path, qualified);
    addNode({ id, label: name, kind, sourceFile: path, sourceLocation: lineLabel(node) });
    addEdge({ source: parentId, target: id, relation: "defines", confidence: "EXTRACTED" });
    return id;
  }

  // --- Pass 1: declarations --------------------------------------------------
  // `className` is set only while iterating a class body, so a def there is a
  // method; descending into a function body clears it.
  function collect(node: Node, parentId: string, className: string | undefined): void {
    for (const child of node.namedChildren) {
      if (!child) continue;
      switch (child.type) {
        case "import_statement":
        case "import_from_statement": {
          for (const spec of importSpecifiers(child)) {
            const mid = moduleId(spec);
            addNode({ id: mid, label: spec, kind: "module", sourceFile: spec });
            addEdge({ source: fid, target: mid, relation: "imports", confidence: "EXTRACTED" });
          }
          break;
        }
        case "function_definition": {
          const name = child.childForFieldName("name")?.text;
          if (name) {
            const isMethod = className !== undefined;
            const id = defineSymbol(
              name,
              isMethod ? "method" : "function",
              child,
              parentId,
              isMethod ? `${className}.${name}` : name,
            );
            if (!isMethod) callables.set(name, id);
            collect(child, fid, undefined); // nested defs are plain functions
          }
          break;
        }
        case "class_definition": {
          const name = child.childForFieldName("name")?.text;
          if (name) {
            const id = defineSymbol(name, "class", child, fid, name);
            const body = child.childForFieldName("body");
            if (body) collect(body, id, name);
          }
          break;
        }
        default:
          collect(child, parentId, className);
      }
    }
  }
  collect(root, fid, undefined);

  // --- Pass 2: call graph (INFERRED `calls` between local symbols) -----------
  function calls(node: Node, enclosing: string | undefined, className: string | undefined): void {
    let current = enclosing;
    let childClass = className;
    switch (node.type) {
      case "class_definition":
        childClass = node.childForFieldName("name")?.text ?? className;
        break;
      case "function_definition": {
        const name = node.childForFieldName("name")?.text;
        if (name) current = symbolId(path, className ? `${className}.${name}` : name);
        childClass = undefined; // inside a function body now
        break;
      }
      case "call": {
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
    for (const child of node.namedChildren) if (child) calls(child, current, childClass);
  }
  calls(root, undefined, undefined);

  return { nodes, edges };
}

export const pythonExtractor: Extractor = { language: "python", extract: extractPython };
