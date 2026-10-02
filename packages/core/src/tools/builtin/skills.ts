import { z } from "zod";
import { readFile } from "node:fs/promises";
import { listAvailableSkills, type AvailableSkill } from "../../skills/available.js";
import { normalizeSkillName } from "../../skills/skill-file.js";
import { defineTool } from "../types.js";

const NO_SKILLS =
  "No skills are available. The user can add one with `/skill add <path | catalog name>`, " +
  "or drop a skill folder into .lucky/skills/ in the project.";

/** One result line: "name — description [keywords: a, b]". */
function formatSkill(skill: AvailableSkill): string {
  const tail = skill.keywords.length > 0 ? ` [keywords: ${skill.keywords.join(", ")}]` : "";
  const disabled = skill.enabled ? "" : " (disabled)";
  return `${skill.name}${disabled} — ${skill.description}${tail}`;
}

export const skillSearchTool = defineTool({
  name: "skill_search",
  description:
    "Search the available skills (reusable, operative instructions for specific " +
    "kinds of work) by name, description, or keyword. Returns matching skills' " +
    "name and description — never their bodies; skill_load the one you want.",
  readonly: true,
  schema: z.object({
    query: z.string().describe("Words to match against skill names, descriptions, and keywords."),
  }),
  async execute({ query }, ctx) {
    const allowed = ctxAllowedSkills(ctx.allowedSkills);
    const skills = listAvailableSkills(ctx.cwd).filter((s) => !allowed || allowed.has(s.name));
    if (skills.length === 0) return { content: NO_SKILLS };

    const terms = normalizeSkillName(query).split(" ").filter(Boolean);
    const scored = skills
      .map((skill) => {
        const hay = [skill.name, skill.description, ...skill.keywords].join(" ").toLowerCase();
        const score = terms.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0);
        return { skill, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name));

    if (scored.length === 0) {
      return { content: `No skills match "${query}".` };
    }
    return {
      content: [`Skills matching "${query}":`, ...scored.map((s) => `- ${formatSkill(s.skill)}`)].join("\n"),
    };
  },
});

export const skillLoadTool = defineTool({
  name: "skill_load",
  description:
    "Load a skill's full instructions by name. Returns the skill's operative " +
    "body; follow it for the current task. Files the skill mentions (scripts, " +
    "references) are relative to the skill directory given in the result.",
  readonly: true,
  schema: z.object({
    name: z.string().describe("The skill's name (e.g. 'release-flow')."),
  }),
  async execute({ name }, ctx) {
    const skills = listAvailableSkills(ctx.cwd);
    if (skills.length === 0) return { content: NO_SKILLS };

    const id = normalizeSkillName(name);
    const allowed = ctxAllowedSkills(ctx.allowedSkills);
    if (allowed && !allowed.has(id)) return { content: `Skill "${name}" is not enabled for this project.` };
    const skill = skills.find((s) => s.name === id);
    if (!skill) {
      return { content: `No skill named "${name}". Use skill_search to discover skills.` };
    }
    if (!skill.enabled) return { content: `Skill "${skill.name}" is disabled.` };

    let body: string;
    try {
      body = stripFrontmatter(await readFile(skill.file, "utf8"));
    } catch {
      return { content: `Skill "${skill.name}" has no readable body file.` };
    }

    ctx.onSkillLoaded?.(skill.name);
    const available = new Set(skills.filter((s) => s.enabled).map((s) => s.name));
    const related = skill.related.filter((r) => available.has(r));
    const tail =
      related.length > 0
        ? `\n\nRelated skills available (use skill_load): ${related.join(", ")}`
        : "";
    return {
      content: `<skill name="${skill.name}" dir="${skill.dir}">\n${body}${tail}\n</skill>`,
    };
  },
});

function ctxAllowedSkills(skills: readonly string[] | undefined): Set<string> | undefined {
  return skills ? new Set(skills.map(normalizeSkillName)) : undefined;
}

/** Remove a leading `--- ... ---` frontmatter block from a skill file. */
function stripFrontmatter(source: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return source.trim();
  const close = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (close === -1) return source.trim();
  return lines.slice(close + 1).join("\n").trim();
}
