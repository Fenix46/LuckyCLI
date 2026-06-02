import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const PROJECT_MEMORY_DIR = ".lucky";
export const PROJECT_MEMORY_FILE = "memory.md";

const HEADER = "# Lucky project memory\n\n";
const MAX_PROMPT_CHARS = 16_000;

export interface ProjectMemory {
  path: string;
  content: string;
}

export function projectMemoryPath(cwd: string): string {
  return join(resolve(cwd), PROJECT_MEMORY_DIR, PROJECT_MEMORY_FILE);
}

export function ensureProjectMemoryFile(cwd: string): ProjectMemory {
  const dir = join(resolve(cwd), PROJECT_MEMORY_DIR);
  const path = join(dir, PROJECT_MEMORY_FILE);
  mkdirSync(dir, { recursive: true });
  try {
    return { path, content: readFileSync(path, "utf8") };
  } catch (err) {
    const e = err as { code?: unknown };
    if (e.code !== "ENOENT") throw err;
    writeFileSync(path, HEADER, "utf8");
    return { path, content: HEADER };
  }
}

export function appendProjectMemoryToSystemPrompt(
  system: string,
  memory: ProjectMemory,
): string {
  const content = userMemoryContent(memory.content);
  if (!content) return system;
  const bounded =
    content.length > MAX_PROMPT_CHARS
      ? `${content.slice(0, MAX_PROMPT_CHARS)}\n\n[project memory truncated]`
      : content;
  return `${system}\n\n# Project memory\n\nLoaded from ${PROJECT_MEMORY_DIR}/${PROJECT_MEMORY_FILE}:\n\n${bounded}`;
}

export async function appendProjectMemory(cwd: string, note: string): Promise<ProjectMemory> {
  const path = projectMemoryPath(cwd);
  await mkdir(join(resolve(cwd), PROJECT_MEMORY_DIR), { recursive: true });
  let current = HEADER;
  try {
    current = await readFile(path, "utf8");
  } catch (err) {
    const e = err as { code?: unknown };
    if (e.code !== "ENOENT") throw err;
  }

  const normalized = normalizeMemoryNote(note);
  const prefix = current.trim() ? `${current.trimEnd()}\n\n` : HEADER;
  const next = `${prefix}- ${normalized}\n`;
  await writeFile(path, next, "utf8");
  return { path, content: next };
}

export async function replaceProjectMemory(cwd: string, content: string): Promise<ProjectMemory> {
  const path = projectMemoryPath(cwd);
  await mkdir(join(resolve(cwd), PROJECT_MEMORY_DIR), { recursive: true });
  const next = content.trim() ? `${content.trimEnd()}\n` : HEADER;
  await writeFile(path, next, "utf8");
  return { path, content: next };
}

function userMemoryContent(content: string): string {
  return content
    .replace(/^# Lucky project memory\s*/i, "")
    .trim();
}

function normalizeMemoryNote(note: string): string {
  return note
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}
