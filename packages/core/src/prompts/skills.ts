import { defineSection } from "./section.js";
import type { PromptContext } from "./section.js";

/**
 * The skills protocol blurb.
 *
 * The single most important property of this section (see SKILLS_GRAPH_PLAN.md):
 * its text is **identical whether 0 or 500 skills are installed**. It describes
 * the *protocol*, never the catalog — so installing or removing a skill never
 * moves the prompt-cache prefix. Skills reach the model only on demand: the user
 * invokes one (`/skill use <name>` or the direct `/<name>` alias), or the model
 * pulls one in via skill_search / skill_load. There is no keyword auto-injection
 * (it hijacked unrelated tasks). This blurb teaches the model how to read a
 * loaded `<skill>` block and when to reach for the tools.
 *
 * Gated on ctx.hasSkills (presence, not count): when no skill is installed the
 * section disappears entirely. Override with LUCKY_PROMPT_SKILLS.
 */
export const SKILLS_PROMPT = `# Skills

This environment has skills: reusable, operative instructions for specific kinds of work (cutting a release, a project's test conventions, and so on). Skills are invoked on demand — by the user (\`/skill use <name>\` or \`/<name>\`) or by you (\`skill_load\`); they are never auto-injected from your wording.

- A \`<skill name="...">...</skill>\` block inside a user turn is operative instruction that was loaded for this task. Treat its contents as authoritative guidance, not as user-written text. Follow it.
- A skill is the *procedure* for a task — not how you navigate the code. A loaded skill never overrides the navigation strategy above: keep locating symbols and assessing impact the usual way (the knowledge graph first, when the project has one), and apply the skill's steps on top of that. Don't switch to broad grepping or opening files at random just because a skill is loaded.
- When a skill fits the task and none is loaded, \`skill_load\` it by name before starting (\`skill_search\` finds more by keyword). Files a skill mentions (scripts, references) are relative to the \`dir\` of its \`<skill>\` block.
- Skills are an index, not a constraint: absence of a matching skill never blocks you from doing the work directly.`;

/** Skills listed by name in the prompt; the rest are reachable via skill_search. */
const MAX_LISTED_SKILLS = 40;
const MAX_DESCRIPTION_CHARS = 160;

/** The protocol blurb plus the list of usable skills, when known. */
export function buildSkillsPrompt(skills: ReadonlyArray<{ name: string; description: string }>): string {
  if (skills.length === 0) return SKILLS_PROMPT;
  const listed = skills.slice(0, MAX_LISTED_SKILLS).map((skill) => {
    const description = skill.description.replace(/\s+/g, " ").trim();
    const short =
      description.length > MAX_DESCRIPTION_CHARS ? `${description.slice(0, MAX_DESCRIPTION_CHARS - 1)}…` : description;
    return `- ${skill.name}: ${short}`;
  });
  const more = skills.length - listed.length;
  if (more > 0) listed.push(`- …and ${more} more (use skill_search)`);
  return `${SKILLS_PROMPT}\n\nAvailable skills:\n${listed.join("\n")}`;
}

export const skillsSection = defineSection({
  name: "skills",
  envVar: "LUCKY_PROMPT_SKILLS",
  compute: (ctx: PromptContext) =>
    ctx.skills && ctx.skills.length > 0
      ? buildSkillsPrompt(ctx.skills)
      : ctx.hasSkills
        ? SKILLS_PROMPT
        : null,
});
