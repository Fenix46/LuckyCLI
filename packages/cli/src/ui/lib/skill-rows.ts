import type { DiscoveredSkill } from "@luckycli/core";

/** A row in the /skill "Installed" tab. */
export interface InstalledSkillRow {
  name: string;
  enabled: boolean;
  /** One-line summary shown next to the name. */
  summary: string;
  /** Keywords that trigger it, for the detail line. */
  keywords: string[];
}

/** Shape discovered skills into installed-tab rows, sorted by name. */
export function buildInstalledSkillRows(skills: DiscoveredSkill[]): InstalledSkillRow[] {
  return [...skills]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({
      name: s.name,
      enabled: s.enabled,
      summary: s.description || "(no description)",
      keywords: s.keywords,
    }));
}
