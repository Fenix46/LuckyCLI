/**
 * Deterministic keyword matcher — the automatic activation channel.
 *
 * Runs on each user message *before* `agent.send()`, entirely outside the
 * model, so it costs zero tokens when nothing matches and a skill installed
 * mid-session is available on the very next turn (the graph is read at call
 * time). The matcher is pure over (message, graph, activeSet) so it is fully
 * unit-testable; reading bodies from disk and assembling the injection block is
 * a separate, I/O step (see {@link renderSkillInjection}).
 *
 * Matching rules (v1, see SKILLS_GRAPH_PLAN.md "Open questions"):
 * - Single-word keywords match a whole word in the message (case-insensitive).
 * - Multi-word keyword phrases match as a substring of the normalized message.
 * - Score = number of *distinct* keywords a skill is triggered by.
 * - Budget: at most the top 2 skills per turn (anti-friction rule #1).
 * - A skill already in the session's active set is skipped (rule #2).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeSkillName } from "./skill-file.js";
import { skillsRootDir } from "./graph.js";
import type { SkillGraph, SkillNode } from "./types.js";

/** A skill selected by the matcher, with the keywords that fired it. */
export interface SkillActivation {
  /** Skill node id (== normalized name). */
  id: string;
  name: string;
  description: string;
  bodyPath: string;
  /** Distinct keywords that matched, in graph order. */
  matched: string[];
  /** Names of `related_to` neighbors (for one-hop, name-only suggestion). */
  related: string[];
}

/** Per-turn cap on automatic activations. */
export const ACTIVATION_BUDGET = 2;

/** Normalize a message for matching: lowercase, collapse whitespace. */
function normalizeMessage(message: string): string {
  return normalizeSkillName(message);
}

/** Whole-word, case-insensitive presence of a single token in the message. */
function wordMatches(token: string, normalizedMessage: string): boolean {
  // token is already normalized (single word). Build a word-boundary regex,
  // escaping regex metacharacters in the token.
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\W)${escaped}(?:\\W|$)`, "u").test(normalizedMessage);
}

/**
 * Match a message against the skill graph's keyword/triggers index.
 * Pure: no I/O. Returns up to {@link ACTIVATION_BUDGET} activations, highest
 * score first, ties broken by skill name for determinism. Skills in
 * `activeSet` (normalized ids) are excluded.
 */
export function matchSkills(
  message: string,
  graph: SkillGraph,
  activeSet: ReadonlySet<string> = new Set(),
): SkillActivation[] {
  const normalized = normalizeMessage(message);
  if (normalized === "") return [];

  const skillById = new Map<string, SkillNode>();
  for (const node of graph.nodes) {
    if (node.kind === "skill") skillById.set(node.id, node);
  }

  // For each keyword node, decide if it appears in the message.
  const keywordHit = new Map<string, boolean>();
  for (const node of graph.nodes) {
    if (node.kind !== "keyword") continue;
    const kw = node.label; // already normalized at build time
    const hit = kw.includes(" ")
      ? normalized.includes(kw) // multi-word phrase: substring
      : wordMatches(kw, normalized);
    keywordHit.set(node.id, hit);
  }

  // Walk triggers edges, collecting matched keywords per skill (preserving
  // graph order, deduped).
  const matchedBySkill = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.relation !== "triggers") continue;
    if (!keywordHit.get(edge.source)) continue;
    const skill = skillById.get(edge.target);
    if (!skill || !skill.attrs?.enabled) continue;
    if (activeSet.has(skill.id)) continue;
    const kwLabel = graph.nodes.find((n) => n.id === edge.source)?.label;
    if (!kwLabel) continue;
    const list = matchedBySkill.get(skill.id) ?? [];
    if (!list.includes(kwLabel)) list.push(kwLabel);
    matchedBySkill.set(skill.id, list);
  }

  const relatedBySkill = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.relation !== "related_to") continue;
    const list = relatedBySkill.get(edge.source) ?? [];
    list.push(edge.target);
    relatedBySkill.set(edge.source, list);
  }

  const candidates: SkillActivation[] = [...matchedBySkill.entries()].map(([id, matched]) => {
    const skill = skillById.get(id);
    return {
      id,
      name: skill?.label ?? id,
      description: skill?.attrs?.description ?? "",
      bodyPath: skill?.attrs?.bodyPath ?? "",
      matched,
      related: relatedBySkill.get(id) ?? [],
    };
  });

  candidates.sort((a, b) => b.matched.length - a.matched.length || a.name.localeCompare(b.name));
  return candidates.slice(0, ACTIVATION_BUDGET);
}

/**
 * Read a skill's body from disk and render the `<skill>` injection block,
 * including name-only related suggestions. `root` defaults to the global skills
 * dir. Returns null if the body file can't be read.
 */
export async function renderSkillInjection(
  activation: SkillActivation,
  root = skillsRootDir(),
): Promise<string | null> {
  let body: string;
  try {
    body = (await readFile(join(root, activation.bodyPath), "utf8")).trim();
  } catch {
    return null;
  }
  // Strip the frontmatter block so only the operative body is injected.
  const stripped = stripFrontmatter(body);
  const lines = [`<skill name="${activation.name}">`, stripped];
  if (activation.related.length > 0) {
    lines.push("", `Related skills available (use skill_load): ${activation.related.join(", ")}`);
  }
  lines.push("</skill>");
  return lines.join("\n");
}

/** Remove a leading `--- ... ---` frontmatter block from a skill.md body. */
function stripFrontmatter(source: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return source.trim();
  const close = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (close === -1) return source.trim();
  return lines.slice(close + 1).join("\n").trim();
}
