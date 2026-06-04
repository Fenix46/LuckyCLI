import { useCallback, useEffect, useRef, useState } from "react";
import type { Agent, ContextStatus, TokenUsage } from "@luckycli/core";
import type { Item } from "../lib/items.js";
import { formatNumber } from "../lib/format.js";
import { humanizeError } from "../lib/errors.js";
import { handleEvent } from "../lib/turn-events.js";

interface TurnRunnerDeps {
  agent: Agent;
  /** Append items to the transcript. */
  appendItems: (next: Item[]) => void;
  /** Replace the last matching running tool with its output. */
  patchTool: (name: string, output: string, error: boolean) => void;
  onContext: (status: ContextStatus) => void;
  onUsage: (usage: TokenUsage) => void;
  /** Persist the session once the turn settles. */
  persist: () => void;
}

export interface TurnRunner {
  /** Whether a turn is currently in progress. */
  busy: boolean;
  /** Timestamp the active turn started, or null when idle. */
  startedAt: number | null;
  /** The live, still-streaming assistant text (empty when not streaming). */
  streaming: string;
  /** Abort the active turn, if any. */
  abort: () => void;
  /** Run one agent turn for the given user text. */
  runTurn: (text: string) => Promise<void>;
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
}: TurnRunnerDeps): TurnRunner {
  const [busy, setBusy] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [streaming, setStreaming] = useState("");

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
    async (text: string) => {
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

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        for await (const event of agent.send(text, controller.signal)) {
          handleEvent(event, {
            onText: (delta) => {
              assistantBuf += delta;
              scheduleStreaming();
            },
            onToolStart: (name, rawInput) => {
              // A tool call ends the current narration block — commit any text
              // the model wrote before the tool (and clear the live preview).
              flushAssistant();
              appendItems([{ kind: "tool", name, input: rawInput }]);
            },
            onToolEnd: (name, output, error) => patchTool(name, output, error),
            onError: (message) => {
              flushAssistant();
              appendItems([{ kind: "error", text: humanizeError(message) }]);
            },
            onContext: (status) => onContext(status),
            onCompacted: (result) => {
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
        setBusy(false);
        setStartedAt(null);
        persist();
      }
    },
    [agent, appendItems, patchTool, onContext, onUsage, persist],
  );

  return { busy, startedAt, streaming, abort, runTurn };
}
