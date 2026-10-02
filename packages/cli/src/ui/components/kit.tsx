/**
 * Shared visual vocabulary. Every screen draws from the same small set of
 * glyphs and primitives so the interface reads as one system:
 *
 *   ❯  the user (prompt, sent messages) and the cursor in any list
 *   ◆  the assistant's reply
 *   ◇  a section heading (panels, command output, plans, diffs)
 *   ├─ └─ tool calls hanging off a reply
 *   ✓ ✗ !  success, failure, warning
 *   ●  the current/active value in a list
 *
 * Color carries meaning, never decoration: primary is the brand, accent marks
 * what is active or selectable, muted is secondary text and subtle is chrome.
 */
import React from "react";
import { Box, Text } from "../../vendor/ink-compat.js";
import type { Theme } from "../themes.js";

export const GLYPH = {
  user: "❯",
  reply: "◆",
  section: "◇",
  cursor: "❯",
  active: "●",
  ok: "✓",
  fail: "✗",
  warn: "!",
  dot: "·",
  branch: "├─",
  last: "└─",
  clover: "☘",
} as const;

/** A panel or section heading: "◇ Title · detail". */
export function SectionTitle({
  theme,
  title,
  detail,
  tone = "accent",
}: {
  theme: Theme;
  title: string;
  detail?: string | undefined;
  tone?: "accent" | "warning" | "error";
}): React.JSX.Element {
  const color = tone === "warning" ? theme.warning : tone === "error" ? theme.error : theme.accent;
  return (
    <Text wrap="truncate-end">
      <Text color={color}>{GLYPH.section} </Text>
      <Text bold color={theme.text}>{title}</Text>
      {detail ? <Text color={theme.muted}> {GLYPH.dot} {detail}</Text> : null}
    </Text>
  );
}

/**
 * One row of a selectable list. The cursor row gets the chevron and the accent
 * color; the active value (current model, theme...) gets a dot.
 */
export function OptionRow({
  theme,
  selected,
  active,
  label,
  labelWidth,
  detail,
  tone,
}: {
  theme: Theme;
  selected: boolean;
  /** Lists with a current value pass a boolean; the dot column appears only then. */
  active?: boolean | undefined;
  label: string;
  /** Pad the label to this width so details line up in a column. */
  labelWidth?: number;
  detail?: string | undefined;
  /** Overrides the selected color (e.g. error for a destructive choice). */
  tone?: string;
}): React.JSX.Element {
  const color = selected ? tone ?? theme.accent : theme.text;
  const shown = labelWidth ? label.padEnd(labelWidth) : label;
  return (
    <Box flexDirection="row">
      <Text color={theme.accent}>{selected ? `${GLYPH.cursor} ` : "  "}</Text>
      {active !== undefined ? (
        <Text color={theme.primary}>{active ? `${GLYPH.active} ` : "  "}</Text>
      ) : null}
      <Text bold={selected} color={color} wrap="truncate-end">
        {shown}
      </Text>
      {detail ? (
        <Text color={theme.muted} wrap="truncate-end">
          {"  "}
          {detail}
        </Text>
      ) : null}
    </Box>
  );
}

/** Key legend: "↑↓ move  enter select  esc close", keys emphasized. */
export function KeyHints({
  theme,
  hints,
  marginTop = 1,
}: {
  theme: Theme;
  hints: ReadonlyArray<readonly [key: string, action: string]>;
  marginTop?: number;
}): React.JSX.Element {
  return (
    <Box marginTop={marginTop}>
      <Text wrap="truncate-end">
        {hints.map(([key, action], index) => (
          <Text key={`${key}-${index}`}>
            {index > 0 ? "   " : ""}
            <Text color={theme.text}>{key}</Text>
            <Text color={theme.muted}> {action}</Text>
          </Text>
        ))}
      </Text>
    </Box>
  );
}

/** Two tabs, the current one emphasized: "Installed   Search". */
export function Tabs({
  theme,
  tabs,
  current,
}: {
  theme: Theme;
  tabs: ReadonlyArray<{ id: string; label: string }>;
  current: string;
}): React.JSX.Element {
  return (
    <Box flexDirection="row" gap={3}>
      {tabs.map((tab) =>
        tab.id === current ? (
          <Text key={tab.id} bold color={theme.accent} underline>
            {tab.label}
          </Text>
        ) : (
          <Text key={tab.id} color={theme.muted}>
            {tab.label}
          </Text>
        ),
      )}
    </Box>
  );
}

/** Color for a fill level: calm, then warning, then error as it fills up. */
export function meterColor(theme: Theme, percent: number): string {
  if (percent >= 85) return theme.error;
  if (percent >= 60) return theme.warning;
  return theme.primary;
}

/** A compact fill meter: "▰▰▰▱▱▱▱▱". */
export function Meter({
  theme,
  percent,
  cells = 8,
  color,
}: {
  theme: Theme;
  percent: number;
  cells?: number;
  color?: string;
}): React.JSX.Element {
  const safe = Math.max(0, Math.min(100, percent));
  const filled = safe === 0 ? 0 : Math.max(1, Math.round((safe / 100) * cells));
  return (
    <Text>
      <Text color={color ?? meterColor(theme, safe)}>{"▰".repeat(filled)}</Text>
      <Text color={theme.subtle}>{"▱".repeat(Math.max(0, cells - filled))}</Text>
    </Text>
  );
}

/**
 * Split a legacy hint string ("enter toggle · d remove · esc close") into
 * key/action pairs for KeyHints: the first word of each part is the key.
 * Bracketed keys ("[n] new") lose their brackets.
 */
export function parseHints(text: string): Array<readonly [string, string]> {
  return text.split(" · ").map((part) => {
    const trimmed = part.trim();
    const space = trimmed.indexOf(" ");
    const key = (space === -1 ? trimmed : trimmed.slice(0, space)).replace(/^\[(.+)\]$/, "$1");
    return [key, space === -1 ? "" : trimmed.slice(space + 1)] as const;
  });
}
