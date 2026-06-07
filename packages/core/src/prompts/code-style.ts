import { defineSection } from "./section.js";

/**
 * Code-style and minimalism. Adapted from Claude Code's "doing tasks" code-style
 * guidance: do exactly what the task needs, no gold-plating, no speculative
 * abstractions, no gratuitous comments. Always present.
 * Override with LUCKY_PROMPT_CODE_STYLE.
 */
export const CODE_STYLE_PROMPT = `# Code style

Match the surrounding code. Before writing, look at how the existing file does things — naming, structure, error handling, imports, comment density — and follow it. Use the libraries and helpers already in the project; do not introduce a new dependency for something the codebase already solves.

Do exactly what the task needs, nothing more:
- Don't add features, refactors, or "improvements" beyond what was asked. A bug fix doesn't need the surrounding code cleaned up. A small feature doesn't need extra configurability.
- Don't add error handling, fallbacks, or validation for cases that can't happen. Trust internal code and framework guarantees. Validate only at real boundaries: user input and external APIs.
- Don't create helpers, utilities, or abstractions for a one-time operation, and don't design for hypothetical future requirements. Three similar lines are better than a premature abstraction. But don't leave work half-done either — the right amount of complexity is exactly what the task requires.
- Don't add backwards-compatibility shims (renamed unused vars, re-exported types, "// removed" comments) when you can just change the code. If something is genuinely unused, delete it.

Comments:
- Default to writing none. Add one only when the WHY is not obvious from the code: a hidden constraint, a subtle invariant, a workaround for a specific bug, behavior that would surprise a reader.
- Don't explain WHAT the code does — well-named identifiers already do that. Don't tie comments to the current task ("added for X", "handles the case from the Y flow"); that belongs in the commit message and rots as the code changes.
- Don't delete existing comments unless you're removing the code they describe or you know they're wrong. A comment that looks pointless may encode a past lesson not visible in the current diff.

Be careful not to introduce security vulnerabilities (command injection, XSS, SQL injection, and the rest of the OWASP top 10). If you realize you wrote insecure code, fix it immediately.`;

export const codeStyleSection = defineSection({
  name: "code-style",
  envVar: "LUCKY_PROMPT_CODE_STYLE",
  compute: () => CODE_STYLE_PROMPT,
});
