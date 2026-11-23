/**
 * Vocabulary for the activity line.
 *
 * Deterministic on purpose: the title is a function of what is happening, not
 * random noise. The only rotation is the plain "thinking" synonym, which
 * changes every 10 seconds so a long wait doesn't look frozen.
 */
import { toolTarget } from "./format.js";

const TOOL_VERBS: Record<string, string> = {
  read_file: "Reading",
  write_file: "Writing",
  edit_file: "Editing",
  apply_patch: "Patching",
  exec: "Running",
  PowerShell: "Running",
  process: "Checking",
  list_dir: "Listing",
  glob: "Finding",
  grep: "Searching",
  http_fetch: "Fetching",
  graph_query: "Querying graph",
  graph_overview: "Mapping graph",
  task_create: "Updating tasks",
  task_update: "Updating tasks",
  task_list: "Reading tasks",
  task_get: "Reading tasks",
  project_memory: "Remembering",
  ask_user: "Waiting for your answer",
  present_plan: "Planning",
  spawn_agent: "Delegating",
  verify: "Checking",
  lsp: "Inspecting code",
  browser: "Driving browser",
  web_search: "Searching the web",
};

const THINKING_SYNONYMS = [
  "Thinking",
  "Pondering",
  "Considering",
  "Working it out",
  "Mulling it over",
];

/** Verb for a running tool, e.g. `read_file` → "Reading". */
export function activityVerbForTool(name: string): string {
  return TOOL_VERBS[name] ?? "Working";
}

/** A plain "thinking" synonym, stable for ten seconds at a time. */
export function thinkingSynonym(elapsedSeconds: number): string {
  const index = Math.floor(Math.max(0, elapsedSeconds) / 10) % THINKING_SYNONYMS.length;
  return THINKING_SYNONYMS[index]!;
}

export interface ActivityInput {
  compacting?: boolean;
  retry?: { attempt: number; maxAttempts: number } | null;
  toolName?: string | undefined;
  reasoning?: boolean;
  streaming?: boolean;
  elapsedSeconds: number;
}

/**
 * Title without the trailing ellipsis (the indicator adds it): the most
 * specific signal wins, from compaction down to a thinking synonym.
 */
export function activityTitle(input: ActivityInput): string {
  if (input.compacting) return "Summarizing";
  if (input.retry) return `Retrying (${input.retry.attempt}/${input.retry.maxAttempts})`;
  if (input.toolName) return activityVerbForTool(input.toolName);
  if (input.reasoning) return "Reasoning";
  if (input.streaming) return "Responding";
  return thinkingSynonym(input.elapsedSeconds);
}

/** Target shown after the verb, e.g. the path or command of the tool. */
export function activityDetail(input: {
  toolName?: string | undefined;
  toolInput?: unknown;
}): string | undefined {
  if (!input.toolName) return undefined;
  const target = toolTarget(input.toolName, input.toolInput);
  if (!target || target === "{}" || target === "[]") return undefined;
  return target;
}
