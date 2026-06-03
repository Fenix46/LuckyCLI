/**
 * The contract every language extractor implements.
 *
 * Mirrors graphify's "one extract_<lang> function per language" design: parse
 * with tree-sitter, walk the tree, return `{nodes, edges}`. Keeping it behind a
 * single interface is what lets us add languages one slice at a time and, later,
 * swap extraction strategies without touching the build pipeline.
 */
import type { Node } from "web-tree-sitter";
import type { Extraction } from "../types.js";
import type { GraphLanguage } from "./parser.js";

export interface ExtractorContext {
  /** Repo-relative path of the file, used for node ids and `sourceFile`. */
  path: string;
  /** Full file contents. */
  source: string;
  /** Parsed tree root for the file. */
  root: Node;
}

export interface Extractor {
  /** The language this extractor handles. */
  readonly language: GraphLanguage;
  /** Walk the parsed tree and return the file's nodes and edges. */
  extract(ctx: ExtractorContext): Extraction;
}

/** 1-based line label for a tree-sitter node, e.g. "L42". */
export function lineLabel(node: Node): string {
  return `L${node.startPosition.row + 1}`;
}
