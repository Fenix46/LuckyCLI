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
    /**
     * Optional search terms (a lucky extension). Standard Agent Skills files
     * carry only name + description, so they are not required.
     */
    keywords: z
      .array(KeywordSchema)
      .transform((ks) => [...new Set(ks)])
      .default([]),
    /** Names of related skills; may dangle. Defaults to empty. */
    related: z
      .array(z.string().transform(normalizeSkillName).refine((s) => s.length > 0))
      .transform((rs) => [...new Set(rs)])
      .default([]),
  })
  // Other tools' fields (license, allowed-tools, metadata, …) are accepted and
  // ignored, so skills written for them install unchanged.
  .strip();
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
 * - `key: >` / `key: |` folded or literal block scalars (indented lines)
 * - quoted scalars that continue over several indented lines, including the
 *   `key:`-then-indented form and YAML's `''` escape inside single quotes
 *
 * Any other indented block under a key (a nested map such as `metadata:`) is
 * skipped as a whole: lucky doesn't use those fields, and refusing the file
 * would make standard skills impossible to install.
 */
function parseFrontmatterLines(lines: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let i = 0;
  const isIndented = (line: string | undefined) => line !== undefined && /^\s+\S/.test(line);
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
      // Block list: consume following `- item` lines.
      const items: string[] = [];
      let listLine: string | undefined;
      while ((listLine = lines[i]) !== undefined && /^\s*-\s+/.test(listLine)) {
        items.push(stripScalar(listLine.replace(/^\s*-\s+/, "")));
        i++;
      }
      if (items.length > 0) {
        out[key] = items;
      } else if (isIndented(lines[i]) && isQuoteStart(lines[i]!.trimStart())) {
        // A quoted scalar written on the lines after the key:
        //   description:
        //     "line one
        //     line two"
        const parsed = parseQuotedScalar(lines, i + 1, lines[i]!.trimStart());
        out[key] = parsed.value;
        i = parsed.next;
      } else {
        // A nested map or other block: skip it.
        while (isIndented(lines[i]) || lines[i]?.trim() === "") i++;
      }
    } else if (/^[>|][+-]?$/.test(rest)) {
      // Block scalar: gather the indented lines; folded (>) joins them.
      const block: string[] = [];
      while (isIndented(lines[i]) || (lines[i]?.trim() === "" && isIndented(lines[i + 1]))) {
        block.push((lines[i] ?? "").trim());
        i++;
      }
      out[key] = rest.startsWith(">") ? block.join(" ").replace(/\s+/g, " ").trim() : block.join("\n").trim();
    } else if (isQuoteStart(rest)) {
      // A quoted scalar, possibly continued on the following lines.
      const parsed = parseQuotedScalar(lines, i, rest);
      out[key] = parsed.value;
      i = parsed.next;
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

function isQuoteStart(value: string): boolean {
  return value.startsWith('"') || value.startsWith("'");
}

/**
 * Read a quoted scalar starting at `firstChunk`, which includes the opening
 * quote. `nextIndex` is the index of the line after the one `firstChunk` came
 * from; continuation lines are consumed until the closing quote. Line breaks
 * fold to a single space, matching YAML's flow-scalar folding for the shapes
 * skills actually use.
 */
function parseQuotedScalar(
  lines: string[],
  nextIndex: number,
  firstChunk: string,
): { value: string; next: number } {
  const quote = firstChunk[0];
  if (quote !== '"' && quote !== "'") throw new Error("expected a quoted value");
  const chunks: string[] = [];
  let current = firstChunk.slice(1);
  let i = nextIndex;
  for (;;) {
    const close = findClosingQuote(current, quote);
    if (close !== -1) {
      chunks.push(current.slice(0, close));
      break;
    }
    chunks.push(current);
    const next = lines[i];
    if (next === undefined) throw new Error("unterminated quoted frontmatter value");
    current = next.trim();
    i++;
  }
  const folded = chunks.join(" ").replace(/\s+/g, " ").trim();
  return {
    value: quote === "'" ? folded.replace(/''/g, "'") : unescapeDoubleQuoted(folded),
    next: i,
  };
}

/** Index of the closing quote, honoring the quote style's escape rules. */
function findClosingQuote(value: string, quote: string): number {
  for (let i = 0; i < value.length; i++) {
    if (quote === '"' && value[i] === "\\") {
      i++;
      continue;
    }
    if (value[i] !== quote) continue;
    if (quote === "'" && value[i + 1] === "'") {
      i++;
      continue;
    }
    return i;
  }
  return -1;
}

/** Minimal YAML double-quoted escapes; unknown escapes keep the backslash. */
function unescapeDoubleQuoted(value: string): string {
  return value.replace(/\\(["\\/bfnrt])/g, (_match, code: string) => {
    switch (code) {
      case "n": return "\n";
      case "r": return "\r";
      case "t": return "\t";
      case "b": return "\b";
      case "f": return "\f";
      default: return code;
    }
  });
}

/** Strip matching surrounding quotes from a scalar, if present. */
function stripScalar(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    const inner = s.slice(1, -1);
    return s.startsWith("'") ? inner.replace(/''/g, "'") : unescapeDoubleQuoted(inner);
  }
  return s;
}

/** A parsed frontmatter block: the raw key/value map and the body after it. */
export interface FrontmatterBlock {
  data: Record<string, unknown>;
  body: string;
}

/**
 * Parse a leading `---` frontmatter block into a raw map plus the body.
 * Throws when the delimiters are missing or malformed; callers that accept
 * optional frontmatter (markdown commands) can fall back to the whole source.
 */
export function parseFrontmatter(source: string): FrontmatterBlock {
  const { frontmatterLines, body } = splitFrontmatter(source);
  return { data: parseFrontmatterLines(frontmatterLines), body };
}

/**
 * Parse and validate a `skill.md`'s text. Throws a descriptive Error on a
 * malformed frontmatter block and a ZodError on a shape/content violation
 * (empty name, no keywords, etc.).
 */
export function parseSkillFile(source: string): SkillFile {
  const { data, body } = parseFrontmatter(source);
  const frontmatter = SkillFrontmatterSchema.parse(data);
  return { frontmatter, body };
}
