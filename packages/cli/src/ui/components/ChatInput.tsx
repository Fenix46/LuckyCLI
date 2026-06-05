import { useInput } from "../../vendor/ink-compat.js";
import React, { useEffect, useState } from "react";
import { PromptBlock } from "./PromptBlock.js";

export function ChatInput({
  value,
  onChange,
  onSubmit,
  width,
  active,
  submitEnabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  width: number;
  active: boolean;
  submitEnabled: boolean;
}): React.JSX.Element {
  const [cursorOffset, setCursorOffset] = useState(value.length);

  useEffect(() => {
    setCursorOffset((offset) => Math.min(offset, value.length));
  }, [value.length]);

  useInput((input, key) => {
    if (!active) return;
    if (key.upArrow || key.downArrow || key.tab || (key.ctrl && input === "c")) return;

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
        onChange(nextValue);
        setCursorOffset(cursorOffset + 1);
        return;
      }
      if (!submitEnabled) return;
      onSubmit(value);
      return;
    }

    if (key.leftArrow) {
      setCursorOffset((offset) => Math.max(0, offset - 1));
      return;
    }

    if (key.rightArrow) {
      setCursorOffset((offset) => Math.min(value.length, offset + 1));
      return;
    }

    if (key.backspace || key.delete) {
      if (cursorOffset === 0) return;
      onChange(value.slice(0, cursorOffset - 1) + value.slice(cursorOffset));
      setCursorOffset(cursorOffset - 1);
      return;
    }

    if (!input) return;
    // Guard against stray control/escape bytes leaking in (e.g. fragments of
    // SGR mouse-wheel sequences, which share stdin with the wheel listener).
    if (hasControlChar(input)) return;
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
