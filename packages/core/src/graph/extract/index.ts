/**
 * Extractor registry — maps a language to the extractor that handles it.
 * The build pipeline uses this to dispatch each detected file.
 */
import { cExtractor } from "./c.js";
import { cppExtractor } from "./cpp.js";
import { csharpExtractor } from "./csharp.js";
import { goExtractor } from "./go.js";
import { javaExtractor } from "./java.js";
import type { GraphLanguage } from "./parser.js";
import { phpExtractor } from "./php.js";
import { pythonExtractor } from "./python.js";
import { rubyExtractor } from "./ruby.js";
import { rustExtractor } from "./rust.js";
import type { Extractor } from "./types.js";
import { javascriptExtractor, tsxExtractor, typescriptExtractor } from "./typescript.js";

const EXTRACTORS: Record<GraphLanguage, Extractor | undefined> = {
  typescript: typescriptExtractor,
  tsx: tsxExtractor,
  javascript: javascriptExtractor,
  python: pythonExtractor,
  go: goExtractor,
  rust: rustExtractor,
  java: javaExtractor,
  ruby: rubyExtractor,
  csharp: csharpExtractor,
  php: phpExtractor,
  c: cExtractor,
  cpp: cppExtractor,
};

/** The extractor for a language, or undefined if none is registered yet. */
export function extractorFor(language: GraphLanguage): Extractor | undefined {
  return EXTRACTORS[language];
}

export { typescriptExtractor, tsxExtractor, javascriptExtractor };
export { pythonExtractor };
export { goExtractor };
export { rustExtractor };
export { javaExtractor };
export { rubyExtractor };
export { csharpExtractor };
export { phpExtractor };
export { cExtractor };
export { cppExtractor };
export type { Extractor, ExtractorContext } from "./types.js";
