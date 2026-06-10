/**
 * Remote skill catalog: discover and download skills published on the web.
 *
 * A catalog is just a static JSON index plus the skill.md bodies it points at —
 * cheap to host (a GitHub repo, a CDN, anything serving files). The default
 * points at lucky's own starter catalog; override with LUCKY_SKILL_CATALOG_URL
 * or by constructing with a different base URL. The shape mirrors the MCP
 * catalog (a network `source` wrapped so installs work offline against cache),
 * with an injectable `fetch` so tests never touch the network.
 *
 * index.json shape (at `${baseUrl}/index.json`):
 *   { "skills": [ { "name", "description", "keywords": [...], "path": "release-flow/skill.md" }, ... ] }
 * Each entry's `path` is resolved against baseUrl to fetch the skill.md body.
 */
import { z } from "zod";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseSkillFile } from "./skill-file.js";
import { rebuildSkillGraph, skillFilePath, skillsRootDir } from "./graph.js";
import type { InstallResult } from "./install.js";

const DEFAULT_BASE_URL = "https://luckycli.dev/skills";

type FetchLike = typeof fetch;

/** One catalog entry as published in index.json. */
export const CatalogSkillSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().default(""),
    keywords: z.array(z.string()).default([]),
    /** Relative path of the skill.md under the catalog base URL. */
    path: z.string().min(1),
  })
  .strip();
export type CatalogSkill = z.infer<typeof CatalogSkillSchema>;

const CatalogIndexSchema = z.object({ skills: z.array(CatalogSkillSchema).default([]) });

/**
 * A read-only view over a remote catalog. `search` filters the index by a query
 * (name/description/keyword substring); `fetchBody` downloads a skill.md body.
 */
export class SkillCatalog {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;
  private indexCache: CatalogSkill[] | null = null;

  constructor(options: { baseUrl?: string; fetchFn?: FetchLike } = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.LUCKY_SKILL_CATALOG_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchFn = options.fetchFn ?? fetch;
  }

  /** Fetch and parse the catalog index (memoized for this instance). */
  async index(): Promise<CatalogSkill[]> {
    if (this.indexCache) return this.indexCache;
    const res = await this.fetchFn(`${this.baseUrl}/index.json`);
    if (!res.ok) throw new Error(`Failed to fetch skill catalog index (HTTP ${res.status}).`);
    const parsed = CatalogIndexSchema.parse(await res.json());
    this.indexCache = parsed.skills;
    return parsed.skills;
  }

  /** Catalog entries matching `query` (empty query → the whole index). */
  async search(query: string): Promise<CatalogSkill[]> {
    const all = await this.index();
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return all;
    return all
      .map((s) => {
        const hay = [s.name, s.description, ...s.keywords].join(" ").toLowerCase();
        const score = terms.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0);
        return { s, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name))
      .map((x) => x.s);
  }

  /** Look up a single catalog entry by name. */
  async get(name: string): Promise<CatalogSkill | null> {
    const lower = name.trim().toLowerCase();
    return (await this.index()).find((s) => s.name.toLowerCase() === lower) ?? null;
  }

  /** Download a catalog entry's skill.md body text. */
  async fetchBody(entry: CatalogSkill): Promise<string> {
    const res = await this.fetchFn(`${this.baseUrl}/${entry.path.replace(/^\/+/, "")}`);
    if (!res.ok) throw new Error(`Failed to download skill "${entry.name}" (HTTP ${res.status}).`);
    return res.text();
  }
}

/**
 * Resolve a catalog entry by name, download its body, validate it, write it to
 * the global skills dir, and rebuild the graph. Rejects an unknown name, an
 * invalid body, or a collision (unless overwrite). Returns the install location.
 */
export async function installCatalogSkill(
  name: string,
  options: { catalog?: SkillCatalog; overwrite?: boolean; root?: string } = {},
): Promise<InstallResult> {
  const root = options.root ?? skillsRootDir();
  const catalog = options.catalog ?? new SkillCatalog();
  const entry = await catalog.get(name);
  if (!entry) throw new Error(`No skill named "${name}" in the catalog.`);

  const body = await catalog.fetchBody(entry);
  // Validate before writing; the installed name comes from the body's own
  // frontmatter (the catalog's name is just an index key).
  const { frontmatter } = parseSkillFile(body);
  const destFile = skillFilePath(frontmatter.name, root);

  const exists = await stat(destFile).catch(() => null);
  if (exists && !options.overwrite) {
    throw new Error(`A skill named "${frontmatter.name}" is already installed (use overwrite to replace).`);
  }

  await mkdir(dirname(destFile), { recursive: true });
  await writeFile(destFile, body, "utf8");
  await rebuildSkillGraph(root);
  return { name: frontmatter.name, dir: dirname(destFile) };
}
