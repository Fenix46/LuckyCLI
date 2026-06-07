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

const GRAPH_GUIDANCE = `# Knowledge graph: primary navigation layer

The project has a knowledge graph in .lucky/graph. Treat it as the default navigation layer.

Use it first for:
- locating symbols
- understanding file/module ownership
- understanding who calls what
- estimating the impact of a change
- orienting in an unfamiliar area of the codebase

Operational rules:
- Start broad analysis with graph_overview when the area is unclear.
- Use graph_query find to locate a symbol or file-level target.
- Use graph_query callers before changing behavior that may be depended on elsewhere.
- Use graph_query callees or neighbors when you need to understand local flow or adjacent abstractions.
- After the graph identifies the likely target, read the exact file and relevant lines to confirm.
- Treat the graph as a fast index, not ground truth: confirm in source before editing.
- If the graph has no answer, fall back to grep or glob.
- Do not begin by broadly grepping or opening many files at random.

# Graph-first task protocols

## For analysis / repository orientation
1. Use graph_overview if the request is broad.
2. Use graph_query to narrow to the relevant symbols or files.
3. Read only the files that the graph indicates are relevant.
4. Summarize findings with concrete paths and relations.

## For bug fixing
1. Locate the likely code path with graph_query.
2. Check callers/callees to understand impact and entrypoints.
3. Read the target implementation and minimal surrounding context.
4. Change only the code needed for the fix.
5. Run the smallest meaningful verification.

## For feature work or refactors
1. Find the target symbols/files with graph_query.
2. Inspect callers, callees, and neighbors before editing shared abstractions.
3. Read interfaces, implementations, and affected entrypoints.
4. Keep edits scoped to the requested behavior.
5. Verify the changed flow, not just the edited file.`;

const GRAPH_LIFECYCLE = `# Graph lifecycle

- The graph updates itself after file edits; you do not need to rebuild it after normal changes.`;

const NO_GRAPH_GUIDANCE = `# Navigation

This project has no knowledge graph. Locate code with grep and glob: grep for symbols and text, glob for filenames and path patterns. Read the exact file before reasoning about or changing it. You may suggest \`/graph\` or \`lucky graph build\` to index the project, but do not build it unprompted.`;

const COMMON_GUIDANCE = `# Working with tools

- Run independent tool calls together when they can run in parallel; run dependent calls in sequence.
- Read before editing so you change the exact current text.

# File reading discipline

- Prefer reading the exact file and line range the graph or a search pointed at.
- Read narrowly before reading broadly. Don't open many similar files just to "look around" once the target is known, and don't read whole files unless the task needs full-file understanding.
- Re-read changed regions after editing.

# Anti-patterns to avoid

- Do not invent project structure instead of locating it.
- Do not treat README claims as stronger evidence than source code.
- Do not make impact-bearing edits to shared code without checking callers/callees first.
- Do not ask the user questions the codebase can answer.
- Do not claim completion without checking the resulting code or validation output.`;

/** Compose the tool-use strategy, swapping graph vs. no-graph guidance. */
export function buildToolUsePrompt(hasGraph: boolean | undefined): string {
  const navigation = hasGraph ? GRAPH_GUIDANCE : NO_GRAPH_GUIDANCE;
  const lifecycle = hasGraph ? GRAPH_LIFECYCLE : "";
  return [navigation, COMMON_GUIDANCE, lifecycle].filter(Boolean).join("\n\n");
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
