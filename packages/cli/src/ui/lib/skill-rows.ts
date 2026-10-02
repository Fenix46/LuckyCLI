import type { AvailableSkill } from "@luckycli/core";

/** A row in the /skill "Installed" tab. */
export interface InstalledSkillRow {
  name: string;
  enabled: boolean;
  /** One-line summary shown next to the name. */
  summary: string;
  /** Search keywords, for the detail line. */
  keywords: string[];
  /** Project skills live in the repository; global ones in ~/.luckycli/skills. */
  scope: AvailableSkill["scope"];
  /** The skill's directory. */
  dir: string;
}

/** Shape the available skills (project and global) into installed-tab rows, sorted by name. */
export function buildInstalledSkillRows(skills: AvailableSkill[]): InstalledSkillRow[] {
  return [...skills]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({
      name: s.name,
      enabled: s.enabled,
      summary: s.description || "(no description)",
      keywords: s.keywords,
      scope: s.scope,
      dir: s.dir,
    }));
}
