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

/** An extractor's output for a single file, before graph assembly. */
export const ExtractionSchema = z
  .object({
    nodes: z.array(GraphNodeSchema),
    edges: z.array(GraphEdgeSchema),
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
