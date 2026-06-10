/**
 * Building and persisting the skill graph from the on-disk skills directory.
 *
 * Skills are global (per-user, not per-project), living under
 * `~/.luckycli/skills/<name>/skill.md`. The graph is a small index — a few
 * hundred tiny files at most — so we rebuild it from scratch on every
 * install/remove/enable rather than maintaining it incrementally; the cost is
 * negligible and the code stays obviously correct.
 *
 * Persistence mirrors graph/store.ts: validate-before-write, validate-after-read,
 * versioned pretty JSON, so a hand-edited or corrupt graph fails loudly.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { normalizeSkillName, parseSkillFile } from "./skill-file.js";
import {
  type SkillEdge,
  type SkillGraph,
  type SkillNode,
  assertValidSkillGraph,
  emptySkillGraph,
  keywordNodeId,
  parseSkillGraph,
  skillNodeId,
} from "./types.js";

export const SKILL_GRAPH_DIR = "graph";
export const SKILL_GRAPH_FILE = "graph.json";
export const SKILL_FILE_NAME = "skill.md";

/** Absolute path of the global skills root (`~/.luckycli/skills`). */
export function skillsRootDir(): string {
  return join(homedir(), ".luckycli", "skills");
}

/** Absolute path of the persisted skill-graph file. */
export function skillGraphFilePath(root = skillsRootDir()): string {
  return join(root, SKILL_GRAPH_DIR, SKILL_GRAPH_FILE);
}

/** Absolute path of a skill's directory. */
export function skillDirPath(name: string, root = skillsRootDir()): string {
  return join(root, normalizeSkillName(name));
}

/** Absolute path of a skill's `skill.md`. */
export function skillFilePath(name: string, root = skillsRootDir()): string {
  return join(skillDirPath(name, root), SKILL_FILE_NAME);
}

/** A parsed skill discovered on disk, before graph assembly. */
export interface DiscoveredSkill {
  name: string;
  description: string;
  keywords: string[];
  related: string[];
  /** Path of the body file, relative to the skills root. */
  bodyPath: string;
  enabled: boolean;
}

/**
 * Names of disabled skills, persisted next to the graph in `disabled.json`.
 * Kept separate from skill.md so toggling never rewrites a user's file.
 */
function disabledFilePath(root: string): string {
  return join(root, SKILL_GRAPH_DIR, "disabled.json");
}

/** Read the set of disabled skill names (normalized). Empty if absent. */
export async function loadDisabledSet(root = skillsRootDir()): Promise<Set<string>> {
  try {
    const raw = await readFile(disabledFilePath(root), "utf8");
    const arr = JSON.parse(raw) as unknown;
    if (Array.isArray(arr)) return new Set(arr.map((s) => normalizeSkillName(String(s))));
  } catch (err) {
    if ((err as { code?: unknown }).code !== "ENOENT") throw err;
  }
  return new Set();
}

/** Persist the set of disabled skill names. */
export async function saveDisabledSet(names: Set<string>, root = skillsRootDir()): Promise<void> {
  const path = disabledFilePath(root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify([...names].sort(), null, 2)}\n`, "utf8");
}

/**
 * Discover and parse every `skill.md` under the skills root. Skips the graph
 * directory and any entry without a readable, valid skill.md. Throws on a
 * duplicate skill name (the root invariant the rest of the system relies on).
 */
export async function discoverSkills(root = skillsRootDir()): Promise<DiscoveredSkill[]> {
  let entries: string[];
  try {
    const dirents = await readdir(root, { withFileTypes: true });
    entries = dirents.filter((d) => d.isDirectory() && d.name !== SKILL_GRAPH_DIR).map((d) => d.name);
  } catch (err) {
    if ((err as { code?: unknown }).code === "ENOENT") return [];
    throw err;
  }

  const disabled = await loadDisabledSet(root);
  const found: DiscoveredSkill[] = [];
  const seen = new Set<string>();
  for (const entry of entries.sort()) {
    const filePath = join(root, entry, SKILL_FILE_NAME);
    let source: string;
    try {
      source = await readFile(filePath, "utf8");
    } catch (err) {
      if ((err as { code?: unknown }).code === "ENOENT") continue;
      throw err;
    }
    const { frontmatter } = parseSkillFile(source);
    const name = frontmatter.name;
    if (seen.has(name)) {
      throw new Error(`Duplicate skill name '${name}' (found in directory '${entry}')`);
    }
    seen.add(name);
    found.push({
      name,
      description: frontmatter.description,
      keywords: frontmatter.keywords,
      related: frontmatter.related,
      bodyPath: join(entry, SKILL_FILE_NAME),
      enabled: !disabled.has(name),
    });
  }
  return found;
}

/**
 * Assemble a skill graph from discovered skills. Disabled skills still get a
 * `skill` node (so the menu can list and re-enable them) but contribute no
 * `triggers` edges, so they are invisible to the automatic matcher.
 * `related_to` edges are created only when the target skill also exists.
 */
export function buildSkillGraph(skills: DiscoveredSkill[], root: string): SkillGraph {
  const graph = emptySkillGraph(root);
  const nodes = new Map<string, SkillNode>();
  const edges: SkillEdge[] = [];
  const skillIds = new Set(skills.map((s) => skillNodeId(s.name)));

  for (const skill of skills) {
    const id = skillNodeId(skill.name);
    nodes.set(id, {
      id,
      label: skill.name,
      kind: "skill",
      attrs: {
        description: skill.description,
        bodyPath: skill.bodyPath,
        enabled: skill.enabled,
      },
    });

    if (skill.enabled) {
      for (const kw of skill.keywords) {
        const kwId = keywordNodeId(kw);
        if (!nodes.has(kwId)) {
          nodes.set(kwId, { id: kwId, label: kw, kind: "keyword" });
        }
        edges.push({ source: kwId, target: id, relation: "triggers" });
      }
    }

    for (const rel of skill.related) {
      const target = skillNodeId(rel);
      if (skillIds.has(target) && target !== id) {
        edges.push({ source: id, target, relation: "related_to" });
      }
    }
  }

  graph.nodes = [...nodes.values()];
  graph.edges = edges;
  graph.meta.skillCount = skills.length;
  return graph;
}

/** Validate and write the skill graph as pretty JSON, creating dirs as needed. */
export async function saveSkillGraph(graph: SkillGraph): Promise<string> {
  assertValidSkillGraph(graph);
  const path = skillGraphFilePath(graph.meta.root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
  return path;
}

/** Read, parse, and validate the persisted skill graph. Throws if absent. */
export async function loadSkillGraph(root = skillsRootDir()): Promise<SkillGraph> {
  const raw = await readFile(skillGraphFilePath(root), "utf8");
  const graph = parseSkillGraph(JSON.parse(raw));
  assertValidSkillGraph(graph);
  return graph;
}

/** Like {@link loadSkillGraph} but returns null when the file doesn't exist. */
export async function tryLoadSkillGraph(root = skillsRootDir()): Promise<SkillGraph | null> {
  try {
    return await loadSkillGraph(root);
  } catch (err) {
    if ((err as { code?: unknown }).code === "ENOENT") return null;
    throw err;
  }
}

/** Discover → build → persist in one step. Returns the saved graph. */
export async function rebuildSkillGraph(root = skillsRootDir()): Promise<SkillGraph> {
  const skills = await discoverSkills(root);
  const graph = buildSkillGraph(skills, root);
  await saveSkillGraph(graph);
  return graph;
}
