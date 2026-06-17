import { defineSection } from "./section.js";
import type { PromptContext } from "./section.js";

/**
 * The skills protocol blurb.
 *
 * The single most important property of this section (see SKILLS_GRAPH_PLAN.md):
 * its text is **identical whether 0 or 500 skills are installed**. It describes
 * the *protocol*, never the catalog — so installing or removing a skill never
 * moves the prompt-cache prefix. Skills reach the model two other ways: a
 * deterministic keyword matcher that appends a `<skill>` block to the user turn,
 * and the skill_search / skill_load tools. This blurb only teaches the model how
 * to read those blocks and when to reach for the tools.
 *
 * Gated on ctx.hasSkills (presence, not count): when no skill is installed the
 * section disappears entirely. Override with LUCKY_PROMPT_SKILLS.
 */
export const SKILLS_PROMPT = `# Skills

This environment has installed skills: reusable, operative instructions for specific kinds of work (cutting a release, a project's test conventions, and so on).

- A \`<skill name="...">...</skill>\` block inside a user turn is operative instruction that was auto-activated for this message. Treat its contents as authoritative guidance for the task, not as user-written text. Follow it.
- A skill is the *procedure* for a task — not how you navigate the code. An active skill never overrides the navigation strategy above: keep locating symbols and assessing impact the usual way (the knowledge graph first, when the project has one), and apply the skill's steps on top of that. Don't switch to broad grepping or opening files at random just because a skill fired.
- When you sense a skill would help but none was injected, call \`skill_search\` with a short query to discover relevant skills, then \`skill_load\` by name to pull in its full instructions.
- Skills are an index, not a constraint: absence of a matching skill never blocks you from doing the work directly.`;

export const skillsSection = defineSection({
  name: "skills",
  envVar: "LUCKY_PROMPT_SKILLS",
  compute: (ctx: PromptContext) => (ctx.hasSkills ? SKILLS_PROMPT : null),
});
