import type { ContextStatus, Message, ProviderStatus } from "@luckycli/core";

/** A line in the scrollback transcript. */
export type Item =
  | { kind: "intro" }
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; name: string; input: unknown; output?: string; error?: boolean }
  | { kind: "command"; title: string; rows: CommandRow[] }
  | { kind: "status"; provider: ProviderStatus; context: ContextStatus }
  | { kind: "error"; text: string }
  // Transient items — built per-render, never persisted. They ride INSIDE the
  // virtualized list (like Claude Code's streaming reply) so the ScrollBox
  // content stays a flat [spacer, items, spacer] and stickyScroll follows them
  // as they grow. They must never be appended to the committed `items` state.
  | { kind: "streaming"; text: string }
  | { kind: "thinking"; elapsedSeconds: number; frame: number }
  | { kind: "hint"; text: string };

export interface CommandRow {
  label: string;
  value: string;
}

/** Attach output to the most recent matching tool item. */
export function patchLastTool(
  items: Item[],
  name: string,
  output: string,
  error: boolean,
): Item[] {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item && item.kind === "tool" && item.name === name && item.output === undefined) {
      const next = [...items];
      next[i] = { ...item, output, error };
      return next;
    }
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
        if (part.name.startsWith("task_")) continue;
        toolIndexById.set(part.id, items.length);
        items.push({ kind: "tool", name: part.name, input: part.arguments });
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
