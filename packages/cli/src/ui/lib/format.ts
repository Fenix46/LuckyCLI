import os from "node:os";
import stripAnsi from "strip-ansi";

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

/**
 * Format an elapsed-time readout for the thinking indicator.
 *
 * Under a minute it stays in plain seconds ("42s"); from a minute on it rolls
 * over into minutes (and hours) so a long-running turn reads as "2m 05s"
 * instead of an ever-growing "125s". The seconds segment is zero-padded once
 * minutes appear so the width is stable as it ticks.
 */
export function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return `${total}s`;

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const ss = String(secs).padStart(2, "0");

  if (hours > 0) {
    const mm = String(minutes).padStart(2, "0");
    return `${hours}h ${mm}m ${ss}s`;
  }
  return `${minutes}m ${ss}s`;
}

/**
 * Compact duration for tool rows and turn recaps: sub-second calls read in
 * milliseconds, short ones with one decimal ("1.4s"), longer ones reuse the
 * elapsed format ("2m 05s").
 */
export function formatDuration(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  if (safe < 1000) return `${safe}ms`;
  if (safe < 10_000) return `${(safe / 1000).toFixed(1)}s`;
  return formatElapsed(safe / 1000);
}

/** Token counts in the short form used by the turn recap ("12.3k"). */
export function formatCompactNumber(value: number): string {
  const safe = Math.max(0, Math.round(value));
  if (safe < 1000) return String(safe);
  if (safe < 1_000_000) return `${(safe / 1000).toFixed(safe < 10_000 ? 1 : 0)}k`;
  return `${(safe / 1_000_000).toFixed(1)}M`;
}

export interface TurnSummaryInput {
  elapsedMs: number;
  tools: number;
  failedTools: number;
  inputTokens: number;
  outputTokens: number;
}

/** One-line recap printed after a turn: "✓ done in 12s · 4 tools · 8.1k in · 420 out". */
export function formatTurnSummary(summary: TurnSummaryInput): string {
  const parts = [`✓ done in ${formatDuration(summary.elapsedMs)}`];
  if (summary.tools > 0) {
    const noun = summary.tools === 1 ? "tool" : "tools";
    const failed = summary.failedTools > 0 ? ` (${summary.failedTools} failed)` : "";
    parts.push(`${summary.tools} ${noun}${failed}`);
  }
  if (summary.inputTokens > 0 || summary.outputTokens > 0) {
    parts.push(
      `${formatCompactNumber(summary.inputTokens)} in · ${formatCompactNumber(summary.outputTokens)} out`,
    );
  }
  return parts.join(" · ");
}

/**
 * Shorten a path to `max` columns by eliding its middle, keeping the start
 * (where it lives) and the end (which folder it is): "~/code/…/api/server".
 */
export function truncateMiddle(value: string, max: number): string {
  const safeMax = Math.max(8, max);
  if (value.length <= safeMax) return value;
  const tail = Math.ceil((safeMax - 1) * 0.6);
  const head = safeMax - 1 - tail;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function preview(value: unknown, max = 120): string {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

export function truncateSingleLine(value: string, max: number): string {
  const safeMax = Math.max(8, max);
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > safeMax ? `${flat.slice(0, safeMax - 1)}…` : flat;
}

export function inputString(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function quotePath(path: string): string {
  return `"${path}"`;
}

export function firstName(username: string): string {
  const cleaned = username.replace(/[._-]/g, " ").trim();
  const first = cleaned.split(" ")[0] ?? username;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/** Shorten an absolute path by collapsing the home directory to `~`. */
export function prettyCwd(cwd: string): string {
  const home = os.homedir();
  return cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
}

export function formatToolAction(
  name: string,
  input: unknown,
  running: boolean,
  error?: boolean,
): string {
  const verb = toolVerb(name, running, error);
  const target = toolTarget(name, input);
  return target ? `${verb} ${target}` : verb;
}

export function toolVerb(name: string, running: boolean, error?: boolean): string {
  if (error) return `Failed ${name}`;
  const pair: readonly [string, string] = (() => {
    switch (name) {
      case "exec":
      case "PowerShell":
        return ["Run", "Ran"];
      case "process":
        return ["Check process", "Checked process"];
      case "present_plan":
        return ["Present plan", "Presented plan"];
      case "verify":
        return ["Check", "Checked"];
      case "spawn_agent":
        return ["Delegate to", "Delegated to"];
      case "read_file":
        return ["Read", "Read"];
      case "write_file":
        return ["Write", "Wrote"];
      case "edit_file":
        return ["Edit", "Edited"];
      case "apply_patch":
        return ["Apply patch", "Applied patch"];
      case "list_dir":
        return ["List", "Listed"];
      case "glob":
        return ["Find", "Found"];
      case "grep":
        return ["Search", "Searched"];
      case "http_fetch":
        return ["Fetch", "Fetched"];
      case "graph_query":
        return ["Query graph", "Queried graph"];
      case "graph_overview":
        return ["Overview graph", "Graphed overview"];
      case "task_create":
        return ["Create task", "Created task"];
      case "task_update":
        return ["Update task", "Updated task"];
      case "task_list":
        return ["List tasks", "Listed tasks"];
      case "task_get":
        return ["Get task", "Got task"];
      case "project_memory":
        return ["Remember", "Remembered"];
      case "ask_user":
        return ["Ask user", "Asked user"];
      default:
        return ["Run tool", "Ran tool"];
    }
  })();
  return running ? pair[0] : pair[1];
}

export function toolTarget(name: string, input: unknown): string {
  const command = inputString(input, "command");
  if ((name === "exec" || name === "PowerShell") && command) {
    const background = (input as { background?: unknown }).background === true;
    return background ? `${command} (background)` : command;
  }

  if (name === "process") {
    const action = inputString(input, "action") ?? "";
    const id = inputString(input, "id");
    return id ? `${action} ${id}` : action;
  }

  const path = inputString(input, "path");
  if (["read_file", "write_file", "edit_file", "list_dir"].includes(name) && path) {
    return quotePath(path);
  }

  if (name === "grep") {
    const pattern = inputString(input, "pattern");
    const include = inputString(input, "include");
    return [pattern ? quotePath(pattern) : "", include ? `in ${include}` : ""]
      .filter(Boolean)
      .join(" ");
  }

  if (name === "glob") {
    const pattern = inputString(input, "pattern");
    return pattern ? quotePath(pattern) : "";
  }

  if (name === "http_fetch") {
    return inputString(input, "url") ?? "";
  }

  if (name === "graph_query") {
    const query = inputString(input, "query");
    const relation = inputString(input, "relation");
    return [query ? quotePath(query) : "", relation ? `(${relation})` : ""]
      .filter(Boolean)
      .join(" ");
  }

  if (name === "graph_overview") {
    const limit =
      input && typeof input === "object" && !Array.isArray(input)
        ? (input as Record<string, unknown>).limit
        : undefined;
    return typeof limit === "number" ? `top ${limit}` : "";
  }

  if (name === "apply_patch") {
    const patch = inputString(input, "patch");
    return patch ? patchTargets(patch).join(", ") : "";
  }

  if (name === "spawn_agent") {
    const agent = inputString(input, "agent") ?? "sub-agent";
    const task = inputString(input, "task");
    const files = (input as { files?: unknown } | null)?.files;
    const owned = Array.isArray(files) && files.length > 0 ? ` [${files.join(", ")}]` : "";
    return `${agent}${owned}${task ? ` — ${task}` : ""}`;
  }

  if (name === "verify") {
    const command = inputString(input, "command");
    const automatic = (input as { automatic?: unknown } | null)?.automatic === true;
    return command ? `${command}${automatic ? " (automatic)" : ""}` : "project";
  }

  if (name === "present_plan") {
    return inputString(input, "title") ?? "";
  }

  if (name === "task_create") {
    return inputString(input, "subject") ?? "";
  }

  if (name === "task_update" || name === "task_get") {
    const id = inputString(input, "id");
    const status = inputString(input, "status");
    return [id ? `#${id}` : "", status ? `→ ${status}` : ""].filter(Boolean).join(" ");
  }

  if (name === "project_memory") {
    return inputString(input, "operation") ?? ".lucky/memory.md";
  }

  if (name === "ask_user") {
    return inputString(input, "question") ?? "";
  }

  return preview(input, 120);
}

export function formatToolResultSummary(name: string, output: string, error?: boolean): string {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return "";
  if (error) return firstUsefulLine(lines);

  switch (name) {
    case "exec":
    case "PowerShell":
      return firstUsefulLine(lines);
    case "read_file":
      return summarizeReadOutput(lines);
    case "list_dir":
      return plural(lines.length, "entry", "entries");
    case "glob":
      return lines[0]?.startsWith("[no files") ? "no matches" : plural(lines.length, "file");
    case "grep":
      return lines[0]?.startsWith("[no matches") ? "no matches" : plural(lines.length, "match", "matches");
    case "write_file":
    case "edit_file":
    case "apply_patch":
    case "task_create":
    case "task_update":
    case "task_get":
    case "task_list":
    case "project_memory":
    case "ask_user":
    case "http_fetch":
      return firstUsefulLine(lines);
    default:
      return firstUsefulLine(lines);
  }
}

// Tools whose first few result lines are worth showing under the summary —
// search/listing tools where WHAT was found matters, not just how much.
// read_file is deliberately absent: its content preview would only be noise.
const RESULT_PREVIEW_LINES: Record<string, number> = {
  grep: 3,
  glob: 3,
  list_dir: 3,
};

// Shell commands show the TAIL of their output under the summary line: the
// end of a build/test run (the verdict, the error) is what matters, and the
// first line is already the summary.
const COMMAND_PREVIEW_LINES = 4;

/**
 * The first few actual result lines for tools where they aid scanning.
 * Pure rendering: the full output already went to the model, so this costs
 * zero tokens. Bracketed status lines ("[showing…]") are skipped.
 */
export function toolResultPreviewLines(
  name: string,
  output: string,
  error?: boolean,
): string[] {
  if (name === "exec" || name === "PowerShell") return commandPreviewLines(output);
  if (error) return [];
  const limit = RESULT_PREVIEW_LINES[name];
  if (!limit) return [];
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("[") && !/^no matches/i.test(line));
  return lines.slice(0, limit);
}

/**
 * The last few output lines of a shell command, excluding the line already
 * shown as the summary. Failures included: the tail is usually the error.
 */
export function commandPreviewLines(output: string): string[] {
  const lines = output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() && !line.trim().startsWith("[command failed:"));
  const rest = lines.slice(1);
  if (rest.length <= COMMAND_PREVIEW_LINES) return rest;
  const hidden = rest.length - COMMAND_PREVIEW_LINES;
  return [`… ${hidden} more ${hidden === 1 ? "line" : "lines"}`, ...rest.slice(-COMMAND_PREVIEW_LINES)];
}

/**
 * The last `count` non-empty lines of a running command's live output, as a
 * terminal would show them: colors stripped and carriage-return progress
 * bars collapsed to their latest state.
 */
export function liveTailLines(live: string, count = 3): string[] {
  return stripAnsi(live)
    .split("\n")
    .map((line) => (line.includes("\r") ? line.slice(line.lastIndexOf("\r", line.length - 2) + 1) : line))
    .map((line) => line.replace(/\r/g, "").trimEnd())
    .filter((line) => line.trim())
    .slice(-count);
}

export function summarizeReadOutput(lines: string[]): string {
  if (lines[0]?.startsWith("[File unchanged since your earlier read")) return "unchanged · already in context";
  const rangeLine = lines.find((line) => /^\[showing \d+ of \d+ lines\]$/.test(line));
  if (rangeLine) return rangeLine.replace(/^\[|\]$/g, "");
  const noLines = lines.find((line) => line.startsWith("[no lines"));
  if (noLines) return noLines.replace(/^\[|\]$/g, "");
  return plural(lines.length, "line");
}

/** "1 line" / "3 lines". */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function firstUsefulLine(lines: string[]): string {
  return lines.find((line) => !line.startsWith("[command failed:")) ?? lines[0] ?? "";
}

export function patchTargets(patch: string): string[] {
  const targets = new Set<string>();
  for (const line of patch.split("\n")) {
    const match = /^\+\+\+\s+(?:b\/)?(.+)$/.exec(line);
    if (!match) continue;
    const target = match[1];
    if (!target || target === "/dev/null") continue;
    targets.add(quotePath(target));
  }
  return [...targets].slice(0, 3);
}

export function wrapText(text: string, width: number): string[] {
  const safeWidth = Math.max(16, width);
  const output: string[] = [];
  let inCodeBlock = false;

  for (const rawLine of text.split("\n")) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      pushWrapped(output, `  ${rawLine.replace(/\t/g, "  ")}`, safeWidth);
      continue;
    }

    if (!trimmed) {
      output.push("");
      continue;
    }

    const listMatch = rawLine.match(/^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/);
    if (listMatch) {
      const prefix = listMatch[1] ?? "";
      const body = stripInlineMarkdown(listMatch[2] ?? "");
      pushWrapped(output, `${prefix}${body}`, safeWidth, " ".repeat(prefix.length));
      continue;
    }

    pushWrapped(output, stripInlineMarkdown(trimmed), safeWidth);
  }

  return output.length > 0 ? output : [""];
}

export function pushWrapped(
  output: string[],
  text: string,
  width: number,
  continuationPrefix = "",
): void {
  if (text.length <= width) {
    output.push(text);
    return;
  }

  const firstPrefixLength = Math.max(0, text.length - text.trimStart().length);
  const firstPrefix = " ".repeat(firstPrefixLength);
  let prefix = firstPrefix;
  let rest = text.trimStart();

  while (rest.length > 0) {
    const available = Math.max(8, width - prefix.length);
    if (rest.length <= available) {
      output.push(`${prefix}${rest}`);
      return;
    }

    let splitAt = rest.lastIndexOf(" ", available);
    if (splitAt <= 0) splitAt = available;
    output.push(`${prefix}${rest.slice(0, splitAt).trimEnd()}`);
    rest = rest.slice(splitAt).trimStart();
    prefix = continuationPrefix || firstPrefix;
  }
}

export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}
