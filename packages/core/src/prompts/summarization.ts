/**
 * The instruction used during context compaction to summarize the earlier
 * conversation. Sent as a user message together with the serialized transcript;
 * the running system prompt still applies. Override with LUCKY_PROMPT_SUMMARIZATION.
 */
export const SUMMARIZATION_PROMPT = `Summarize the earlier conversation so an AI coding session can continue from the summary alone.

Preserve, as specifically as possible:
- the user's goals and explicit instructions or constraints
- decisions made and their rationale
- files created or changed, and what changed in each
- commands run and their relevant results
- bugs found and their status (fixed / open)
- tasks still unresolved and the next step

Be concise but concrete — keep names, paths, and identifiers verbatim. Drop pleasantries and resolved dead ends. Output only the summary.`;
