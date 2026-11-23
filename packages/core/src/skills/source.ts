/**
 * Installing a skill from a source other than a local path: `owner/repo`,
 * a git URL, or a checkout that contains several skills.
 *
 * The skill format is already portable; what a standard installer needs is the
 * last mile — find the `SKILL.md` directories in a repository and copy the
 * selected one (with its assets) into lucky's canonical skills root.
 *
 * No new dependency: git is already a prerequisite of the project. The clone is
 * shallow, never recursive, never runs anything from the repository, and the
 * temporary checkout is always removed. The cloner is injectable so tests stay
 * offline and deterministic.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { expandHomePath, installSkillFromPath, type InstallResult } from "./install.js";
import { findSkillFile, skillsRootDir } from "./graph.js";
import { normalizeSkillName, parseSkillFile } from "./skill-file.js";

const execFileAsync = promisify(execFile);

/** A parsed source spec: a path on disk or a git repository. */
export type SkillSource =
  | { kind: "local"; path: string }
  | { kind: "git"; url: string; ref?: string; subpath?: string };

/** One skill found inside a source checkout. */
export interface SkillSourceCandidate {
  /** Normalized name from the skill's own frontmatter. */
  name: string;
  description: string;
  /** Absolute directory that contains the skill file. */
  dir: string;
  /** Path relative to the source root, for display and error messages. */
  relativePath: string;
}

/** Clone a git repository into `dest`. Injectable for offline tests. */
export type SkillSourceCloner = (
  url: string,
  dest: string,
  ref?: string,
) => Promise<void>;

export interface SkillSourceOptions {
  /** Base for relative local paths. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Home used for `~` expansion. Defaults to the real home. */
  home?: string;
  /** Existence check for the local-vs-GitHub heuristic. Injectable for tests. */
  exists?: (path: string) => boolean;
  /** Override the cloner (tests); defaults to the shallow `git clone`. */
  clone?: SkillSourceCloner;
  /** Maximum directory depth searched for skills. */
  maxDepth?: number;
}

export interface InstallFromSourceOptions extends SkillSourceOptions {
  /** Install only the skill with this (normalized) name. */
  skill?: string;
  /** Install every skill found in the source. */
  all?: boolean;
  /** Replace an already installed skill of the same name. */
  overwrite?: boolean;
  /** Destination root; defaults to the canonical lucky skills root. */
  root?: string;
  /** Git ref (branch or tag) to check out. */
  ref?: string;
  /** Subdirectory of the repository that holds the skill(s). */
  subpath?: string;
}

const GITHUB_PREFIX = "https://github.com/";
const CLONE_TIMEOUT_MS = 120_000;
const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", ".venv", "vendor"]);

/**
 * Classify a source spec:
 * - `~/x`, `/x`, `./x`, an existing relative path → local path
 * - anything with `://` or starting with `git@` → git URL
 * - `owner/repo` → the matching GitHub repository
 * - anything else → local path (so a typo keeps a filesystem error)
 */
export function parseSkillSource(
  spec: string,
  options: Pick<SkillSourceOptions, "cwd" | "home" | "exists"> = {},
): SkillSource {
  const trimmed = spec.trim();
  if (trimmed === "") throw new Error("Skill source is empty.");

  const cwd = options.cwd ?? process.cwd();
  const exists = options.exists ?? existsSync;
  const home = options.home;

  const localPath = (value: string): { kind: "local"; path: string } => {
    const expanded = expandHomePath(value, home);
    return { kind: "local", path: isAbsolute(expanded) ? expanded : resolve(cwd, expanded) };
  };

  if (trimmed === "~" || trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return localPath(trimmed);
  }
  if (trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return localPath(trimmed);
  }
  if (trimmed.includes("://") || trimmed.startsWith("git@")) {
    return { kind: "git", url: trimmed };
  }

  const local = localPath(trimmed);
  if (exists(local.path)) return local;

  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
    return { kind: "git", url: `${GITHUB_PREFIX}${trimmed.replace(/\.git$/, "")}.git` };
  }
  return local;
}

/** The default cloner: shallow, single-branch, no submodules, no prompts. */
export const gitClone: SkillSourceCloner = async (url, dest, ref) => {
  const args = ["clone", "--depth", "1", "--single-branch", "--no-recurse-submodules"];
  if (ref) args.push("--branch", ref);
  args.push("--", url, dest);
  try {
    await execFileAsync("git", args, {
      timeout: CLONE_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "echo" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to clone ${url}: ${message}`);
  }
};

/**
 * Recursively find directories containing `SKILL.md` (or lucky's `skill.md`).
 * Stops descending once a skill directory is found, skips dependency/build
 * directories, and bounds the walk so a huge checkout cannot hang the command.
 */
export async function findSkillDirs(
  root: string,
  maxDepth = 5,
): Promise<Array<{ dir: string; relativePath: string }>> {
  const found: Array<{ dir: string; relativePath: string }> = [];
  let visited = 0;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth || visited > 10_000) return;
    visited++;
    if (findSkillFile(dir)) {
      found.push({ dir, relativePath: relative(root, dir) || "." });
      return;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (IGNORED_DIRS.has(entry.name)) continue;
      await walk(join(dir, entry.name), depth + 1);
    }
  }

  await walk(root, 0);
  return found.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function readCandidates(
  root: string,
  dirs: Array<{ dir: string; relativePath: string }>,
): Promise<SkillSourceCandidate[]> {
  const byName = new Map<string, SkillSourceCandidate>();
  for (const { dir, relativePath } of dirs) {
    const file = findSkillFile(dir);
    if (!file) continue;
    try {
      const { frontmatter } = parseSkillFile(await readFile(file, "utf8"));
      const candidate: SkillSourceCandidate = {
        name: frontmatter.name,
        description: frontmatter.description,
        dir,
        relativePath,
      };
      // Two skills with the same normalized name would install over each other;
      // keep the first (sorted) and let selection by name stay deterministic.
      if (!byName.has(candidate.name)) byName.set(candidate.name, candidate);
    } catch {
      // A malformed skill in a repository must not block installing the others.
    }
  }
  return [...byName.values()];
}

interface MaterializedSource {
  root: string;
  skills: SkillSourceCandidate[];
  cleanup: () => Promise<void>;
}

async function materializeSource(
  spec: string,
  options: InstallFromSourceOptions,
): Promise<MaterializedSource> {
  const source = parseSkillSource(spec, options);
  if (source.kind === "local") {
    const st = await stat(source.path).catch(() => null);
    if (!st) throw new Error(`No such skill source: ${source.path}`);
    if (st.isFile()) {
      const { frontmatter } = parseSkillFile(await readFile(source.path, "utf8"));
      return {
        root: dirname(source.path),
        skills: [
          {
            name: frontmatter.name,
            description: frontmatter.description,
            dir: dirname(source.path),
            relativePath: source.path.slice(dirname(source.path).length + 1),
          },
        ],
        cleanup: async () => {},
      };
    }
    const root = resolveSourceSubpath(source.path, options.subpath);
    const dirs = await findSkillDirs(root, options.maxDepth);
    return {
      root,
      skills: await readCandidates(root, dirs),
      cleanup: async () => {},
    };
  }

  const temp = await mkdtemp(join(tmpdir(), "lucky-skill-source-"));
  const cleanup = async () => {
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  };
  try {
    await (options.clone ?? gitClone)(source.url, temp, options.ref);
    const root = resolveSourceSubpath(temp, options.subpath);
    const dirs = await findSkillDirs(root, options.maxDepth);
    return { root, skills: await readCandidates(root, dirs), cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/** Resolve and validate an optional subdirectory inside a source root. */
function resolveSourceSubpath(root: string, subpath: string | undefined): string {
  if (!subpath) return root;
  const target = resolve(root, subpath);
  const rel = relative(resolve(root), target);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith("..")) {
    throw new Error(`Skill subpath escapes the source root: ${subpath}`);
  }
  return target;
}

function skillList(skills: SkillSourceCandidate[]): string {
  return skills.map((s) => `  • ${s.name} (${s.relativePath})`).join("\n");
}

/** Pick the skills to install, or throw a message the user can act on. */
function selectCandidates(
  skills: SkillSourceCandidate[],
  spec: string,
  options: Pick<InstallFromSourceOptions, "skill" | "all">,
): SkillSourceCandidate[] {
  if (skills.length === 0) {
    throw new Error(`No SKILL.md found in ${spec}.`);
  }
  if (options.all) return skills;
  if (options.skill) {
    const wanted = normalizeSkillName(options.skill);
    const match = skills.find((s) => s.name === wanted);
    if (!match) {
      throw new Error(`No skill named "${options.skill}" in ${spec}. Found:\n${skillList(skills)}`);
    }
    return [match];
  }
  if (skills.length === 1) return skills;
  throw new Error(
    `Found ${skills.length} skills in ${spec}. Pick one with skill, or install all of them:\n${skillList(skills)}`,
  );
}

/**
 * Install one or more skills from a local or git source into the canonical
 * root. Returns every install result; the caller gets a single, actionable
 * error when a source contains several skills and no selection was made.
 */
export async function installSkillFromSource(
  spec: string,
  options: InstallFromSourceOptions = {},
): Promise<InstallResult[]> {
  const root = options.root ?? skillsRootDir();
  const materialized = await materializeSource(spec, options);
  try {
    const selected = selectCandidates(materialized.skills, spec, options);
    const results: InstallResult[] = [];
    for (const candidate of selected) {
      results.push(
        await installSkillFromPath(candidate.dir, {
          root,
          ...(options.overwrite !== undefined ? { overwrite: options.overwrite } : {}),
          ...(options.home ? { home: options.home } : {}),
        }),
      );
    }
    return results;
  } finally {
    await materialized.cleanup();
  }
}
