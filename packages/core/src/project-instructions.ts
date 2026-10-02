/**
 * The repository's own instructions for coding agents — AGENTS.md (the
 * cross-tool convention) and CLAUDE.md — loaded into the system prompt so a
 * project's rules (commands, conventions, what not to touch) apply without the
 * user repeating them. Files are collected from the working directory up to
 * the repository root, outermost first, so a package-level file can refine the
 * root one. Identical files (e.g. CLAUDE.md symlinked to AGENTS.md) are
 * included once.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export const PROJECT_INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"] as const;

/** Total size cap, so a huge file can't crowd out the rest of the prompt. */
const MAX_INSTRUCTION_CHARS = 24_000;

export interface ProjectInstructionFile {
  /** Path relative to the working directory, for display. */
  path: string;
  content: string;
}

/** Directories from the repository root (or filesystem root) down to cwd. */
function searchDirs(cwd: string): string[] {
  const dirs: string[] = [];
  let dir = resolve(cwd);
  while (true) {
    dirs.push(dir);
    if (existsSync(join(dir, ".git"))) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirs.reverse();
}

export function loadProjectInstructions(cwd: string): ProjectInstructionFile[] {
  const seen = new Set<string>();
  const files: ProjectInstructionFile[] = [];
  for (const dir of searchDirs(cwd)) {
    for (const name of PROJECT_INSTRUCTION_FILES) {
      const path = join(dir, name);
      try {
        if (!statSync(path).isFile()) continue;
        const content = readFileSync(path, "utf8").trim();
        if (!content || seen.has(content)) continue;
        seen.add(content);
        files.push({ path: relative(resolve(cwd), path) || name, content });
      } catch {
        // Missing or unreadable: nothing to load.
      }
    }
  }
  return files;
}

/** Append the instruction files as a "Project instructions" section. */
export function appendProjectInstructionsToSystemPrompt(
  system: string,
  files: ProjectInstructionFile[],
): string {
  if (files.length === 0) return system;
  let budget = MAX_INSTRUCTION_CHARS;
  const blocks: string[] = [];
  for (const file of files) {
    if (budget <= 0) break;
    const content =
      file.content.length > budget ? `${file.content.slice(0, budget)}\n\n[truncated]` : file.content;
    budget -= file.content.length;
    blocks.push(`## ${file.path}\n\n${content}`);
  }
  return `${system}\n\n# Project instructions\n\nThe repository's own instructions for coding agents. Follow them: where they conflict with the general guidance above, they win; the user's explicit requests still come first.\n\n${blocks.join("\n\n")}`;
}
