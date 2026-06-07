import { defineSection } from "./section.js";

/**
 * Runtime environment block. A template with {cwd}, {os}, and {date}
 * placeholders filled in when the system prompt is composed. Override the
 * template with the LUCKY_PROMPT_ENVIRONMENT environment variable.
 */
export const ENVIRONMENT_PROMPT_TEMPLATE = `# Environment

- Working directory: {cwd}
- Platform: {os}
- Today's date: {date}`;

export interface EnvironmentInfo {
  cwd: string;
  os: string;
  date: string;
}

/** Fill the environment template with the current runtime values. */
export function renderEnvironment(
  template: string,
  info: EnvironmentInfo,
): string {
  return template
    .replaceAll("{cwd}", info.cwd)
    .replaceAll("{os}", info.os)
    .replaceAll("{date}", info.date);
}

/**
 * The environment section. The LUCKY_PROMPT_ENVIRONMENT override is the
 * *template* (it still gets {cwd}/{os}/{date} interpolated), so it is handled
 * here in compute rather than as a raw section override.
 */
export const environmentSection = defineSection({
  name: "environment",
  compute: (ctx) => {
    const override = ctx.env.LUCKY_PROMPT_ENVIRONMENT;
    const template =
      override !== undefined && override.trim() !== ""
        ? override
        : ENVIRONMENT_PROMPT_TEMPLATE;
    return renderEnvironment(template, ctx.environment);
  },
});
