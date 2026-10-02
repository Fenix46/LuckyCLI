/**
 * Every skill the agent can use in a working directory, from all places a
 * skill can live:
 *
 * - project: `<cwd>/.lucky/skills/<name>/` and `<cwd>/.claude/skills/<name>/`
 *   (checked into the repo, so the whole team shares them; `.claude/skills`
 *   makes skills written for Claude Code work as-is)
 * - global: `~/.luckycli/skills/<name>/` (installed with /skill add)
 *
 * A project skill shadows a global one of the same name. Synchronous on
 * purpose: the system prompt lists these at agent construction.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { normalizeSkillName, parseSkillFile } from "./skill-file.js";
import { findSkillFile, SKILL_GRAPH_DIR, skillsRootDir } from "./graph.js";

export interface AvailableSkill {
  /** Normalized name, the id used by skill_load and /skill use. */
  name: string;
  description: string;
  keywords: string[];
  related: string[];
  /** Absolute path of the skill file. */
  file: string;
  /** The skill's directory (bundled scripts and resources are relative to it). */
  dir: string;
  scope: "project" | "global";
  enabled: boolean;
}

/** Project skill directories for a working directory, in priority order. */
export function projectSkillRoots(cwd: string): string[] {
  return [join(cwd, ".lucky", "skills"), join(cwd, ".claude", "skills")];
}

/** Disabled global skill names (see saveDisabledSet), read synchronously. */
function readDisabledSync(root: string): Set<string> {
  try {
    const raw = JSON.parse(readFileSync(join(root, SKILL_GRAPH_DIR, "disabled.json"), "utf8")) as unknown;
    if (Array.isArray(raw)) return new Set(raw.map((s) => normalizeSkillName(String(s))));
  } catch {
    // absent or unreadable: nothing disabled
  }
  return new Set();
}

function skillsIn(root: string, scope: AvailableSkill["scope"], disabled: Set<string>): AvailableSkill[] {
  let entries: string[];
  try {
    entries = readdirSync(root, { withFileTypes: true })
      .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && d.name !== SKILL_GRAPH_DIR)
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
  const out: AvailableSkill[] = [];
  for (const entry of entries) {
    const file = findSkillFile(join(root, entry));
    if (!file) continue;
    try {
      const { frontmatter } = parseSkillFile(readFileSync(file, "utf8"));
      out.push({
        name: frontmatter.name,
        description: frontmatter.description,
        keywords: frontmatter.keywords,
        related: frontmatter.related,
        file,
        dir: dirname(file),
        scope,
        enabled: !disabled.has(frontmatter.name),
      });
    } catch {
      // An invalid skill file is skipped, never fatal.
    }
  }
  return out;
}

export function listAvailableSkills(cwd = process.cwd(), globalRoot = skillsRootDir()): AvailableSkill[] {
  const disabled = readDisabledSync(globalRoot);
  const byName = new Map<string, AvailableSkill>();
  const sources = [
    ...projectSkillRoots(cwd).map((root) => skillsIn(root, "project", disabled)),
    skillsIn(globalRoot, "global", disabled),
  ];
  for (const skills of sources) {
    for (const skill of skills) {
      if (!byName.has(skill.name)) byName.set(skill.name, skill);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The enabled skills a session may use, honoring a project allowlist. */
export function usableSkills(
  cwd = process.cwd(),
  allowedSkills?: readonly string[],
  globalRoot = skillsRootDir(),
): AvailableSkill[] {
  const allowed = allowedSkills ? new Set(allowedSkills.map(normalizeSkillName)) : undefined;
  return listAvailableSkills(cwd, globalRoot).filter((s) => s.enabled && (!allowed || allowed.has(s.name)));
}
