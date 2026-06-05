import { Text, useInput } from "../../vendor/ink-compat.js";
import React, { useState } from "react";

/**
 * A minimal single-line text input — a drop-in for the value/onChange/onSubmit/
 * mask subset of ink-text-input we used, on our own ink/React so the dependency
 * tree stays on a single ink 7 / React 19.
 *
 * Supports left/right cursor movement, backspace/delete, and a mask character
 * (for secrets). Enter submits.
 */
export function TextField({
  value,
  onChange,
  onSubmit,
  mask,
  isFocused = true,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  /** Render each character as this string (e.g. "*" for secrets). */
  mask?: string;
  isFocused?: boolean;
}): React.JSX.Element {
  const [cursor, setCursor] = useState(value.length);
  const offset = Math.min(cursor, value.length);

  useInput(
    (input, key) => {
      if (key.return) {
        onSubmit?.(value);
        return;
      }
      if (key.leftArrow) {
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.rightArrow) {
        setCursor((c) => Math.min(value.length, c + 1));
        return;
      }
      if (key.backspace || key.delete) {
        if (offset === 0) return;
        onChange(value.slice(0, offset - 1) + value.slice(offset));
        setCursor(offset - 1);
        return;
      }
      // Ignore control keys / modifier-only events.
      if (!input || key.ctrl || key.meta || key.tab || key.upArrow || key.downArrow) return;
      onChange(value.slice(0, offset) + input + value.slice(offset));
      setCursor(offset + input.length);
    },
    { isActive: isFocused },
  );

  const shown = mask ? mask.repeat(value.length) : value;
  const before = shown.slice(0, offset);
  const at = shown[offset] ?? " ";
  const after = shown.slice(offset + 1);

  return (
    <Text>
      {before}
      <Text inverse>{at}</Text>
      {after}
    </Text>
  );
}
