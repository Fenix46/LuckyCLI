/**
 * The system-prompt section architecture.
 *
 * A section is a named unit of the system prompt that computes its own text
 * from a PromptContext and may return `null` to opt out entirely (e.g. the
 * graph section when the project has no graph). The assembler resolves every
 * section, applies any per-section env override, drops the nulls, and joins the
 * rest — so the prompt is large *in potential* but in any given session only
 * mounts the parts that are relevant.
 *
 * Ported from Claude Code's systemPromptSections (the conditional `string|null`
 * model), without its per-turn memoization cache: lucky builds the system prompt
 * once at agent construction, not every turn, so a cache would have nothing to
 * cache. If the prompt ever becomes per-turn, the cache can be layered on top of
 * this same section list.
 */

import type { EnvironmentInfo } from "./environment.js";

/**
 * Everything a section needs to decide what (if anything) to contribute. Built
 * once and handed to every section. Optional capability flags let a section
 * appear only when the corresponding feature is actually available in this
 * session.
 */
export interface PromptContext {
  /** Runtime environment block values (cwd, os, date). */
  environment: EnvironmentInfo;
  /** Active model id, for model-specific guidance. */
  model?: string;
  /** Names of the tools enabled this session; lets sections describe only what's callable. */
  enabledTools?: Set<string>;
  /** Whether the project has a knowledge graph (gates the graph guidance). */
  hasGraph?: boolean;
  /** Whether any sub-agent profiles exist (gates the delegation guidance). */
  hasSubAgents?: boolean;
  /** Whether any skill is installed (gates the skills protocol blurb). */
  hasSkills?: boolean;
  /** Environment variables, for per-section overrides (LUCKY_PROMPT_*). */
  env: NodeJS.ProcessEnv;
}

/** One composable unit of the system prompt. */
export interface PromptSection {
  /** Stable identifier (also used in diagnostics). */
  name: string;
  /**
   * Env var that overrides this section's text wholesale when set non-empty.
   * The assembler applies it, so compute() never has to check it.
   */
  envVar?: string;
  /** Produce this section's text, or null to omit it from the prompt. */
  compute: (ctx: PromptContext) => string | null;
}

/** Define a section (identity helper for readable section files). */
export function defineSection(section: PromptSection): PromptSection {
  return section;
}

/**
 * Resolve a list of sections against a context into the final prompt string.
 * Order is preserved; a non-empty env override replaces a section's computed
 * text; null (or empty) sections are dropped. Sections are joined with a blank
 * line, matching the original concatenation.
 */
export function resolveSections(
  sections: PromptSection[],
  ctx: PromptContext,
): string {
  const parts: string[] = [];
  for (const section of sections) {
    const override = section.envVar ? ctx.env[section.envVar] : undefined;
    const text =
      override !== undefined && override.trim() !== ""
        ? override
        : section.compute(ctx);
    if (text && text.trim() !== "") parts.push(text);
  }
  return parts.join("\n\n");
}
