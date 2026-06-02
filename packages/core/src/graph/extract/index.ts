/**
 * Extractor registry — maps a language to the extractor that handles it.
 * The build pipeline uses this to dispatch each detected file.
 */
import { goExtractor } from "./go.js";
import type { GraphLanguage } from "./parser.js";
import { pythonExtractor } from "./python.js";
import type { Extractor } from "./types.js";
import { javascriptExtractor, tsxExtractor, typescriptExtractor } from "./typescript.js";

const EXTRACTORS: Record<GraphLanguage, Extractor | undefined> = {
  typescript: typescriptExtractor,
  tsx: tsxExtractor,
  javascript: javascriptExtractor,
  python: pythonExtractor,
  go: goExtractor,
};

/** The extractor for a language, or undefined if none is registered yet. */
export function extractorFor(language: GraphLanguage): Extractor | undefined {
  return EXTRACTORS[language];
}

export { typescriptExtractor, tsxExtractor, javascriptExtractor };
export { pythonExtractor };
export { goExtractor };
export type { Extractor, ExtractorContext } from "./types.js";
