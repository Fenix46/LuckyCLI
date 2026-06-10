/**
 * Parsing and validation of a single `skill.md` file.
 *
 * A skill is a plain markdown file: a small YAML-ish frontmatter block
 * (delimited by `---` lines) holding the metadata that goes into the skill
 * graph, followed by the body — the operative instructions that are read from
 * disk only when the skill activates (see SKILLS_GRAPH_PLAN.md). Frontmatter is
 * the only required structure; the body is everything after the closing `---`.
 *
 * We deliberately do not pull in a YAML dependency: skill frontmatter is a tiny,
 * fixed shape (`name`, `description`, `keywords`, `related`), so a focused
 * line parser keeps the format obvious and the failure messages precise. zod is
 * the single source of truth for the validated shape, mirroring graph/types.ts.
 */
import { z } from "zod";

/**
 * Normalize a skill/keyword name into its canonical, comparable form:
 * trimmed, lowercased, internal whitespace runs collapsed to single spaces.
 * Skill names are matched case-insensitively and keywords are matched against a
 * normalized message, so both go through here.
 */
export function normalizeSkillName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/** A keyword/phrase: non-empty after normalization. */
const KeywordSchema = z
  .string()
  .transform(normalizeSkillName)
  .refine((s) => s.length > 0, "keyword must be non-empty");

/**
 * Validated frontmatter of a skill. `keywords` drives the deterministic
 * trigger index; `related` names may dangle (the edge is created if/when the
 * target skill is installed), matching the code graph's forgiving spirit.
 */
export const SkillFrontmatterSchema = z
  .object({
    /** Unique kebab-case identifier; normalized for matching. */
    name: z
      .string()
      .transform(normalizeSkillName)
      .refine((s) => s.length > 0, "name must be non-empty"),
    /** One line describing when this skill applies. */
    description: z.string().trim().min(1, "description must be non-empty"),
    /** Trigger tokens/phrases. Must be present and non-empty. */
    keywords: z
      .array(KeywordSchema)
      .min(1, "at least one keyword is required")
      .transform((ks) => [...new Set(ks)]),
    /** Names of related skills; may dangle. Defaults to empty. */
    related: z
      .array(z.string().transform(normalizeSkillName).refine((s) => s.length > 0))
      .transform((rs) => [...new Set(rs)])
      .default([]),
  })
  .strict();
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

/** A fully parsed skill file: validated frontmatter + the raw body text. */
export interface SkillFile {
  frontmatter: SkillFrontmatter;
  /** Everything after the closing `---`, trimmed of surrounding blank lines. */
  body: string;
}

/**
 * Split a `skill.md` into its frontmatter block and body. Returns the raw
 * frontmatter lines (between the delimiters) and the body. Throws if the file
 * does not start with a `---` line or has no closing `---`.
 */
function splitFrontmatter(source: string): { frontmatterLines: string[]; body: string } {
  // Normalize line endings so \r\n files parse identically.
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") {
    throw new Error("skill file must start with a '---' frontmatter delimiter");
  }
  const closeIdx = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (closeIdx === -1) {
    throw new Error("skill frontmatter is missing its closing '---' delimiter");
  }
  return {
    frontmatterLines: lines.slice(1, closeIdx),
    body: lines.slice(closeIdx + 1).join("\n").trim(),
  };
}

/**
 * Parse a minimal YAML subset sufficient for skill frontmatter:
 * - `key: value` scalars
 * - `key: [a, b, c]` inline arrays
 * - `key:` followed by `- item` block-list lines
 *
 * Anything else (nested maps, multi-line scalars) is rejected rather than
 * silently mis-parsed — the format is intentionally tiny.
 */
function parseFrontmatterLines(lines: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    i++;
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    if (line.startsWith("- ") || line.startsWith("-\t")) {
      throw new Error(`unexpected list item outside of a key: '${line.trim()}'`);
    }
    const colon = line.indexOf(":");
    if (colon === -1) {
      throw new Error(`invalid frontmatter line (expected 'key: value'): '${line.trim()}'`);
    }
    const key = line.slice(0, colon).trim();
    const rest = line.slice(colon + 1).trim();
    if (rest === "") {
      // Block list: consume following indented `- item` lines.
      const items: string[] = [];
      let listLine: string | undefined;
      while ((listLine = lines[i]) !== undefined && /^\s*-\s+/.test(listLine)) {
        items.push(stripScalar(listLine.replace(/^\s*-\s+/, "")));
        i++;
      }
      out[key] = items;
    } else if (rest.startsWith("[") && rest.endsWith("]")) {
      // Inline array.
      const inner = rest.slice(1, -1).trim();
      out[key] = inner === "" ? [] : inner.split(",").map((s) => stripScalar(s.trim()));
    } else {
      out[key] = stripScalar(rest);
    }
  }
  return out;
}

/** Strip matching surrounding quotes from a scalar, if present. */
function stripScalar(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Parse and validate a `skill.md`'s text. Throws a descriptive Error on a
 * malformed frontmatter block and a ZodError on a shape/content violation
 * (empty name, no keywords, etc.).
 */
export function parseSkillFile(source: string): SkillFile {
  const { frontmatterLines, body } = splitFrontmatter(source);
  const raw = parseFrontmatterLines(frontmatterLines);
  const frontmatter = SkillFrontmatterSchema.parse(raw);
  return { frontmatter, body };
}
