/**
 * The instruction used during context compaction to summarize the earlier
 * conversation. Sent as a user message together with the serialized transcript;
 * the running system prompt still applies. Override with LUCKY_PROMPT_SUMMARIZATION.
 */
export const SUMMARIZATION_PROMPT = `Summarize the earlier conversation so the coding session can continue from the summary alone.

Preserve, as concretely as possible:

- the user's goals, requested outcome, and explicit constraints
- decisions made and why they were made
- files read, files changed, and what changed in each
- commands run and the relevant outputs or failures
- bugs investigated, hypotheses formed, what was ruled out, and what remains open
- unresolved tasks and the next recommended step

Preserve code-navigation knowledge explicitly:
- symbol names
- file paths
- entrypoints
- definitions located
- important relationships discovered through the project graph, such as:
  - who calls a function
  - what a function calls
  - neighboring or related abstractions
  - which module or file owns a behavior

If the session involved edits, preserve:
- the exact behavioral intent of each edit
- validation performed after the edit
- whether the result was verified, partially verified, or not verified

If the session involved planning or analysis only, preserve:
- the concrete findings
- where those findings were located
- what evidence supports them

Be concise but information-dense.
Keep identifiers, paths, command names, tool names, and model-relevant facts verbatim.
Drop pleasantries, repetition, and dead ends unless a rejected hypothesis still matters for future reasoning.

Output only the summary.`;
