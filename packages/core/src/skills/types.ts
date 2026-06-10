/**
 * Data model for the **skill graph** — a second, independent knowledge graph
 * used purely as a runtime activation index (see SKILLS_GRAPH_PLAN.md).
 *
 * This is intentionally a *parallel* schema rather than an extension of the code
 * graph's `NODE_KINDS`: the two graphs answer different questions (the code
 * graph maps a project's symbols; the skill graph maps installed skills to the
 * keywords that trigger them) and keeping them separate leaves the code-graph
 * schema untouched. We reuse the same persistence shape (meta + nodes + edges,
 * versioned, pretty JSON) so the on-disk store reads identically.
 */
import { z } from "zod";

/** Schema/format version stamped into every persisted skill graph. */
export const SKILL_GRAPH_FORMAT_VERSION = 1;

/**
 * Node kinds in the skill graph:
 * - `skill` — an installed skill; carries its activation metadata.
 * - `keyword` — a normalized trigger token/phrase. Many skills may share one.
 */
export const SKILL_NODE_KINDS = ["skill", "keyword"] as const;
export const SkillNodeKindSchema = z.enum(SKILL_NODE_KINDS);
export type SkillNodeKind = z.infer<typeof SkillNodeKindSchema>;

/**
 * Relations in the skill graph:
 * - `triggers` — keyword → skill (the deterministic activation index).
 * - `related_to` — skill → skill (one-hop spreading, name-only suggestions).
 */
export const SKILL_RELATIONS = ["triggers", "related_to"] as const;
export const SkillRelationSchema = z.enum(SKILL_RELATIONS);
export type SkillRelation = z.infer<typeof SkillRelationSchema>;

/** Attributes carried by a `skill` node. Absent on `keyword` nodes. */
export const SkillAttrsSchema = z
  .object({
    /** One-line description (from frontmatter). */
    description: z.string(),
    /** Repo-relative-to-skills-root path of the skill.md body file. */
    bodyPath: z.string().min(1),
    /** Whether the skill participates in trigger matching. */
    enabled: z.boolean(),
  })
  .strict();
export type SkillAttrs = z.infer<typeof SkillAttrsSchema>;

export const SkillNodeSchema = z
  .object({
    /** Unique id: the normalized name (skill) or `kw:<token>` (keyword). */
    id: z.string().min(1),
    /** Human-readable label: the skill name or the keyword text. */
    label: z.string().min(1),
    kind: SkillNodeKindSchema,
    /** Present only on `skill` nodes. */
    attrs: SkillAttrsSchema.optional(),
  })
  .strict();
export type SkillNode = z.infer<typeof SkillNodeSchema>;

export const SkillEdgeSchema = z
  .object({
    source: z.string().min(1),
    target: z.string().min(1),
    relation: SkillRelationSchema,
  })
  .strict();
export type SkillEdge = z.infer<typeof SkillEdgeSchema>;

export const SkillGraphMetaSchema = z
  .object({
    version: z.literal(SKILL_GRAPH_FORMAT_VERSION),
    /** Absolute skills root the graph was built from. */
    root: z.string(),
    builtAt: z.string(),
    /** Number of skill.md files that contributed a skill node. */
    skillCount: z.number().int().nonnegative(),
  })
  .strict();
export type SkillGraphMeta = z.infer<typeof SkillGraphMetaSchema>;

export const SkillGraphSchema = z
  .object({
    meta: SkillGraphMetaSchema,
    nodes: z.array(SkillNodeSchema),
    edges: z.array(SkillEdgeSchema),
  })
  .strict();
export type SkillGraph = z.infer<typeof SkillGraphSchema>;

/** Stable id for a keyword node from its normalized text. */
export function keywordNodeId(normalized: string): string {
  return `kw:${normalized}`;
}

/** Stable id for a skill node from its normalized name. */
export function skillNodeId(normalizedName: string): string {
  return normalizedName;
}

/** An empty skill graph rooted at `root`, stamped now. */
export function emptySkillGraph(root: string): SkillGraph {
  return {
    meta: {
      version: SKILL_GRAPH_FORMAT_VERSION,
      root,
      builtAt: new Date().toISOString(),
      skillCount: 0,
    },
    nodes: [],
    edges: [],
  };
}

/** Parse unknown data into a SkillGraph, throwing a ZodError on mismatch. */
export function parseSkillGraph(data: unknown): SkillGraph {
  return SkillGraphSchema.parse(data);
}

/**
 * Referential-integrity checks: duplicate node ids, edge endpoints with no
 * matching node, and skill nodes missing their attrs. Returns human-readable
 * errors; empty means valid.
 */
export function validateSkillGraph(graph: SkillGraph): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (ids.has(node.id)) errors.push(`Duplicate node id '${node.id}'`);
    ids.add(node.id);
    if (node.kind === "skill" && !node.attrs) {
      errors.push(`Skill node '${node.id}' is missing attrs`);
    }
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

/** Throw if the skill graph fails referential-integrity validation. */
export function assertValidSkillGraph(graph: SkillGraph): void {
  const errors = validateSkillGraph(graph);
  if (errors.length > 0) {
    throw new Error(
      `Skill graph has ${errors.length} error(s):\n${errors.map((e) => `  • ${e}`).join("\n")}`,
    );
  }
}
