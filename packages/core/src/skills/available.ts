/**
 * Every skill the agent can use in a working directory, from all places a
 * skill can live.
 *
 * LuckyCLI has **canonical** roots, where it installs and writes:
 *
 * - project: `<cwd>/.lucky/skills/<name>/`
 * - global:  `~/.luckycli/skills/<name>/` (installed with `/skill add`)
 *
 * and read-only **compatibility** roots, so skills published for the wider
 * agent ecosystem work as-is:
 *
 * - project: `<cwd>/.agents/skills/<name>/`, `<cwd>/.claude/skills/<name>/`
 * - global:  `~/.agents/skills/<name>/`, `~/.claude/skills/<name>/`
 *
 * The order below is also the shadowing order: a project skill beats a global
 * one, and within the same scope the lucky root wins over the compatibility
 * roots. Only the canonical global root is written to; see install.ts.
 *
 * Synchronous on purpose: the system prompt lists these at agent construction.
 */
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { normalizeSkillName, parseSkillFile } from "./skill-file.js";
import { findSkillFile, SKILL_GRAPH_DIR, skillsRootDir } from "./graph.js";

/** Where a skill came from: lucky's own roots or a compatibility root. */
export type SkillOrigin = "lucky" | "agents" | "claude";

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
  origin: SkillOrigin;
  enabled: boolean;
}

interface SkillRoot {
  dir: string;
  origin: SkillOrigin;
}

/**
 * Project skill roots for a working directory, in shadowing order: lucky's own
 * root first, then the cross-agent and Claude Code roots.
 */
export function projectSkillRoots(cwd: string): string[] {
  return projectSkillSources(cwd).map((root) => root.dir);
}

function projectSkillSources(cwd: string): SkillRoot[] {
  return [
    { dir: join(cwd, ".lucky", "skills"), origin: "lucky" },
    { dir: join(cwd, ".agents", "skills"), origin: "agents" },
    { dir: join(cwd, ".claude", "skills"), origin: "claude" },
  ];
}

/**
 * Global skill roots in shadowing order. `root` is the canonical lucky root;
 * the compatibility roots are only appended when it is the real default, so a
 * caller that passes a temporary root (tests, alternate installs) stays
 * isolated from the user's home.
 */
export function globalSkillRoots(
  root = skillsRootDir(),
  home = homedir(),
): string[] {
  return globalSkillSources(root, home).map((source) => source.dir);
}

function globalSkillSources(root: string, home: string): SkillRoot[] {
  const sources: SkillRoot[] = [{ dir: root, origin: "lucky" }];
  if (root === join(home, ".luckycli", "skills")) {
    sources.push({ dir: join(home, ".agents", "skills"), origin: "agents" });
    sources.push({ dir: join(home, ".claude", "skills"), origin: "claude" });
  }
  return sources;
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

function skillsIn(
  root: string,
  scope: AvailableSkill["scope"],
  origin: SkillOrigin,
  disabled: Set<string>,
): AvailableSkill[] {
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
        origin,
        enabled: !disabled.has(frontmatter.name),
      });
    } catch {
      // An invalid skill file is skipped, never fatal.
    }
  }
  return out;
}

export function listAvailableSkills(
  cwd = process.cwd(),
  globalRoot = skillsRootDir(),
  home = homedir(),
): AvailableSkill[] {
  const disabled = readDisabledSync(globalRoot);
  const byName = new Map<string, AvailableSkill>();
  const sources = [
    ...projectSkillSources(cwd).map((root) => skillsIn(root.dir, "project", root.origin, disabled)),
    ...globalSkillSources(globalRoot, home).map((root) => skillsIn(root.dir, "global", root.origin, disabled)),
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
  home = homedir(),
): AvailableSkill[] {
  const allowed = allowedSkills ? new Set(allowedSkills.map(normalizeSkillName)) : undefined;
  return listAvailableSkills(cwd, globalRoot, home).filter(
    (s) => s.enabled && (!allowed || allowed.has(s.name)),
  );
}
