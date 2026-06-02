/**
 * Wasm asset resolution — Node / npm / dev variant.
 *
 * Returns filesystem paths to the tree-sitter core and grammar `.wasm` files by
 * resolving the installed packages. The Bun standalone binary uses the sibling
 * `wasm-assets.bun.ts`, which embeds the same files into the executable; the
 * release build swaps this module for that one (see scripts/build.ts). Keep the
 * two files' exported surface identical.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { GraphLanguage } from "./parser.js";

/** Grammar wasm file name (in tree-sitter-wasms/out) per language. */
export const GRAMMAR_WASM: Record<GraphLanguage, string> = {
  typescript: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  javascript: "tree-sitter-javascript.wasm",
  python: "tree-sitter-python.wasm",
};

const require = createRequire(import.meta.url);

/**
 * Resolve a wasm file across the environments we run in, in priority order:
 *  1. $LUCKY_WASM_DIR (explicit override / packaging escape hatch)
 *  2. a `wasm/` dir next to the executable
 *  3. the installed npm package (dev, vitest, npm-installed CLI)
 */
function locateWasm(file: string, packageSpecifier: string): string {
  const envDir = process.env.LUCKY_WASM_DIR;
  if (envDir) return join(envDir, file);

  try {
    return require.resolve(join(dirname(process.execPath), "wasm", file));
  } catch {
    return require.resolve(packageSpecifier);
  }
}

export function coreWasmPath(): string {
  return locateWasm("tree-sitter.wasm", "web-tree-sitter/tree-sitter.wasm");
}

export function grammarWasmPath(lang: GraphLanguage): string {
  const file = GRAMMAR_WASM[lang];
  return locateWasm(file, `tree-sitter-wasms/out/${file}`);
}
