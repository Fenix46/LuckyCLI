import { useInput } from "../../vendor/ink-compat.js";
import React, { useEffect, useRef, useState } from "react";
import { deleteWordLeft, wordLeft, wordRight } from "../lib/line-edit.js";
import { PromptBlock } from "./PromptBlock.js";
import {
  countLines,
  formatPastedRef,
  shouldStashPaste,
  type PastedContent,
} from "../lib/paste.js";

export function ChatInput({
  value,
  onChange,
  onSubmit,
  onPaste,
  nextPasteId,
  width,
  active,
  submitEnabled,
  history = [],
  historyEnabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  /** Stash a large paste; the placeholder id is allocated via nextPasteId. */
  onPaste?: (content: PastedContent) => void;
  /** Allocates the next placeholder id (kept in App state with the stash). */
  nextPasteId?: () => number;
  width: number;
  active: boolean;
  submitEnabled: boolean;
  /** Previously sent prompts, oldest first, for arrow-up recall. */
  history?: string[];
  /** False while a picker/menu owns the arrow keys, so recall never collides. */
  historyEnabled?: boolean;
}): React.JSX.Element {
  const [cursorOffset, setCursorOffset] = useState(value.length);
  // Arrow-up history recall: null = composing, otherwise the index into
  // `history` currently shown. The draft preserves whatever was being typed
  // when navigation started, restored when arrowing back past the newest entry.
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const draftRef = useRef("");

  useEffect(() => {
    setCursorOffset((offset) => Math.min(offset, value.length));
  }, [value.length]);

  const recall = (index: number | null) => {
    const next = index === null ? draftRef.current : history[index] ?? "";
    setHistoryIndex(index);
    onChange(next);
    setCursorOffset(next.length);
  };

  useInput((input, key) => {
    if (!active) return;
    if (key.upArrow || key.downArrow) {
      if (!historyEnabled || history.length === 0) return;
      const navigating = historyIndex !== null;
      if (key.upArrow) {
        // Only steal arrow-up from an empty (or already-navigating) prompt;
        // while composing fresh text the arrows stay inert as before.
        if (!navigating && value.trim() !== "") return;
        if (!navigating) draftRef.current = value;
        recall(navigating ? Math.max(0, historyIndex - 1) : history.length - 1);
        return;
      }
      if (!navigating) return;
      const next = historyIndex + 1;
      recall(next >= history.length ? null : next);
      return;
    }
    if (key.tab || (key.ctrl && input === "c")) return;

    if (key.return || input === "\r" || input === "\n") {
      // Ink reports a *plain* Enter as key.return === true with no modifiers.
      // A modified Enter for a newline — Option/Alt+Enter on macOS, Ctrl+Enter
      // on Windows/Linux — reaches here differently: ink strips the ESC prefix
      // so it arrives as a bare "\r"/"\n" with key.return === false (Option on
      // macOS), or with key.ctrl/key.meta set. So anything that is NOT a plain
      // Enter inserts a newline; only a plain Enter submits.
      const isPlainEnter = key.return && !key.ctrl && !key.meta;
      if (!isPlainEnter) {
        const nextValue = insertAt(value, cursorOffset, "\n");
        setHistoryIndex(null);
        onChange(nextValue);
        setCursorOffset(cursorOffset + 1);
        return;
      }
      if (!submitEnabled) return;
      setHistoryIndex(null);
      onSubmit(value);
      return;
    }

    if (key.leftArrow) {
      // Alt+← jumps a word; plain ← moves one character.
      setCursorOffset((offset) => (key.meta ? wordLeft(value, offset) : Math.max(0, offset - 1)));
      return;
    }

    if (key.rightArrow) {
      setCursorOffset((offset) => (key.meta ? wordRight(value, offset) : Math.min(value.length, offset + 1)));
      return;
    }

    // Readline-style editing. Ctrl+letter arrives as the bare letter with
    // key.ctrl set (see vendor/ink input-event.ts).
    if (key.ctrl && input === "a") {
      setCursorOffset(0);
      return;
    }
    if (key.ctrl && input === "e") {
      setCursorOffset(value.length);
      return;
    }
    if (key.ctrl && input === "u") {
      setHistoryIndex(null);
      onChange(value.slice(cursorOffset));
      setCursorOffset(0);
      return;
    }
    if (key.ctrl && input === "k") {
      setHistoryIndex(null);
      onChange(value.slice(0, cursorOffset));
      return;
    }
    if (key.ctrl && input === "w") {
      const next = deleteWordLeft(value, cursorOffset);
      setHistoryIndex(null);
      onChange(next.text);
      setCursorOffset(next.offset);
      return;
    }
    // Alt+B / Alt+F word jumps, the readline aliases for Alt+arrows.
    if (key.meta && input === "b") {
      setCursorOffset((offset) => wordLeft(value, offset));
      return;
    }
    if (key.meta && input === "f") {
      setCursorOffset((offset) => wordRight(value, offset));
      return;
    }

    if (key.backspace || key.delete) {
      if (cursorOffset === 0) return;
      setHistoryIndex(null);
      onChange(value.slice(0, cursorOffset - 1) + value.slice(cursorOffset));
      setCursorOffset(cursorOffset - 1);
      return;
    }

    if (!input) return;

    // A bracketed paste arrives as one chunk flagged isPasted by the terminal
    // parser. Large pastes flood the prompt (and force a full repaint), so
    // stash them behind a compact `[Pasted text #N +M lines]` placeholder and
    // splice the real content back in at submit time. This runs before the
    // control-char guard below because a multi-line paste legitimately
    // contains "\n".
    if (key.isPasted && onPaste && nextPasteId) {
      setHistoryIndex(null);
      const cleaned = input.replace(/\r\n?/g, "\n");
      if (shouldStashPaste(cleaned)) {
        const id = nextPasteId();
        onPaste({ id, content: cleaned });
        const placeholder = formatPastedRef(id, countLines(cleaned));
        const nextValue = insertAt(value, cursorOffset, placeholder);
        onChange(nextValue);
        setCursorOffset(cursorOffset + placeholder.length);
        return;
      }
      // Small paste: insert as-is, but keep the newline normalization.
      const nextValue = insertAt(value, cursorOffset, cleaned);
      onChange(nextValue);
      setCursorOffset(cursorOffset + cleaned.length);
      return;
    }

    // Guard against stray control/escape bytes leaking in (e.g. fragments of
    // SGR mouse-wheel sequences, which share stdin with the wheel listener).
    if (hasControlChar(input)) return;
    setHistoryIndex(null);
    const nextValue = insertAt(value, cursorOffset, input);
    onChange(nextValue);
    setCursorOffset(cursorOffset + input.length);
  });

  return (
    <PromptBlock
      text={value}
      width={width}
      cursorOffset={cursorOffset}
      active
    />
  );
}

function insertAt(value: string, offset: number, text: string): string {
  return value.slice(0, offset) + text + value.slice(offset);
}

/** True if the string contains any C0 control character (code < 0x20). */
function hasControlChar(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 0x20) return true;
  }
  return false;
}
