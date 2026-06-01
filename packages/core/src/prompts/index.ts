/**
 * Prompt assembly. Each concern lives in its own source file under this folder;
 * here they are composed into the two prompts the agent actually sends:
 *
 *   - the system prompt = identity + agency + tool-use + environment
 *   - the summarization prompt used during context compaction
 *
 * Every section can be overridden at runtime by an environment variable, so a
 * user can retune behavior without rebuilding. LUCKY_SYSTEM still overrides the
 * entire composed system prompt (handled in config.ts), taking precedence over
 * the per-section variables below.
 */
import { IDENTITY_PROMPT } from "./identity.js";
import { AGENCY_PROMPT } from "./agency.js";
import { TOOL_USE_PROMPT } from "./tool-use.js";
import {
  ENVIRONMENT_PROMPT_TEMPLATE,
  renderEnvironment,
  type EnvironmentInfo,
} from "./environment.js";
import { SUMMARIZATION_PROMPT } from "./summarization.js";

export { renderEnvironment } from "./environment.js";
export type { EnvironmentInfo } from "./environment.js";

function override(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name];
  return value !== undefined && value.trim() !== "" ? value : fallback;
}

/** Default runtime info, used when the caller doesn't supply one. */
function defaultEnvironment(): EnvironmentInfo {
  return {
    cwd: process.cwd(),
    os: `${process.platform} (${process.arch})`,
    date: new Date().toISOString().slice(0, 10),
  };
}

/**
 * Compose the full system prompt from its sections, applying per-section
 * environment overrides and interpolating the environment block.
 */
export function buildSystemPrompt(
  info: EnvironmentInfo = defaultEnvironment(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  const identity = override(env, "LUCKY_PROMPT_IDENTITY", IDENTITY_PROMPT);
  const agency = override(env, "LUCKY_PROMPT_AGENCY", AGENCY_PROMPT);
  const toolUse = override(env, "LUCKY_PROMPT_TOOL_USE", TOOL_USE_PROMPT);
  const envTemplate = override(env, "LUCKY_PROMPT_ENVIRONMENT", ENVIRONMENT_PROMPT_TEMPLATE);
  const environment = renderEnvironment(envTemplate, info);
  return [identity, agency, toolUse, environment].join("\n\n");
}

/** The summarization instruction, with its env override applied. */
export function buildSummarizationPrompt(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return override(env, "LUCKY_PROMPT_SUMMARIZATION", SUMMARIZATION_PROMPT);
}

export {
  IDENTITY_PROMPT,
  AGENCY_PROMPT,
  TOOL_USE_PROMPT,
  ENVIRONMENT_PROMPT_TEMPLATE,
  SUMMARIZATION_PROMPT,
};
