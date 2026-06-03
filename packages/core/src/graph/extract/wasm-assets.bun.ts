/**
 * Wasm asset resolution — Bun standalone-binary variant.
 *
 * Bun's `--compile` embeds files imported with `{ type: "file" }` into the
 * executable and resolves the import to a runtime path under `/$bunfs/root/`,
 * so the single-file binary carries its own grammars with no external `wasm/`
 * dir. scripts/build.ts redirects imports of `./wasm-assets.js` to this module
 * for the release build only — Node/vitest never load it (it's excluded from
 * tsc and uses import attributes Node would reject). Keep its exported surface
 * identical to wasm-assets.ts.
 */
import type { GraphLanguage } from "./parser.js";

import coreWasm from "web-tree-sitter/tree-sitter.wasm" with { type: "file" };
import typescriptWasm from "tree-sitter-wasms/out/tree-sitter-typescript.wasm" with { type: "file" };
import tsxWasm from "tree-sitter-wasms/out/tree-sitter-tsx.wasm" with { type: "file" };
import javascriptWasm from "tree-sitter-wasms/out/tree-sitter-javascript.wasm" with { type: "file" };
import pythonWasm from "tree-sitter-wasms/out/tree-sitter-python.wasm" with { type: "file" };
import goWasm from "tree-sitter-wasms/out/tree-sitter-go.wasm" with { type: "file" };
import rustWasm from "tree-sitter-wasms/out/tree-sitter-rust.wasm" with { type: "file" };
import javaWasm from "tree-sitter-wasms/out/tree-sitter-java.wasm" with { type: "file" };
import rubyWasm from "tree-sitter-wasms/out/tree-sitter-ruby.wasm" with { type: "file" };
import csharpWasm from "tree-sitter-wasms/out/tree-sitter-c_sharp.wasm" with { type: "file" };
import phpWasm from "tree-sitter-wasms/out/tree-sitter-php.wasm" with { type: "file" };
import cWasm from "tree-sitter-wasms/out/tree-sitter-c.wasm" with { type: "file" };
import cppWasm from "tree-sitter-wasms/out/tree-sitter-cpp.wasm" with { type: "file" };
import kotlinWasm from "tree-sitter-wasms/out/tree-sitter-kotlin.wasm" with { type: "file" };
import swiftWasm from "tree-sitter-wasms/out/tree-sitter-swift.wasm" with { type: "file" };

const GRAMMAR_PATHS: Record<GraphLanguage, string> = {
  typescript: typescriptWasm,
  tsx: tsxWasm,
  javascript: javascriptWasm,
  python: pythonWasm,
  go: goWasm,
  rust: rustWasm,
  java: javaWasm,
  ruby: rubyWasm,
  csharp: csharpWasm,
  php: phpWasm,
  c: cWasm,
  cpp: cppWasm,
  kotlin: kotlinWasm,
  swift: swiftWasm,
};

export function coreWasmPath(): string {
  return coreWasm;
}

export function grammarWasmPath(lang: GraphLanguage): string {
  return GRAMMAR_PATHS[lang];
}
