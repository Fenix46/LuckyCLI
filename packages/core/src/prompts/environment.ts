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
