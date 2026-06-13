import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Agent,
  ContentPart,
  ContextStatus,
  SkillActivator,
  TokenUsage,
  ToolResultMetadata,
} from "@luckycli/core";
import type { Item } from "../lib/items.js";
import { formatNumber } from "../lib/format.js";
import { humanizeError } from "../lib/errors.js";
import { handleEvent } from "../lib/turn-events.js";

// Task tools don't get their own transcript rows: the live TaskPanel checklist
// (driven by the store's onTasksUpdated emitter) is their only feedback, which
// avoids a stream of duplicated "Created task …"/"Updated task …" lines.
// ask_user is likewise hidden: the interactive question box is its full surface,
// and the user's answer lands as their next message — a transcript row would just
// duplicate the box.
const HIDDEN_TOOLS = new Set([
  "task_create",
  "task_update",
  "task_list",
  "task_get",
  "ask_user",
]);

interface TurnRunnerDeps {
  agent: Agent;
  /** Append items to the transcript. */
  appendItems: (next: Item[]) => void;
  /** Replace the last matching running tool with its output. */
  patchTool: (name: string, output: string, error: boolean, metadata?: ToolResultMetadata) => void;
  onContext: (status: ContextStatus) => void;
  onUsage: (usage: TokenUsage) => void;
  /** Persist the session once the turn settles. */
  persist: () => void;
  /**
   * Automatic skill activation. When present, the user message is augmented
   * with matched skills' instruction blocks before `agent.send`, and the
   * active set is cleared on compaction. Absent = skills disabled.
   */
  skills?: SkillActivator;
}

export interface TurnRunner {
  /** Whether a turn is currently in progress. */
  busy: boolean;
  /** Timestamp the active turn started, or null when idle. */
  startedAt: number | null;
  /** The live, still-streaming assistant text (empty when not streaming). */
  streaming: string;
  /** The model is in a silent reasoning phase (no text yet, e.g. Codex). */
  reasoning: boolean;
  /** Abort the active turn, if any. */
  abort: () => void;
  /** Run one agent turn for the given user input (text, or multimodal parts). */
  runTurn: (input: string | ContentPart[]) => Promise<void>;
}

/**
 * Owns the mechanics of running a single agent turn: the streaming buffer and
 * its throttled flush, the abort controller, and translating agent events into
 * transcript items. The whole reply streams as one growing assistant message
 * (one item, committed when the block ends) — never split per delta.
 */
export function useTurnRunner({
  agent,
  appendItems,
  patchTool,
  onContext,
  onUsage,
  persist,
  skills,
}: TurnRunnerDeps): TurnRunner {
  const [busy, setBusy] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [streaming, setStreaming] = useState("");
  const [reasoning, setReasoning] = useState(false);

  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef("");
  const abortRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => abortRef.current?.abort(), []);

  // Clear any pending flush timer on unmount.
  useEffect(() => {
    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    };
  }, []);

  const runTurn = useCallback(
    async (input: string | ContentPart[]) => {
      setBusy(true);
      setStartedAt(Date.now());

      // The current narration streams as a SINGLE growing assistant message:
      // it lives in `streaming` state (one "lucky" header) and is committed to
      // the transcript as one item only when the block ends.
      let assistantBuf = "";
      const publishStreaming = () => {
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        if (pendingRef.current) {
          setStreaming(pendingRef.current);
          pendingRef.current = "";
        }
      };
      const scheduleStreaming = () => {
        pendingRef.current = assistantBuf;
        if (flushTimerRef.current) return;
        flushTimerRef.current = setTimeout(() => {
          flushTimerRef.current = null;
          if (!pendingRef.current) return;
          setStreaming(pendingRef.current);
          pendingRef.current = "";
        }, 180);
      };
      // End the current narration block: commit the whole buffer as one item.
      const flushAssistant = () => {
        publishStreaming();
        if (!assistantBuf.trim()) return;
        const buffered = assistantBuf;
        assistantBuf = "";
        setStreaming("");
        appendItems([{ kind: "assistant", text: buffered }]);
      };

      // Automatic skill activation augments the user's TEXT with matched skills'
      // instruction blocks. For a multimodal turn (ContentPart[]) we augment the
      // text part in place and leave the images untouched; a plain string turn
      // augments directly.
      let payload: string | ContentPart[] = input;
      if (skills) {
        try {
          if (typeof input === "string") {
            payload = await skills.augment(input);
          } else {
            const textIdx = input.findIndex((p) => p.type === "text");
            const baseText = textIdx >= 0 ? (input[textIdx] as { text: string }).text : "";
            const augmented = await skills.augment(baseText);
            if (augmented !== baseText) {
              const next = [...input];
              if (textIdx >= 0) next[textIdx] = { type: "text", text: augmented };
              else next.unshift({ type: "text", text: augmented });
              payload = next;
            }
          }
        } catch {
          // Skill activation is best-effort; never block a turn on it.
        }
      }

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        for await (const event of agent.send(payload, controller.signal)) {
          handleEvent(event, {
            onText: (delta) => {
              setReasoning(false);
              assistantBuf += delta;
              scheduleStreaming();
            },
            onReasoning: () => setReasoning(true),
            onToolStart: (name, rawInput) => {
              // A tool call ends the current narration block — commit any text
              // the model wrote before the tool (and clear the live preview).
              setReasoning(false);
              flushAssistant();
              if (HIDDEN_TOOLS.has(name)) return;
              appendItems([{ kind: "tool", name, input: rawInput }]);
            },
            onToolEnd: (name, output, error, metadata) => {
              if (HIDDEN_TOOLS.has(name)) return;
              patchTool(name, output, error, metadata);
            },
            onError: (message) => {
              flushAssistant();
              appendItems([{ kind: "error", text: humanizeError(message) }]);
            },
            onContext: (status) => onContext(status),
            onCompacted: (result) => {
              // The injected skill blocks may have been summarized away — clear
              // the active set so they can re-activate when next relevant.
              skills?.onCompacted();
              appendItems([
                {
                  kind: "command",
                  title: "Auto Compaction",
                  rows: [
                    { label: "removed", value: `${result.removedMessages} messages` },
                    { label: "kept", value: `${result.keptMessages} messages` },
                    {
                      label: "tokens",
                      value:
                        result.beforeTokens !== undefined && result.afterTokens !== undefined
                          ? `${formatNumber(result.beforeTokens)} -> ${formatNumber(result.afterTokens)}`
                          : "not available",
                    },
                  ],
                },
              ]);
            },
            onTurnEnd: (usage) => {
              if (usage) onUsage(usage);
            },
            onAborted: () => {
              flushAssistant();
              appendItems([{ kind: "error", text: "Interrupted by user." }]);
            },
          });
        }
      } finally {
        publishStreaming();
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        flushAssistant();
        setStreaming("");
        setReasoning(false);
        setBusy(false);
        setStartedAt(null);
        persist();
      }
    },
    [agent, appendItems, patchTool, onContext, onUsage, persist, skills],
  );

  return { busy, startedAt, streaming, reasoning, abort, runTurn };
}
