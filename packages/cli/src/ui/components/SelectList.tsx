import { Box, Text, useInput } from "../../vendor/ink-compat.js";
import React, { useState } from "react";
import type { Theme } from "../themes.js";

export interface SelectItem<V> {
  label: string;
  value: V;
}

/**
 * A minimal arrow-key select list — a drop-in for the `items` + `onSelect`
 * subset of ink-select-input we used, reimplemented on our own ink/React so the
 * dependency tree stays on a single ink 7 / React 19 (the addon pinned ink 5 /
 * React 18, which can't coexist with ink 7).
 *
 * Up/Down (and k/j) move; Enter selects. Wraps around at the ends.
 */
export function SelectList<V>({
  items,
  onSelect,
  isFocused = true,
  theme,
}: {
  items: SelectItem<V>[];
  onSelect: (item: SelectItem<V>) => void;
  /** When false, the list ignores keyboard input. */
  isFocused?: boolean;
  /** Active theme; falls back to legacy cyan/gray when not provided. */
  theme?: Theme;
}): React.JSX.Element {
  const accent = theme?.accent ?? "cyan";
  const muted = theme?.muted ?? "gray";
  const [index, setIndex] = useState(0);
  const safeIndex = items.length === 0 ? 0 : Math.min(index, items.length - 1);

  useInput(
    (input, key) => {
      if (items.length === 0) return;
      if (key.upArrow || input === "k") {
        setIndex((i) => (i - 1 + items.length) % items.length);
      } else if (key.downArrow || input === "j") {
        setIndex((i) => (i + 1) % items.length);
      } else if (key.return) {
        const item = items[safeIndex];
        if (item) onSelect(item);
      }
    },
    { isActive: isFocused },
  );

  return (
    <Box flexDirection="column">
      {items.map((item, i) => {
        const selected = i === safeIndex;
        return (
          <Box key={`${String(item.value)}-${i}`} flexDirection="row">
            <Text color={selected ? accent : muted}>{selected ? "❯ " : "  "}</Text>
            <Text color={selected ? accent : undefined} bold={selected}>
              {item.label}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
