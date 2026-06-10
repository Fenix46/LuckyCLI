import { z } from "zod";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  skillsRootDir,
  tryLoadSkillGraph,
} from "../../skills/graph.js";
import { normalizeSkillName } from "../../skills/skill-file.js";
import type { SkillGraph, SkillNode } from "../../skills/types.js";
import { defineTool } from "../types.js";

const NO_SKILLS =
  "No skills are installed. Install one with `lucky skill add <path>` or `/skill`.";

/** Skill nodes only. */
function skillNodes(graph: SkillGraph): SkillNode[] {
  return graph.nodes.filter((n) => n.kind === "skill");
}

/** Keywords that trigger a given skill id, from the triggers edges. */
function keywordsFor(graph: SkillGraph, skillId: string): string[] {
  const labels = new Map(graph.nodes.map((n) => [n.id, n.label]));
  return graph.edges
    .filter((e) => e.relation === "triggers" && e.target === skillId)
    .map((e) => labels.get(e.source) ?? e.source);
}

/** One result line: "name — description [keywords: a, b]". */
function formatSkill(graph: SkillGraph, node: SkillNode): string {
  const kws = keywordsFor(graph, node.id);
  const tail = kws.length > 0 ? ` [keywords: ${kws.join(", ")}]` : "";
  const disabled = node.attrs?.enabled === false ? " (disabled)" : "";
  return `${node.label}${disabled} — ${node.attrs?.description ?? ""}${tail}`;
}

export const skillSearchTool = defineTool({
  name: "skill_search",
  description:
    "Search installed skills (reusable, operative instructions for specific " +
    "kinds of work) by name, description, or keyword. Returns matching skills' " +
    "name, description, and keywords — never their bodies. Use this when you " +
    "sense a skill could help but none was auto-injected, then skill_load the " +
    "one you want.",
  readonly: true,
  schema: z.object({
    query: z.string().describe("Words to match against skill names, descriptions, and keywords."),
  }),
  async execute({ query }) {
    const graph = await tryLoadSkillGraph();
    if (!graph) return { content: NO_SKILLS };

    const terms = normalizeSkillName(query).split(" ").filter(Boolean);
    const scored = skillNodes(graph)
      .map((node) => {
        const hay = [
          node.label,
          node.attrs?.description ?? "",
          ...keywordsFor(graph, node.id),
        ]
          .join(" ")
          .toLowerCase();
        const score = terms.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0);
        return { node, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || a.node.label.localeCompare(b.node.label));

    if (scored.length === 0) {
      return { content: `No skills match "${query}".` };
    }
    const lines = scored.map((s) => formatSkill(graph, s.node));
    return { content: [`Skills matching "${query}":`, ...lines.map((l) => `- ${l}`)].join("\n") };
  },
});

export const skillLoadTool = defineTool({
  name: "skill_load",
  description:
    "Load a skill's full instructions by name (as returned by skill_search). " +
    "Returns the skill's operative body; follow it for the current task. The " +
    "skill is marked active for the session so it won't be auto-injected again.",
  readonly: true,
  schema: z.object({
    name: z.string().describe("The skill's name (e.g. 'release-flow')."),
  }),
  async execute({ name }, ctx) {
    const graph = await tryLoadSkillGraph();
    if (!graph) return { content: NO_SKILLS };

    const id = normalizeSkillName(name);
    const node = skillNodes(graph).find((n) => n.id === id);
    if (!node || !node.attrs) {
      return { content: `No skill named "${name}". Use skill_search to discover skills.` };
    }

    let body: string;
    try {
      body = (await readFile(join(skillsRootDir(), node.attrs.bodyPath), "utf8")).trim();
    } catch {
      return { content: `Skill "${node.label}" has no readable body file.` };
    }
    body = stripFrontmatter(body);

    ctx.onSkillLoaded?.(node.id);
    const related = graph.edges
      .filter((e) => e.relation === "related_to" && e.source === node.id)
      .map((e) => e.target);
    const tail =
      related.length > 0
        ? `\n\nRelated skills available (use skill_load): ${related.join(", ")}`
        : "";
    return { content: `<skill name="${node.label}">\n${body}${tail}\n</skill>` };
  },
});

/** Remove a leading `--- ... ---` frontmatter block from a skill.md body. */
function stripFrontmatter(source: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return source.trim();
  const close = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (close === -1) return source.trim();
  return lines.slice(close + 1).join("\n").trim();
}
