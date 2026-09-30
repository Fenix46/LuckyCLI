import type { ContextStatus, Message, ProviderStatus, TokenCostRates, ToolResultMetadata } from "@luckycli/core";

/** A line in the scrollback transcript. */
export type Item =
  | { kind: "intro" }
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | {
      kind: "tool";
      /** Provider tool-call id; pairs the row with its result. */
      id?: string;
      name: string;
      input: unknown;
      output?: string;
      error?: boolean;
      /** Structured tool details (diffs etc.) for rich rendering. */
      metadata?: ToolResultMetadata;
      /** Epoch ms the call started (live turns only). */
      startedAt?: number;
      /** Wall-clock duration once finished (live turns only). */
      durationMs?: number;
      /** Tail of the output streamed while the call runs (display only). */
      live?: string;
    }
  | { kind: "command"; title: string; rows: CommandRow[] }
  | { kind: "plan"; title: string; markdown: string }
  | { kind: "status"; provider: ProviderStatus; context: ContextStatus; costRates?: TokenCostRates }
  | { kind: "error"; text: string }
  /** One-line recap printed when a turn settles (time, tools, tokens). */
  | { kind: "turnSummary"; text: string }
  /** A neutral status line (e.g. the user interrupted the turn) — not an error. */
  | { kind: "notice"; text: string }
  // Transient items — built per-render, never persisted. They ride INSIDE the
  // virtualized list (like Claude Code's streaming reply) so the ScrollBox
  // content stays a flat [spacer, items, spacer] and stickyScroll follows them
  // as they grow. They must never be appended to the committed `items` state.
  | { kind: "streaming"; text: string }
  | { kind: "hint"; text: string };

export interface CommandRow {
  label: string;
  value: string;
  /** Optional terminal hyperlink target for a file/line location. */
  link?: string;
}

/**
 * Attach output to the running tool item for this call. Matching by call id
 * keeps results on the right row when several calls of the same tool are in
 * flight; without an id it falls back to the most recent unfinished row of
 * that name.
 */
export function patchLastTool(
  items: Item[],
  name: string,
  output: string,
  error: boolean,
  metadata?: ToolResultMetadata,
  id?: string,
  finishedAt?: number,
): Item[] {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (!item || item.kind !== "tool" || item.output !== undefined) continue;
    const matches = id !== undefined && item.id !== undefined ? item.id === id : item.name === name;
    if (!matches) continue;
    const next = [...items];
    next[i] = {
      ...item,
      output,
      error,
      ...(metadata ? { metadata } : {}),
      ...(item.startedAt !== undefined && finishedAt !== undefined
        ? { durationMs: Math.max(0, finishedAt - item.startedAt) }
        : {}),
    };
    return next;
  }
  return items;
}

// Enough tail to fill a few preview lines; older live output is dropped.
const LIVE_TAIL_CHARS = 2_000;

/** Append streamed output to the running row for this call id. */
export function appendLiveOutput(items: Item[], id: string, chunk: string): Item[] {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item?.kind !== "tool" || item.id !== id) continue;
    if (item.output !== undefined) return items;
    const next = [...items];
    next[i] = { ...item, live: `${item.live ?? ""}${chunk}`.slice(-LIVE_TAIL_CHARS) };
    return next;
  }
  return items;
}

/**
 * Restart the clock of the latest running row of this tool. Called when the
 * user approves it, so the row's duration measures the work, not the time
 * the prompt sat waiting for an answer.
 */
export function restartRunningTool(items: Item[], name: string, now: number): Item[] {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item?.kind !== "tool" || item.output !== undefined || item.name !== name) continue;
    if (item.startedAt === undefined) return items;
    const next = [...items];
    next[i] = { ...item, startedAt: now };
    return next;
  }
  return items;
}

/**
 * Rebuild the scrollback transcript from a resumed session's canonical
 * messages. Tool calls and their results are stitched back together by id.
 */
export function messagesToItems(messages: Message[]): Item[] {
  const items: Item[] = [];
  const toolIndexById = new Map<string, number>();

  for (const message of messages) {
    const assistantMessageHasToolCall =
      message.role === "assistant" &&
      message.content.some((part) => part.type === "tool_call");
    for (const part of message.content) {
      if (part.type === "text") {
        const text = part.text.trim();
        if (!text) continue;
        if (message.role === "user") items.push({ kind: "user", text });
        else if (message.role === "assistant" && !assistantMessageHasToolCall) {
          items.push({ kind: "assistant", text });
        }
        // system summaries (from compaction) are context only — skip in the UI
      } else if (part.type === "tool_call") {
        // Task tools are surfaced by the live TaskPanel, not as transcript
        // rows — skip them on resume too so a reopened session matches what was
        // shown live (and the result below has nothing to attach to).
        if (part.name.startsWith("task_") || part.name === "ask_user") continue;
        toolIndexById.set(part.id, items.length);
        items.push({ kind: "tool", id: part.id, name: part.name, input: part.arguments });
      } else if (part.type === "tool_result") {
        const index = toolIndexById.get(part.toolCallId);
        const target = index !== undefined ? items[index] : undefined;
        if (target && target.kind === "tool") {
          target.output = part.content;
          if (part.isError) target.error = true;
        }
      }
    }
  }

  return items;
}
