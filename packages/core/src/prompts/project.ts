import { renderProjectFacts } from "../project-facts.js";
import { defineSection } from "./section.js";

/**
 * Project facts detected at session start (toolchain, build/test/lint
 * commands, git state). Omitted when the caller detected nothing. Override
 * with LUCKY_PROMPT_PROJECT.
 */
export const projectSection = defineSection({
  name: "project",
  envVar: "LUCKY_PROMPT_PROJECT",
  compute: (ctx) => (ctx.project ? renderProjectFacts(ctx.project) : null),
});
