/**
 * File detection + language dispatch for graph extraction.
 *
 * Ported from graphify's detect.py (collect_files + CODE_EXTENSIONS): walk a
 * project tree, skip junk dirs, and map each source file to the language whose
 * extractor should handle it. Reuses LuckyCLI's existing file walker so we
 * honour the same ignore rules as the search tools.
 */
import { extname } from "node:path";
import { PROJECT_MEMORY_DIR } from "../project-memory.js";
import { walkFiles } from "../tools/builtin/fs-search.js";
import type { GraphLanguage } from "./extract/parser.js";

/**
 * File extension → language. Only the initially-supported languages are listed;
 * graphify covers ~30 more, which we add one extractor slice at a time.
 */
const EXT_TO_LANGUAGE: Record<string, GraphLanguage> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".rb": "ruby",
  ".cs": "csharp",
};

/** The language for a path, or undefined if no extractor handles it. */
export function languageForPath(path: string): GraphLanguage | undefined {
  return EXT_TO_LANGUAGE[extname(path).toLowerCase()];
}

export interface DetectedFile {
  /** Repo-relative path. */
  relPath: string;
  /** Absolute path. */
  absPath: string;
  /** Language to extract with. */
  language: GraphLanguage;
}

/**
 * Walk `root` and yield every file an extractor can handle. The project's own
 * `.lucky/` directory is skipped so the graph never ingests its own output.
 */
export async function* detectFiles(
  root: string,
  signal?: AbortSignal,
): AsyncGenerator<DetectedFile> {
  for await (const file of walkFiles(root, signal)) {
    if (file.relPath === PROJECT_MEMORY_DIR || file.relPath.startsWith(`${PROJECT_MEMORY_DIR}/`)) {
      continue;
    }
    const language = languageForPath(file.relPath);
    if (language) {
      yield { relPath: file.relPath, absPath: file.absPath, language };
    }
  }
}

/** Collect all detectable files under `root` into an array. */
export async function collectFiles(root: string, signal?: AbortSignal): Promise<DetectedFile[]> {
  const out: DetectedFile[] = [];
  for await (const file of detectFiles(root, signal)) out.push(file);
  return out;
}
