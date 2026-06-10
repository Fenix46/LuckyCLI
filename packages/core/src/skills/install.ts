/**
 * Install / uninstall / enable-disable operations on the global skills dir.
 *
 * These are the mutating counterparts to graph.ts's read side. Each one leaves
 * the on-disk skill graph consistent by rebuilding it (cheap — a handful of tiny
 * files), so callers never have to remember to rebuild. The skills root is
 * `~/.luckycli/skills/<name>/skill.md`; uninstall removes a whole skill dir,
 * enable/disable flips membership in `disabled.json` without touching skill.md.
 */
import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { normalizeSkillName, parseSkillFile } from "./skill-file.js";
import {
  SKILL_FILE_NAME,
  discoverSkills,
  loadDisabledSet,
  rebuildSkillGraph,
  saveDisabledSet,
  skillDirPath,
  skillFilePath,
  skillsRootDir,
} from "./graph.js";

/** Outcome of an install: the normalized skill name and where it landed. */
export interface InstallResult {
  name: string;
  dir: string;
}

/**
 * Locate a `skill.md` given a path that may be the file itself or a directory
 * containing it. Returns the file path, or throws if neither exists.
 */
async function resolveSkillSource(source: string): Promise<string> {
  const st = await stat(source).catch(() => null);
  if (!st) throw new Error(`No such path: ${source}`);
  if (st.isDirectory()) {
    const candidate = join(source, SKILL_FILE_NAME);
    const cst = await stat(candidate).catch(() => null);
    if (!cst?.isFile()) throw new Error(`No ${SKILL_FILE_NAME} found in ${source}`);
    return candidate;
  }
  return source;
}

/**
 * Install a skill from a local file or directory into the global skills dir.
 * The skill's name comes from its frontmatter (not the source path), so the
 * installed directory is always the canonical normalized name. Rejects a name
 * collision unless `overwrite` is set. Rebuilds the graph and returns the
 * install location.
 */
export async function installSkillFromPath(
  source: string,
  options: { overwrite?: boolean; root?: string } = {},
): Promise<InstallResult> {
  const root = options.root ?? skillsRootDir();
  const filePath = await resolveSkillSource(source);
  const { frontmatter } = parseSkillFile(await readFile(filePath, "utf8"));
  const name = frontmatter.name;
  const destDir = skillDirPath(name, root);

  const exists = await stat(destDir).catch(() => null);
  if (exists && !options.overwrite) {
    throw new Error(`A skill named "${name}" is already installed (use overwrite to replace).`);
  }
  if (exists) await rm(destDir, { recursive: true, force: true });

  await mkdir(destDir, { recursive: true });
  // Copy the whole source directory (a skill may ship assets beside skill.md),
  // or just the single file when the source was a bare skill.md.
  const srcIsDir = (await stat(source).catch(() => null))?.isDirectory() ?? false;
  if (srcIsDir) {
    await cp(dirname(filePath), destDir, { recursive: true });
  } else {
    await cp(filePath, join(destDir, SKILL_FILE_NAME));
  }

  await rebuildSkillGraph(root);
  return { name, dir: destDir };
}

/**
 * Remove an installed skill's directory entirely and rebuild the graph. Also
 * drops it from the disabled set so a later reinstall starts enabled. Returns
 * false if no such skill was installed.
 */
export async function uninstallSkill(name: string, root = skillsRootDir()): Promise<boolean> {
  const dir = skillDirPath(name, root);
  const exists = await stat(dir).catch(() => null);
  if (!exists) return false;
  await rm(dir, { recursive: true, force: true });

  const disabled = await loadDisabledSet(root);
  if (disabled.delete(normalizeSkillName(name))) await saveDisabledSet(disabled, root);

  await rebuildSkillGraph(root);
  return true;
}

/**
 * Enable or disable an installed skill (membership in disabled.json) and rebuild
 * the graph so the trigger index reflects the change. Returns false if no such
 * skill is installed.
 */
export async function setSkillEnabled(
  name: string,
  enabled: boolean,
  root = skillsRootDir(),
): Promise<boolean> {
  const filePath = skillFilePath(name, root);
  const exists = await stat(filePath).catch(() => null);
  if (!exists?.isFile()) return false;

  const normalized = normalizeSkillName(name);
  const disabled = await loadDisabledSet(root);
  const had = disabled.has(normalized);
  if (enabled && had) disabled.delete(normalized);
  else if (!enabled && !had) disabled.add(normalized);
  else return true; // already in the requested state
  await saveDisabledSet(disabled, root);

  await rebuildSkillGraph(root);
  return true;
}

/** Toggle a skill's enabled state. Returns the new state, or null if absent. */
export async function toggleSkillEnabled(
  name: string,
  root = skillsRootDir(),
): Promise<boolean | null> {
  const skills = await discoverSkills(root);
  const normalized = normalizeSkillName(name);
  const current = skills.find((s) => s.name === normalized);
  if (!current) return null;
  const next = !current.enabled;
  await setSkillEnabled(normalized, next, root);
  return next;
}
