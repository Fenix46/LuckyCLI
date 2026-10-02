import { defineSection } from "./section.js";
import type { PromptContext } from "./section.js";

/**
 * Tool-use *strategy*: the graph-first navigation approach, the per-task
 * protocols (analysis / bug fixing / feature work), reading/search discipline,
 * and anti-patterns. The per-tool "when to use which" guidance lives in the
 * separate "Your tools" section (tools.ts); this section is about how to drive
 * them together to do real work.
 *
 * The graph-specific guidance is gated on ctx.hasGraph so a project without a
 * knowledge graph doesn't get told to use one. Override with LUCKY_PROMPT_TOOL_USE.
 */

const GRAPH_GUIDANCE = `# Navigation: the knowledge graph

The project has a knowledge graph in .lucky/graph. It is your primary index: use it to locate symbols and files, see who calls what, gauge the blast radius of a change, and learn which external libraries a file depends on (library nodes are marked external). Treat it as a fast index, not ground truth — confirm in the source before editing — and fall back to grep or glob when it has no answer.

- Unclear area or broad request: start with graph_overview (most connected symbols and most-used libraries).
- A named symbol, module or file: graph_query find, then read only the files it points to.
- Before changing a shared function, type or module: graph_query impact (everything that transitively depends on it); callers for just the direct call sites; callees or neighbors for local flow.
- Don't begin by broadly grepping or opening many files at random.
- The graph updates itself after your edits and picks up outside changes (the user's editor, git pull, codegen) at the start of each turn; you never need to rebuild it.
- A user turn may end with an auto-generated <graph-context> block: graph matches for symbols or files the message mentions. Use it as a head start instead of re-running graph_query find for the same names; it is navigation metadata, not file contents.`;

const NO_GRAPH_GUIDANCE = `# Navigation

This project has no knowledge graph. Locate code with grep and glob: grep for symbols and text, glob for filenames and path patterns, then read the exact file before reasoning about or changing it. Don't open many files at random. You may suggest \`/graph\` or \`lucky graph build\` to index the project, but do not build it unprompted.`;

const COMMON_GUIDANCE = `# Working with tools

- Run independent tool calls together; run dependent calls in sequence. Reads, searches, directory listings, graph queries and fetches issued in the same response execute concurrently, so gather what you need in one batch instead of one call per step.
- Read narrowly: the exact file and line range a search pointed at, not whole files, unless the task needs full-file understanding. Read before editing so you change the exact current text, and re-read changed regions afterwards.
- Check callers before an impact-bearing edit to shared code, and never claim completion without checking the resulting code or validation output.`;

export function buildToolUsePrompt(hasGraph: boolean | undefined): string {
  return [hasGraph ? GRAPH_GUIDANCE : NO_GRAPH_GUIDANCE, COMMON_GUIDANCE].join("\n\n");
}

/**
 * Back-compat constant: the graph-on variant. Callers/tests that referenced the
 * old TOOL_USE_PROMPT still get a sensible full-strategy string.
 */
export const TOOL_USE_PROMPT = buildToolUsePrompt(true);

export const toolUseSection = defineSection({
  name: "tool-use",
  envVar: "LUCKY_PROMPT_TOOL_USE",
  compute: (ctx: PromptContext) => buildToolUsePrompt(ctx.hasGraph),
});
