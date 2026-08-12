/**
 * Automatic graph context enrichment: turn identifier-shaped names in a user
 * message into a compact navigational block appended to that turn, so the model
 * starts oriented instead of spending tool calls to find the code being
 * discussed.
 *
 * Design notes, learned from the removed skills auto-injection (which matched
 * *intent* keywords like "review" and proved too eager — see skills/activator.ts):
 *   - We match *identifiers*, not intent: backticked tokens, camelCase /
 *     snake_case words, path-like strings. These are syntactically recognizable
 *     and rarely ambiguous in prose.
 *   - We only resolve exact graph matches ({@link resolveNodes}); never fuzzy
 *     suggestions. A candidate that resolves to many nodes is skipped —
 *     a wrong hint is worse than no hint.
 *   - We inject *facts* (where a symbol lives, who calls it), never
 *     instructions, so a false positive costs a few tokens, not behavior.
 *
 * The block is appended to the user turn (never the system prompt), so the
 * prompt-cache prefix never moves. Cost is zero when nothing matches or the
 * project has no graph.
 */
import { statSync } from "node:fs";
import { callersOf, calleesOf, resolveNodes } from "./query.js";
import { graphFilePath, nodesInFile, tryLoadGraph } from "./store.js";
import type { Graph, GraphNode } from "./types.js";

/** Max graph cards injected per turn: enough to orient, never a wall. */
export const MAX_MENTIONS_PER_TURN = 3;
/** A candidate resolving to more nodes than this is ambiguous — skip it. */
const MAX_RESOLVED_NODES = 3;
/** Cap on candidate tokens scanned per message, in priority order. */
const MAX_CANDIDATES = 12;
/** Cap on names listed per relation line (callers, callees, symbols). */
const MAX_RELATED_NAMES = 5;

export interface MentionCandidate {
  token: string;
  /**
   * True when the token came from an unmistakably code-shaped source (backticks
   * or a path). Prose-derived tokens are held to a stricter standard at match
   * time: the node label must match case-sensitively, so a sentence-leading
   * "The" can never claim a node labelled "the".
   */
  fromCode: boolean;
}

/** camelCase, snake_case, or PascalCase (≥4 chars) — identifier-shaped prose. */
function isIdentifierShaped(word: string): boolean {
  if (word.includes("_")) return true;
  if (/[a-z][A-Z]/.test(word)) return true;
  return /^[A-Z][A-Za-z0-9]{3,}$/.test(word);
}

/**
 * Extract mention candidates from a message, highest-precision first:
 * backticked tokens, then path-like tokens, then identifier-shaped words.
 * Deduplicated, capped at {@link MAX_CANDIDATES}.
 */
export function extractMentionCandidates(text: string): MentionCandidate[] {
  const seen = new Set<string>();
  const out: MentionCandidate[] = [];
  const push = (raw: string, fromCode: boolean) => {
    // Strip call parens and a trailing :L<line> location so `foo()` and
    // `a/b.ts:L42` resolve to the symbol/file they name.
    const token = raw.trim().replace(/\(.*\)$/, "").replace(/:L?\d+(-\d+)?$/, "");
    if (token.length < 2 || seen.has(token)) return;
    seen.add(token);
    out.push({ token, fromCode });
  };

  for (const m of text.matchAll(/`([^`\n]+)`/g)) push(m[1]!, true);
  for (const m of text.matchAll(/[\w.-]+\/[\w./-]+/g)) push(m[0], true);
  for (const m of text.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)) {
    if (isIdentifierShaped(m[0])) push(m[0], false);
  }
  return out.slice(0, MAX_CANDIDATES);
}

/**
 * Resolve a message's candidates against the graph. Exact resolution only,
 * external nodes excluded, ambiguous candidates skipped, already-injected node
 * ids filtered out, capped at `limit` nodes.
 */
export function matchMentions(
  graph: Graph,
  text: string,
  alreadyInjected: ReadonlySet<string> = new Set(),
  limit = MAX_MENTIONS_PER_TURN,
): GraphNode[] {
  const out: GraphNode[] = [];
  const taken = new Set<string>();
  for (const candidate of extractMentionCandidates(text)) {
    if (out.length >= limit) break;
    let nodes = resolveNodes(graph, candidate.token).filter((n) => !n.external);
    // A path mention resolves to every node declared in that file — dozens in a
    // real module, which would trip the ambiguity guard below. That mention is
    // precise, not ambiguous: collapse it to the file node itself (its card
    // lists the file's symbols anyway).
    if (nodes.length > 1) {
      const fileNodes = nodes.filter(
        (n) => n.kind === "file" && n.sourceFile === candidate.token,
      );
      if (fileNodes.length === 1) nodes = fileNodes;
    }
    if (!candidate.fromCode) {
      nodes = nodes.filter(
        (n) => n.label === candidate.token || n.sourceFile === candidate.token,
      );
    }
    if (nodes.length === 0 || nodes.length > MAX_RESOLVED_NODES) continue;
    for (const node of nodes) {
      if (out.length >= limit) break;
      if (taken.has(node.id) || alreadyInjected.has(node.id)) continue;
      taken.add(node.id);
      out.push(node);
    }
  }
  return out;
}

function nameList(nodes: GraphNode[]): string {
  const names = nodes.slice(0, MAX_RELATED_NAMES).map((n) => n.label);
  const extra = nodes.length - names.length;
  return extra > 0 ? `${names.join(", ")} (+${extra} more)` : names.join(", ");
}

function renderCard(graph: Graph, node: GraphNode): string {
  if (node.kind === "file") {
    const symbols = nodesInFile(graph, node.sourceFile).filter(
      (n) => n.id !== node.id && n.kind !== "file" && n.kind !== "module",
    );
    const symbolLine = symbols.length > 0 ? ` — symbols: ${nameList(symbols)}` : "";
    return `- ${node.sourceFile} (file)${symbolLine}`;
  }
  const location = node.sourceLocation
    ? `${node.sourceFile}:${node.sourceLocation}`
    : node.sourceFile;
  const lines = [`- ${node.label} (${node.kind}) — ${location}`];
  const callers = callersOf(graph, node.id);
  const callees = calleesOf(graph, node.id);
  const relations: string[] = [];
  if (callers.length > 0) relations.push(`callers: ${nameList(callers)}`);
  if (callees.length > 0) relations.push(`callees: ${nameList(callees)}`);
  if (relations.length > 0) lines.push(`  ${relations.join(" · ")}`);
  return lines.join("\n");
}

/** Render matched nodes as the `<graph-context>` block appended to the turn. */
export function renderGraphContext(graph: Graph, nodes: GraphNode[]): string {
  const cards = nodes.map((node) => renderCard(graph, node)).join("\n");
  return [
    "<graph-context>",
    "Auto-retrieved from the project knowledge graph for names mentioned above (navigation hints, not file contents; use graph_query or read_file for details):",
    cards,
    "</graph-context>",
  ].join("\n");
}

/**
 * Session-scoped enrichment: loads the graph lazily (re-reading only when the
 * on-disk file changes, so autonomous graph updates are picked up), and
 * remembers which nodes were already injected this session so a symbol under
 * discussion isn't re-described every turn. Clear that memory on compaction —
 * an injected block may have been summarized away.
 *
 * Wire {@link enrich} into AgentConfig.enrichTurn. Everything is best-effort:
 * any failure yields null and the turn proceeds unenriched.
 */
export class GraphContextEnricher {
  private readonly cwd: string;
  private readonly injected = new Set<string>();
  private cache: { stamp: string; graph: Graph | null } | undefined;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  async enrich(userText: string): Promise<string | null> {
    let graph: Graph | null;
    try {
      graph = await this.load();
    } catch {
      return null;
    }
    if (!graph) return null;
    const nodes = matchMentions(graph, userText, this.injected);
    if (nodes.length === 0) return null;
    for (const node of nodes) this.injected.add(node.id);
    return renderGraphContext(graph, nodes);
  }

  /** Forget injected nodes; call when the context is compacted. */
  onCompacted(): void {
    this.injected.clear();
  }

  private async load(): Promise<Graph | null> {
    let stamp: string;
    try {
      const stats = statSync(graphFilePath(this.cwd));
      stamp = `${stats.mtimeMs}:${stats.size}`;
    } catch {
      // No graph file: remember that cheaply; a later build changes the stamp.
      this.cache = { stamp: "missing", graph: null };
      return null;
    }
    if (this.cache?.stamp === stamp) return this.cache.graph;
    const graph = await tryLoadGraph(this.cwd);
    this.cache = { stamp, graph };
    return graph;
  }
}
