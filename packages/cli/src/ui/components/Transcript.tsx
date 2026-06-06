import { Box, Text } from "../../vendor/ink-compat.js";
import React from "react";
import type { ProviderId } from "@luckycli/core";
import type { Theme } from "../themes.js";
import type { Item } from "../lib/items.js";
import { formatToolAction, formatToolResultSummary, truncateSingleLine } from "../lib/format.js";
import { Markdown } from "../markdown/Markdown.js";
import { IntroBanner } from "./IntroBanner.js";
import { PromptBlock } from "./PromptBlock.js";
import { StatusView } from "./StatusView.js";
import { ThinkingStatus } from "./ThinkingStatus.js";

/**
 * The whole scrollback transcript as a plain, freely-growing column.
 *
 * No virtualization, no ScrollBox: every item is mounted and the Box grows as
 * tall as its content. Because the app renders into the terminal's NORMAL
 * screen (see index.tsx — no AlternateScreen), content taller than the viewport
 * scrolls into the terminal's native scrollback and the terminal owns scrolling
 * (wheel, PageUp/PageDown, scrollbar). The live streaming reply / thinking /
 * hint ride inside `items` as transient items (see App's displayItems), so the
 * still-streaming tail redraws in place while finalized rows stay in scrollback.
 */
export function TranscriptList({
  items,
  width,
  theme,
  provider,
  model,
}: {
  items: Item[];
  width: number;
  theme: Theme;
  provider: ProviderId;
  model: string;
}): React.JSX.Element {
  return (
    <Box flexDirection="column" width="100%">
      {items.map((item, index) => (
        <TranscriptItem
          key={`${index}:${item.kind}`}
          item={item}
          previous={index > 0 ? items[index - 1] : undefined}
          theme={theme}
          width={width}
          provider={provider}
          model={model}
        />
      ))}
    </Box>
  );
}

export function TranscriptItem({
  item,
  previous,
  theme,
  width,
  provider,
  model,
}: {
  item: Item;
  previous?: Item;
  theme: Theme;
  width: number;
  provider: ProviderId;
  model: string;
}): React.JSX.Element {
  return (
    <Box flexDirection="column" marginTop={1}>
      {shouldSeparate(item, previous) ? (
        <TranscriptDelimiter theme={theme} width={width} />
      ) : null}
      <ItemView item={item} theme={theme} width={width} provider={provider} model={model} />
    </Box>
  );
}

export function shouldSeparate(item: Item, previous?: Item): boolean {
  if (!previous) return false;
  if (item.kind === "tool" && previous.kind === "tool") return false;
  return item.kind !== previous.kind || item.kind === "user";
}

function TranscriptDelimiter({
  theme,
  width,
}: {
  theme: Theme;
  width: number;
}): React.JSX.Element {
  const line = "─".repeat(Math.max(12, Math.min(width, 100)));
  return (
    <Box marginTop={1}>
      <Text color={theme.muted} dimColor>{line}</Text>
    </Box>
  );
}

export function ItemView({
  item,
  theme,
  width,
  provider,
  model,
}: {
  item: Item;
  theme: Theme;
  width: number;
  provider?: ProviderId;
  model?: string;
}): React.JSX.Element {
  switch (item.kind) {
    case "intro":
      return (
        <Box flexDirection="column" marginY={1}>
          <IntroBanner
            theme={theme}
            provider={provider ?? "openai"}
            model={model ?? ""}
            width={width}
          />
        </Box>
      );
    case "user":
      return (
        <Box flexDirection="column">
          <PromptBlock text={item.text} width={width} />
        </Box>
      );
    case "assistant":
      return (
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Text bold color={theme.success}>● lucky</Text>
            <Text color={theme.muted}> › </Text>
          </Box>
          <Box paddingLeft={2}>
            <Markdown text={item.text} theme={theme} />
          </Box>
        </Box>
      );
    case "error":
      return (
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Text bold color={theme.error}>▲ error</Text>
            <Text color={theme.muted}> › </Text>
          </Box>
          <Box paddingLeft={2}>
            <Text color={theme.error}>{item.text}</Text>
          </Box>
        </Box>
      );
    case "tool": {
      const isRunning = item.output === undefined;
      const toolColor = item.error ? theme.error : isRunning ? theme.accent : theme.success;
      const statusSymbol = item.error ? "✖" : isRunning ? "•" : "✔";
      const action = formatToolAction(item.name, item.input, isRunning, item.error);
      const result = item.output ? formatToolResultSummary(item.name, item.output, item.error) : "";
      return (
        <Box flexDirection="row" paddingLeft={2} gap={1}>
          <Text bold color={toolColor}>{statusSymbol}</Text>
          <Text bold color={toolColor} wrap="truncate-end">{truncateSingleLine(action, Math.max(24, width - 18))}</Text>
          {isRunning ? (
            <Text color={theme.accent}>...</Text>
          ) : result ? (
            <Text color={item.error ? theme.error : theme.muted} wrap="truncate-end">
              - {truncateSingleLine(result, Math.max(16, width - action.length - 12))}
            </Text>
          ) : null}
        </Box>
      );
    }
    case "status":
      return (
        <StatusView
          provider={item.provider}
          context={item.context}
          theme={theme}
          width={width}
        />
      );
    case "streaming":
      // The live assistant reply while it streams. Rendered IDENTICALLY to the
      // finalized "assistant" item above so it doesn't jump when the turn ends
      // and the text is committed to a real assistant item.
      return (
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Text bold color={theme.success}>● lucky</Text>
            <Text color={theme.muted}> › </Text>
          </Box>
          <Box paddingLeft={2}>
            <Markdown text={item.text} theme={theme} />
          </Box>
        </Box>
      );
    case "thinking":
      return (
        <Box flexDirection="column">
          <ThinkingStatus
            theme={theme}
            elapsedSeconds={item.elapsedSeconds}
            frame={item.frame}
          />
        </Box>
      );
    case "hint":
      return (
        <Box>
          <Text color={theme.muted}>{item.text}</Text>
        </Box>
      );
    case "plan":
      return (
        <Box
          flexDirection="column"
          width={Math.max(48, Math.min(width, 104))}
          borderStyle="single"
          borderColor={theme.accent}
          borderTop={false}
          borderRight={false}
          borderBottom={false}
          paddingLeft={2}
        >
          <Text bold color={theme.accent}>▣ Plan · {item.title}</Text>
          <Box marginTop={1}>
            <Markdown text={item.markdown} theme={theme} />
          </Box>
        </Box>
      );
    case "command":
      return (
        <Box flexDirection="column" paddingLeft={2}>
          <Text bold color={theme.accent}>ℹ {item.title}</Text>
          <Box flexDirection="column" paddingLeft={2} marginTop={1}>
            {item.rows.map((row, idx) => (
              <Box key={idx} flexDirection="row">
                <Text color={theme.muted}>{row.label.padEnd(12)}: </Text>
                <Text color="white">{row.value}</Text>
              </Box>
            ))}
          </Box>
        </Box>
      );
  }
}
