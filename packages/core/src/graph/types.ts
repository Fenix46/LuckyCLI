/**
 * Native knowledge-graph data model.
 *
 * Ported and adapted from graphify's extraction/validation schema
 * (graphify/validate.py + the extraction output contract in ARCHITECTURE.md)
 * into LuckyCLI's own style: zod schemas as the single source of truth, with
 * inferred TypeScript types. The graph is the on-disk cache that lets the agent
 * answer "where is X / what imports Y" without re-reading whole files.
 */
import { z } from "zod";

/** Schema/format version stamped into every persisted graph. */
export const GRAPH_FORMAT_VERSION = 1;

/**
 * Confidence of an extracted relationship — identical semantics to graphify:
 * - EXTRACTED: explicitly stated in source (an import, a direct call)
 * - INFERRED: a reasonable deduction (call-graph second pass, co-occurrence)
 * - AMBIGUOUS: uncertain, flagged for human review
 */
export const CONFIDENCES = ["EXTRACTED", "INFERRED", "AMBIGUOUS"] as const;
export const ConfidenceSchema = z.enum(CONFIDENCES);
export type Confidence = z.infer<typeof ConfidenceSchema>;

/**
 * Kind of a node. graphify keys nodes by a file-category `file_type`; for a
 * code graph we key by symbol kind instead, with `file` for whole-file nodes.
 * Kept as a closed-but-growable enum so extractors stay consistent.
 */
export const NODE_KINDS = [
  "file",
  "module",
  "function",
  "method",
  "class",
  "interface",
  "variable",
  "symbol",
] as const;
export const NodeKindSchema = z.enum(NODE_KINDS);
export type NodeKind = z.infer<typeof NodeKindSchema>;

/**
 * Well-known relations. Left as a free-form non-empty string (extractors may
 * introduce new relations) but these are the ones the built-in extractors emit.
 */
export const KNOWN_RELATIONS = [
  "imports",
  "defines",
  "calls",
  "uses",
  "references",
  "extends",
  "implements",
] as const;

export const GraphNodeSchema = z
  .object({
    /** Unique, normalized identifier (see makeNodeId). */
    id: z.string().min(1),
    /** Human-readable name. */
    label: z.string().min(1),
    /** Symbol/file kind. */
    kind: NodeKindSchema,
    /** Repo-relative path of the file this node lives in. */
    sourceFile: z.string().min(1),
    /** Location within the file, e.g. "L42". Absent for whole-file nodes. */
    sourceLocation: z.string().optional(),
    /**
     * True for nodes that don't live in the repo — third-party libraries
     * reached through an import (e.g. `androidx.media3.ExoPlayer`, `react`,
     * `os`). The build step sets this on `module` nodes whose `sourceFile`
     * isn't a real project file, so queries can keep the project's own graph
     * (the "town") separate from its external dependencies (the "neighbouring
     * towns") while still showing how they connect.
     */
    external: z.boolean().optional(),
  })
  .strict();
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeSchema = z
  .object({
    /** Source node id. */
    source: z.string().min(1),
    /** Target node id. */
    target: z.string().min(1),
    /** Relation kind (see KNOWN_RELATIONS). */
    relation: z.string().min(1),
    /** Confidence of the relationship. */
    confidence: ConfidenceSchema,
  })
  .strict();
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const GraphMetaSchema = z
  .object({
    /** On-disk format version. */
    version: z.literal(GRAPH_FORMAT_VERSION),
    /** Absolute root the graph was built from. */
    root: z.string(),
    /** ISO timestamp of the last full/partial build. */
    builtAt: z.string(),
    /** Number of files that contributed nodes. */
    fileCount: z.number().int().nonnegative(),
  })
  .strict();
export type GraphMeta = z.infer<typeof GraphMetaSchema>;

export const GraphSchema = z
  .object({
    meta: GraphMetaSchema,
    nodes: z.array(GraphNodeSchema),
    edges: z.array(GraphEdgeSchema),
  })
  .strict();
export type Graph = z.infer<typeof GraphSchema>;

/**
 * An unresolved call site an extractor recognized but couldn't attribute to a
 * local symbol — a qualified/receiver call (`pkg.Fn`, `obj.method()`,
 * `Type::method()`, …) whose target may live in another file. Extractors emit
 * these instead of a `calls` edge; {@link resolveCrossFileCalls} matches them
 * against the whole-graph symbol table once every file has been merged.
 */
export const CallCandidateSchema = z
  .object({
    /** Node id of the calling function/method (the edge's future source). */
    callerId: z.string().min(1),
    /** Bare callee name as written at the call site, e.g. "method" in `obj.method()`. */
    calleeName: z.string().min(1),
    /**
     * Best-effort receiver/type hint, when the extractor can read one — a
     * variable/receiver name, static type, or package alias (`obj`, `Type`,
     * `pkg`). Used to prefer a same-named method whose enclosing class/type
     * matches; absent when the grammar gives no hint (rare).
     */
    receiverHint: z.string().optional(),
  })
  .strict();
export type CallCandidate = z.infer<typeof CallCandidateSchema>;

/** An extractor's output for a single file, before graph assembly. */
export const ExtractionSchema = z
  .object({
    nodes: z.array(GraphNodeSchema),
    edges: z.array(GraphEdgeSchema),
    /** Cross-file call sites to resolve once the whole graph is assembled. */
    callCandidates: z.array(CallCandidateSchema).optional(),
  })
  .strict();
export type Extraction = z.infer<typeof ExtractionSchema>;

/**
 * Normalize a string into a stable node id. Mirrors graphify's _make_id intent
 * (NFKC normalize, collapse non-word runs to underscore, casefold) so the same
 * entity gets the same id regardless of punctuation/casing.
 */
export function makeNodeId(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

/** Extensions tried, in order, when resolving a relative import to a file. */
const IMPORT_RESOLUTION_EXTS = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx",
  "/__init__.py",
];

/** POSIX-style join+normalize of `from` dir and a relative `spec`, no `..` escape needed downstream. */
function resolveRelative(fromDir: string, spec: string): string {
  const parts = fromDir === "" ? [] : fromDir.split("/");
  for (const seg of spec.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

/**
 * Resolve relative `imports` edges (TS/JS/Python `./x`, `../y`) to the real
 * `file` node they point at, dropping the throwaway `module` stub the extractor
 * emitted. Extractors see one file at a time, so they can't know an import
 * targets another repo file; only here, with every `file` node available, can we
 * connect the project's own graph instead of leaving internal imports as
 * external-looking module stubs. Bare specifiers (libraries) are left untouched.
 *
 * Mutates `graph.nodes`/`graph.edges` in place. Run before {@link markExternalNodes}.
 */
export function resolveInternalImports(graph: Graph): void {
  // Map a repo-relative file path → its file node id.
  const fileIdByPath = new Map<string, string>();
  for (const node of graph.nodes) {
    if (node.kind === "file") fileIdByPath.set(node.sourceFile, node.id);
  }
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

  const retargetedStubs = new Set<string>();
  const stillReferenced = new Set<string>();

  for (const edge of graph.edges) {
    if (edge.relation !== "imports") continue;
    const moduleNode = nodeById.get(edge.target);
    const fileNode = nodeById.get(edge.source);
    if (!moduleNode || moduleNode.kind !== "module" || !fileNode) continue;

    const spec = moduleNode.label;
    if (!spec.startsWith(".")) {
      stillReferenced.add(edge.target);
      continue; // bare specifier → external library, leave as-is
    }

    const fromDir = fileNode.sourceFile.includes("/")
      ? fileNode.sourceFile.slice(0, fileNode.sourceFile.lastIndexOf("/"))
      : "";
    const base = resolveRelative(fromDir, spec.replace(/\.js$/, ""));

    let targetFileId: string | undefined;
    for (const ext of IMPORT_RESOLUTION_EXTS) {
      const candidate = fileIdByPath.get(base + ext);
      if (candidate) {
        targetFileId = candidate;
        break;
      }
    }

    if (targetFileId) {
      edge.target = targetFileId; // point the import at the real file node
      retargetedStubs.add(moduleNode.id);
    } else {
      stillReferenced.add(edge.target); // unresolved relative import: keep the stub
    }
  }

  // Drop module stubs that every importer resolved away (none still reference them).
  const toDrop = new Set([...retargetedStubs].filter((id) => !stillReferenced.has(id)));
  if (toDrop.size > 0) {
    graph.nodes = graph.nodes.filter((n) => !toDrop.has(n.id));
  }
}

/**
 * Flag `module` nodes that don't correspond to a real project file as
 * `external` (third-party libraries reached via imports). The set of real files
 * is taken from the graph's own `file` nodes, so this is stable across a full
 * build and an incremental update — both must call it so the project's own graph
 * stays cleanly separable from its dependencies. Mutates the nodes in place.
 */
export function markExternalNodes(nodes: Iterable<GraphNode>): void {
  const all = [...nodes];
  const projectFiles = new Set<string>();
  for (const node of all) {
    if (node.kind === "file") projectFiles.add(node.sourceFile);
  }
  for (const node of all) {
    if (node.kind !== "module") continue;
    if (projectFiles.has(node.sourceFile)) {
      // A module that resolves to a repo file isn't external; clear any stale flag.
      delete node.external;
    } else {
      node.external = true;
    }
  }
}

/**
 * Resolve cross-file call candidates (see {@link CallCandidate}) into `calls`
 * edges, once every file's nodes are in the graph. Mirrors
 * {@link resolveInternalImports}'s shape: a global post-process pass that sees
 * the whole project, which is exactly what a single-file extractor can't.
 *
 * Matching is name-only (no type inference), so it's inherently uncertain —
 * every edge this pass creates is `AMBIGUOUS` confidence, never `EXTRACTED`/
 * `INFERRED`. Two-tier lookup:
 *   1. If `receiverHint` matches a known class/interface name, prefer a
 *      `method` node whose qualified name is `<hint>.<calleeName>` (or the
 *      language's separator — id lookup is by suffix, not literal string, so
 *      `.`/`::`/etc. are all covered by how each extractor built the id).
 *   2. Otherwise fall back to any function/method in the project whose bare
 *      name matches `calleeName`. If that's ambiguous (multiple candidates),
 *      skip — a wrong edge is worse than a missing one.
 *
 * Candidates are cleared after resolution; they never reach the persisted
 * graph (call sites are re-discovered on every build/update from source).
 */
export function resolveCrossFileCalls(
  graph: Graph,
  candidates: readonly CallCandidate[],
): void {
  if (candidates.length === 0) return;

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const CALLABLE_KINDS = new Set<NodeKind>(["function", "method"]);

  // bare callee name -> every callable node whose label matches.
  const byName = new Map<string, GraphNode[]>();
  // "<receiverHint>.<calleeName>" style key -> callable nodes, matched by
  // checking whether the node's id ends with a normalized "<hint>_<name>"
  // suffix, since every extractor's qualifier separator normalizes to `_`
  // through makeNodeId.
  for (const node of graph.nodes) {
    if (!CALLABLE_KINDS.has(node.kind)) continue;
    const bucket = byName.get(node.label);
    if (bucket) bucket.push(node);
    else byName.set(node.label, [node]);
  }

  const seenEdges = new Set<string>(
    graph.edges.map((e) => `${e.source}->${e.target}:${e.relation}`),
  );

  for (const candidate of candidates) {
    const caller = nodeById.get(candidate.callerId);
    if (!caller) continue; // caller vanished (e.g. dangling from a stale candidate)

    const sameName = byName.get(candidate.calleeName);
    if (!sameName || sameName.length === 0) continue;

    let target: GraphNode | undefined;
    if (candidate.receiverHint) {
      const hintSuffix = makeNodeId(`${candidate.receiverHint}_${candidate.calleeName}`);
      const hinted = sameName.filter((n) => n.id.endsWith(hintSuffix));
      if (hinted.length === 1) target = hinted[0];
    }
    if (!target && sameName.length === 1) {
      target = sameName[0];
    }
    if (!target || target.id === caller.id) continue;

    const key = `${caller.id}->${target.id}:calls`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    graph.edges.push({
      source: caller.id,
      target: target.id,
      relation: "calls",
      confidence: "AMBIGUOUS",
    });
  }
}

/** An empty graph rooted at `root`, stamped now. */
export function emptyGraph(root: string): Graph {
  return {
    meta: {
      version: GRAPH_FORMAT_VERSION,
      root,
      builtAt: new Date().toISOString(),
      fileCount: 0,
    },
    nodes: [],
    edges: [],
  };
}

/**
 * Parse unknown data into a Graph, throwing a ZodError on a shape mismatch.
 * Shape only — referential integrity is checked by {@link validateGraph}.
 */
export function parseGraph(data: unknown): Graph {
  return GraphSchema.parse(data);
}

/**
 * Referential-integrity checks beyond shape, ported from graphify's
 * validate_extraction: duplicate node ids, and edge endpoints that don't match
 * any node. Returns a list of human-readable errors; empty means valid.
 */
export function validateGraph(graph: Graph): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (ids.has(node.id)) {
      errors.push(`Duplicate node id '${node.id}'`);
    }
    ids.add(node.id);
  }
  graph.edges.forEach((edge, i) => {
    if (!ids.has(edge.source)) {
      errors.push(`Edge ${i} source '${edge.source}' does not match any node id`);
    }
    if (!ids.has(edge.target)) {
      errors.push(`Edge ${i} target '${edge.target}' does not match any node id`);
    }
  });
  return errors;
}

/** Throw if the graph fails referential-integrity validation. */
export function assertValidGraph(graph: Graph): void {
  const errors = validateGraph(graph);
  if (errors.length > 0) {
    throw new Error(
      `Graph has ${errors.length} error(s):\n${errors.map((e) => `  • ${e}`).join("\n")}`,
    );
  }
}
