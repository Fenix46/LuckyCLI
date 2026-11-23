/**
 * Markdown slash commands — the `.claude/commands/*.md` convention, with
 * lucky's own `.lucky/commands` as the canonical root.
 *
 * A command is a Markdown file whose path (under the commands root) is its
 * name — `db/migrate.md` becomes `/db:migrate` — and whose body is the prompt
 * sent to the model. Frontmatter may add `description` and `argument-hint`;
 * `allowed-tools` and other fields are accepted and ignored for now.
 *
 * Discovery is synchronous on purpose: the slash registry is rebuilt during
 * render, and these are a handful of small files.
 */
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { parseFrontmatter } from "../skills/skill-file.js";

export interface MarkdownCommand {
  /** Slash name without the leading slash, e.g. `db:migrate`. */
  name: string;
  description: string;
  argumentHint?: string;
  /** Expanded prompt body. */
  body: string;
  /** Absolute path of the `.md` file. */
  file: string;
  scope: "project" | "global";
  origin: "lucky" | "claude";
}

export interface MarkdownCommandOptions {
  cwd?: string;
  home?: string;
  /** Directory depth under a commands root; default 4. */
  maxDepth?: number;
}

/** Project command roots, in shadowing order. */
export function projectCommandRoots(cwd: string): string[] {
  return [join(cwd, ".lucky", "commands"), join(cwd, ".claude", "commands")];
}

/** Global command roots, in shadowing order. */
export function globalCommandRoots(home = homedir()): string[] {
  return [join(home, ".luckycli", "commands"), join(home, ".claude", "commands")];
}

interface CommandRoot {
  dir: string;
  scope: MarkdownCommand["scope"];
  origin: MarkdownCommand["origin"];
}

function commandRoots(cwd: string, home: string): CommandRoot[] {
  return [
    { dir: join(cwd, ".lucky", "commands"), scope: "project", origin: "lucky" },
    { dir: join(cwd, ".claude", "commands"), scope: "project", origin: "claude" },
    { dir: join(home, ".luckycli", "commands"), scope: "global", origin: "lucky" },
    { dir: join(home, ".claude", "commands"), scope: "global", origin: "claude" },
  ];
}

const VALID_NAME = /^[A-Za-z0-9_:-]+$/;

/** Slash name for a file path relative to a commands root. */
function commandName(root: string, file: string): string | undefined {
  const rel = relative(root, file).replace(/\\/g, "/").replace(/\.md$/i, "");
  const name = rel.split("/").filter(Boolean).join(":");
  return VALID_NAME.test(name) ? name : undefined;
}

function markdownFiles(root: string, maxDepth: number): string[] {
  const out: string[] = [];
  function walk(dir: string, depth: number): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth >= maxDepth || entry.name.startsWith(".") || entry.name === "node_modules") continue;
        walk(path, depth + 1);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) out.push(path);
    }
  }
  walk(root, 0);
  return out;
}

/** Read one command, or skip it when its frontmatter is malformed. */
function readCommand(
  root: CommandRoot,
  file: string,
): MarkdownCommand | undefined {
  const name = commandName(root.dir, file);
  if (!name) return undefined;

  let source: string;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    return undefined;
  }

  let data: Record<string, unknown> = {};
  let body: string;
  if (source.trimStart().startsWith("---")) {
    try {
      const parsed = parseFrontmatter(source);
      data = parsed.data;
      body = parsed.body;
    } catch {
      // A broken frontmatter block should not turn into a prompt.
      return undefined;
    }
  } else {
    body = source.trim();
  }

  const description = typeof data.description === "string" ? data.description.trim() : "";
  const hint = data["argument-hint"] ?? data.argumentHint;
  return {
    name,
    description,
    ...(typeof hint === "string" && hint.trim() ? { argumentHint: hint.trim() } : {}),
    body,
    file,
    scope: root.scope,
    origin: root.origin,
  };
}

/**
 * Every markdown command visible from `cwd`. Project roots shadow global ones
 * and, within a scope, lucky's root shadows `~/.claude`. Later duplicates of a
 * name are dropped; the result is sorted by name.
 */
export function discoverMarkdownCommands(
  options: MarkdownCommandOptions = {},
): MarkdownCommand[] {
  const cwd = options.cwd ?? process.cwd();
  const home = options.home ?? homedir();
  const maxDepth = options.maxDepth ?? 4;
  const byName = new Map<string, MarkdownCommand>();

  for (const root of commandRoots(cwd, home)) {
    for (const file of markdownFiles(root.dir, maxDepth)) {
      const command = readCommand(root, file);
      if (command && !byName.has(command.name)) byName.set(command.name, command);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Split command arguments like a shell would: whitespace separates, single and
 * double quotes group, and a backslash escapes outside single quotes. No
 * expansion, substitution or globbing — this only feeds `$1…$9`.
 */
export function splitArguments(input: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        out.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) out.push(current);
  return out;
}

const PLACEHOLDER = /\$ARGUMENTS\b|\$\d+/;

/**
 * Expand `$ARGUMENTS` and `$1…$9` in a command body. If the body uses neither
 * and arguments were given, append them on a new line, matching the convention
 * other agents use.
 */
export function expandMarkdownCommand(
  command: Pick<MarkdownCommand, "body">,
  args: string,
): string {
  const trimmed = args.trim();
  const positional = splitArguments(args);
  const hasPlaceholder = PLACEHOLDER.test(command.body);
  const expanded = command.body
    .replace(/\$ARGUMENTS\b/g, trimmed)
    .replace(/\$(\d+)/g, (_match, digits: string) => {
      const index = Number.parseInt(digits, 10);
      return index >= 1 ? (positional[index - 1] ?? "") : "";
    });
  if (!hasPlaceholder && trimmed) return `${expanded}\n\n${trimmed}`;
  return expanded;
}
