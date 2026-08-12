/**
 * Mapping from the engine's tool events to ACP tool_call updates — what an
 * editor renders as the agent works: a titled row per call with a kind icon,
 * live status, textual output, structured diffs and file locations.
 *
 * Pure builders, kept apart from the server so the mapping is testable
 * without a connection.
 */
import { isAbsolute, join } from "node:path";
import type { FileDiff, ToolResultMetadata } from "@luckycli/core";
import type { SessionNotification, ToolCallContent } from "@zed-industries/agent-client-protocol";

type ToolKind = NonNullable<
  Extract<SessionNotification["update"], { sessionUpdate: "tool_call" }>["kind"]
>;
type ToolCallLocation = NonNullable<
  Extract<SessionNotification["update"], { sessionUpdate: "tool_call" }>["locations"]
>[number];

/** Editor-facing category per built-in tool; unknown (MCP) tools are "other". */
export function toolKind(name: string): ToolKind {
  switch (name) {
    case "read_file":
    case "list_dir":
      return "read";
    case "glob":
    case "grep":
      return "search";
    case "write_file":
    case "edit_file":
    case "apply_patch":
      return "edit";
    case "exec":
    case "powershell":
      return "execute";
    case "http_fetch":
      return "fetch";
    case "graph_query":
    case "graph_overview":
    case "skill_search":
    case "skill_load":
    case "project_memory":
      return "think";
    default:
      return "other";
  }
}

/** Args worth surfacing in a row title, in display-priority order. */
const TITLE_ARG_KEYS = ["path", "command", "pattern", "query", "url", "name"] as const;

/** "read_file packages/core/src/agent/agent.ts" — name plus its salient arg. */
export function toolCallTitle(name: string, input: unknown): string {
  if (input && typeof input === "object") {
    for (const key of TITLE_ARG_KEYS) {
      const value = (input as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) return `${name} ${value}`;
    }
  }
  return name;
}

/** The file a call touches (its `path` arg), as an absolute editor location. */
function locationsFor(input: unknown, cwd: string): ToolCallLocation[] | undefined {
  if (!input || typeof input !== "object") return undefined;
  const path = (input as Record<string, unknown>).path;
  if (typeof path !== "string" || !path.trim()) return undefined;
  return [{ path: isAbsolute(path) ? path : join(cwd, path) }];
}

/** rawInput must be an object per schema; wrap oddly-shaped tool args. */
function rawInputOf(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : { value: input };
}

/**
 * ACP diff blocks from the engine's structured diff metadata.
 *
 * Per spec these carry the file's ORIGINAL and MODIFIED contents — the editor
 * runs its own diff over them to paint the familiar red/green view. Sending
 * hunk excerpts instead does not work: the excerpts do not match the file the
 * editor has open, and with two or more hunks the gaps between them collapse,
 * so the client sees the unchanged lines in between as an enormous deletion.
 *
 * The full texts come from {@link FileDiff.oldText}/`newText`. Older or
 * snippet-derived diffs may lack them; the hunk reconstruction is kept as a
 * fallback so those still render *something* rather than nothing.
 */
export function diffContents(diffs: FileDiff[], cwd: string): ToolCallContent[] {
  return diffs.map((diff) => {
    const oldText = diff.oldText ?? reconstruct(diff, "old");
    const newText = diff.newText ?? reconstruct(diff, "new");
    return {
      type: "diff",
      path: isAbsolute(diff.path) ? diff.path : join(cwd, diff.path),
      // A created file has no original contents at all.
      ...(diff.created ? {} : { oldText }),
      newText,
    };
  });
}

/** Best-effort side of a diff from its hunks, for diffs with no full text. */
function reconstruct(diff: FileDiff, side: "old" | "new"): string {
  const drop = side === "old" ? "add" : "del";
  return diff.hunks
    .map((hunk) =>
      hunk.lines
        .filter((line) => line.type !== drop)
        .map((line) => line.text)
        .join("\n"),
    )
    .join("\n");
}

export interface ToolStartEvent {
  id: string;
  name: string;
  input: unknown;
}

/** The `tool_call` update announcing a call the moment it starts. */
export function toolCallStart(
  sessionId: string,
  event: ToolStartEvent,
  cwd: string,
): SessionNotification {
  const locations = locationsFor(event.input, cwd);
  return {
    sessionId,
    update: {
      sessionUpdate: "tool_call",
      toolCallId: event.id,
      title: toolCallTitle(event.name, event.input),
      kind: toolKind(event.name),
      status: "in_progress",
      rawInput: rawInputOf(event.input),
      ...(locations ? { locations } : {}),
    },
  };
}

export interface ToolEndEvent {
  id: string;
  name: string;
  content: string;
  isError: boolean;
  metadata?: ToolResultMetadata;
}

/** The `tool_call_update` closing a call: status, output text, diffs. */
export function toolCallEnd(
  sessionId: string,
  event: ToolEndEvent,
  cwd: string,
): SessionNotification {
  const diffs = event.metadata?.diff?.length ? diffContents(event.metadata.diff, cwd) : [];
  const content: ToolCallContent[] = [
    ...(event.content
      ? [{ type: "content" as const, content: { type: "text" as const, text: event.content } }]
      : []),
    ...diffs,
  ];
  return {
    sessionId,
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: event.id,
      status: event.isError ? "failed" : "completed",
      ...(content.length > 0 ? { content } : {}),
      ...(event.metadata?.diff?.length
        ? {
            locations: event.metadata.diff.map((d) => ({
              path: isAbsolute(d.path) ? d.path : join(cwd, d.path),
            })),
          }
        : {}),
    },
  };
}
