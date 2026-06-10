/**
 * Prompt assembly. Each concern lives in its own source file under this folder
 * and exports a PromptSection (a named unit that computes its text from a
 * PromptContext and may opt out by returning null). Here they are composed into
 * the two prompts the agent actually sends:
 *
 *   - the system prompt = identity + agency + tool-use + environment
 *   - the summarization prompt used during context compaction
 *
 * Sections are conditional: a section can return null to disappear (e.g. a
 * future graph section when the project has no graph). Every section can also be
 * overridden at runtime by an environment variable. LUCKY_SYSTEM still overrides
 * the entire composed system prompt (handled in config.ts), taking precedence
 * over the per-section variables.
 *
 * There is intentionally no per-turn memoization cache (unlike Claude Code):
 * lucky builds the system prompt once at agent construction, so a cache would
 * have nothing to cache.
 */
import { identitySection } from "./identity.js";
import { agencySection } from "./agency.js";
import { codeStyleSection } from "./code-style.js";
import { objectivitySection } from "./objectivity.js";
import { toolsSection } from "./tools.js";
import { safetySection } from "./safety.js";
import { toolUseSection } from "./tool-use.js";
import { skillsSection } from "./skills.js";
import { outputStyleSection } from "./output-style.js";
import { environmentSection, type EnvironmentInfo } from "./environment.js";
import { resolveSections, type PromptContext, type PromptSection } from "./section.js";
import { SUMMARIZATION_PROMPT } from "./summarization.js";

export { renderEnvironment } from "./environment.js";
export type { EnvironmentInfo } from "./environment.js";
export { defineSection, resolveSections } from "./section.js";
export type { PromptContext, PromptSection } from "./section.js";

/**
 * The ordered system-prompt sections. Adding a behavior = add a section here;
 * the assembler handles override, null-filtering, and joining.
 */
export const SYSTEM_PROMPT_SECTIONS: PromptSection[] = [
  identitySection,
  agencySection,
  codeStyleSection,
  objectivitySection,
  toolsSection,
  safetySection,
  toolUseSection,
  skillsSection,
  outputStyleSection,
  environmentSection,
];

/** Default runtime info, used when the caller doesn't supply one. */
function defaultEnvironment(): EnvironmentInfo {
  return {
    cwd: process.cwd(),
    os: `${process.platform} (${process.arch})`,
    date: new Date().toISOString().slice(0, 10),
  };
}

/**
 * Compose the full system prompt from a context. Callers that know the session
 * capabilities (enabled tools, whether a graph exists, whether sub-agents are
 * configured) pass them so conditional sections can react.
 */
export function buildSystemPromptFromContext(ctx: PromptContext): string {
  return resolveSections(SYSTEM_PROMPT_SECTIONS, ctx);
}

/**
 * Compose the full system prompt. Back-compatible signature: callers that only
 * have the environment block (config resolution) keep working — capability flags
 * default to undefined, so today every section is active, matching prior output.
 */
export function buildSystemPrompt(
  info: EnvironmentInfo = defaultEnvironment(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  return buildSystemPromptFromContext({ environment: info, env });
}

/** The summarization instruction, with its env override applied. */
export function buildSummarizationPrompt(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const value = env.LUCKY_PROMPT_SUMMARIZATION;
  return value !== undefined && value.trim() !== "" ? value : SUMMARIZATION_PROMPT;
}

export { IDENTITY_PROMPT } from "./identity.js";
export { AGENCY_PROMPT } from "./agency.js";
export { CODE_STYLE_PROMPT } from "./code-style.js";
export { OBJECTIVITY_PROMPT } from "./objectivity.js";
export { SAFETY_PROMPT } from "./safety.js";
export { OUTPUT_STYLE_PROMPT } from "./output-style.js";
export { buildToolsPrompt } from "./tools.js";
export { TOOL_USE_PROMPT } from "./tool-use.js";
export { SKILLS_PROMPT } from "./skills.js";
export { ENVIRONMENT_PROMPT_TEMPLATE } from "./environment.js";
export { SUMMARIZATION_PROMPT } from "./summarization.js";
export {
  identitySection,
  agencySection,
  codeStyleSection,
  objectivitySection,
  toolsSection,
  safetySection,
  toolUseSection,
  skillsSection,
  outputStyleSection,
  environmentSection,
};
