/**
 * Tree-sitter loader for the graph extractors.
 *
 * Uses web-tree-sitter (WASM) so the parser is portable across every platform
 * we ship — unlike native node-gyp bindings, a single set of `.wasm` grammars
 * works in Node, under vitest, and inside the Bun standalone binary. The core
 * runtime wasm ships with `web-tree-sitter`; the per-language grammars ship in
 * `tree-sitter-wasms`. Both are located at runtime by {@link locateWasm}.
 */
import { Language, type Node, Parser, type Tree } from "web-tree-sitter";
import { coreWasmPath, grammarWasmPath } from "./wasm-assets.js";

/** Languages the built-in extractors understand. More are added over time. */
export type GraphLanguage =
  | "typescript"
  | "tsx"
  | "javascript"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "ruby"
  | "csharp"
  | "php"
  | "c"
  | "cpp"
  | "kotlin"
  | "swift"
  | "dart"
  | "json"
  | "toml";

let initPromise: Promise<void> | undefined;
const languages = new Map<GraphLanguage, Language>();
const parsers = new Map<GraphLanguage, Parser>();

/** Initialize the tree-sitter runtime once, pointing it at the core wasm. */
async function ensureInit(): Promise<void> {
  if (!initPromise) {
    const corePath = coreWasmPath();
    initPromise = Parser.init({ locateFile: () => corePath });
  }
  await initPromise;
}

/** Load (and cache) the grammar for a language. */
export async function loadLanguage(lang: GraphLanguage): Promise<Language> {
  await ensureInit();
  let language = languages.get(lang);
  if (!language) {
    language = await Language.load(grammarWasmPath(lang));
    languages.set(lang, language);
  }
  return language;
}

/** A parsed source file. Call {@link ParsedSource.dispose} when done to free wasm memory. */
export interface ParsedSource {
  tree: Tree;
  root: Node;
  dispose(): void;
}

/** Parse source text with the grammar for `lang`. */
export async function parse(lang: GraphLanguage, source: string): Promise<ParsedSource> {
  const language = await loadLanguage(lang);
  let parser = parsers.get(lang);
  if (!parser) {
    parser = new Parser();
    parser.setLanguage(language);
    parsers.set(lang, parser);
  }
  const tree = parser.parse(source);
  if (!tree) throw new Error(`tree-sitter failed to parse ${lang} source`);
  return {
    tree,
    root: tree.rootNode,
    dispose: () => tree.delete(),
  };
}
