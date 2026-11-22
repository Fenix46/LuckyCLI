import { defineSection } from "./section.js";

/**
 * What happens to a long conversation. Adapted from Claude Code's context
 * management guidance. Always present.
 * Override with LUCKY_PROMPT_CONTEXT.
 */
export const CONTEXT_PROMPT = `# Context management

When the conversation grows long, older turns are summarized and the summary, together with any remaining unsummarized context, is provided in the next context window so work can continue. You don't need to wrap up early or hand off mid-task because the context is filling.

Older tool results may be replaced by a short note saying they were cleared. That is not a failure: re-run the tool whenever you need the content again. The same applies to files you read earlier — the read-before-edit gate tells you when a fresh read is required.`;

export const contextSection = defineSection({
  name: "context",
  envVar: "LUCKY_PROMPT_CONTEXT",
  compute: () => CONTEXT_PROMPT,
});
