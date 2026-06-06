import os from "node:os";
import type { CommandRow } from "./items.js";

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
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

export function formatCommandRows(title: string, rows: CommandRow[]): string {
  const labelWidth = Math.max(
    title.length,
    ...rows.map((row) => row.label.length),
  );
  return [
    title,
    ...rows.map((row) => `${row.label.padEnd(labelWidth)}  ${row.value}`),
  ].join("\n");
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
  if ((name === "exec" || name === "PowerShell") && command) return command;

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

  if (name === "apply_patch") {
    const patch = inputString(input, "patch");
    return patch ? patchTargets(patch).join(", ") : "";
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
      return `${lines.length} entries`;
    case "glob":
      return lines[0]?.startsWith("[no files") ? "no matches" : `${lines.length} files`;
    case "grep":
      return lines[0]?.startsWith("[no matches") ? "no matches" : `${lines.length} matches`;
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

export function summarizeReadOutput(lines: string[]): string {
  const rangeLine = lines.find((line) => /^\[showing \d+ of \d+ lines\]$/.test(line));
  if (rangeLine) return rangeLine.replace(/^\[|\]$/g, "");
  const noLines = lines.find((line) => line.startsWith("[no lines"));
  if (noLines) return noLines.replace(/^\[|\]$/g, "");
  return `${lines.length} lines`;
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

export function pushWrappedLines(text: string, width: number): string[] {
  const output: string[] = [];
  pushWrapped(output, text, width);
  return output;
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
