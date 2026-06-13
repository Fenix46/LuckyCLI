import { Box, Text } from "../../vendor/ink-compat.js";
import React from "react";
import type { ProviderId } from "@luckycli/core";
import type { Theme } from "../themes.js";
import type { Item } from "../lib/items.js";
import {
  formatToolAction,
  formatToolResultSummary,
  toolResultPreviewLines,
  truncateSingleLine,
} from "../lib/format.js";
import { SPINNER_FRAMES } from "./constants.js";
import { DiffView } from "./DiffView.js";
import { Markdown } from "../markdown/Markdown.js";
import { StreamingMarkdown } from "../markdown/StreamingMarkdown.js";
import { IntroBanner } from "./IntroBanner.js";
import { PromptBlock } from "./PromptBlock.js";
import { StatusView } from "./StatusView.js";

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
  activityFrame = 0,
}: {
  items: Item[];
  width: number;
  theme: Theme;
  provider: ProviderId;
  model: string;
  /** Animation tick while a turn runs; drives the running tool spinner. */
  activityFrame?: number;
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
          activityFrame={activityFrame}
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
  activityFrame = 0,
}: {
  item: Item;
  previous?: Item;
  theme: Theme;
  width: number;
  provider: ProviderId;
  model: string;
  activityFrame?: number;
}): React.JSX.Element {
  // Whitespace is the only separator: an extra blank line when the speaker
  // changes (or a new user turn starts) keeps the transcript scannable without
  // drawing horizontal rules through it.
  return (
    <Box flexDirection="column" marginTop={spacingBefore(item, previous)}>
      <ItemView
        item={item}
        theme={theme}
        width={width}
        provider={provider}
        model={model}
        activityFrame={activityFrame}
      />
    </Box>
  );
}

function spacingBefore(item: Item, previous?: Item): number {
  if (!previous) return 1;
  if (item.kind === "tool" && previous.kind === "tool") return 0;
  return item.kind !== previous.kind || item.kind === "user" ? 2 : 1;
}

export function ItemView({
  item,
  theme,
  width,
  provider,
  model,
  activityFrame = 0,
}: {
  item: Item;
  theme: Theme;
  width: number;
  provider?: ProviderId;
  model?: string;
  activityFrame?: number;
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
          <PromptBlock text={item.text} width={width} theme={theme} />
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
      // Two-line layout: the action on its own row (status glyph + verb +
      // target), the result summary indented underneath with an elbow marker.
      // Keeping the result off the action row stops long targets and long
      // results from fighting over one truncated line.
      const isRunning = item.output === undefined;
      const toolColor = item.error ? theme.error : isRunning ? theme.accent : theme.success;
      // While running, the bullet is the shared braille spinner (the timer
      // already re-renders the app each tick); done/error get a fixed glyph.
      const statusSymbol = item.error
        ? "✖"
        : isRunning
          ? SPINNER_FRAMES[activityFrame % SPINNER_FRAMES.length] ?? "●"
          : "●";
      const action = formatToolAction(item.name, item.input, isRunning, item.error);
      const result = item.output ? formatToolResultSummary(item.name, item.output, item.error) : "";
      return (
        <Box flexDirection="column" paddingLeft={2}>
          <Box flexDirection="row" gap={1}>
            <Text bold color={toolColor}>{statusSymbol}</Text>
            <Text bold wrap="truncate-end">{truncateSingleLine(action, Math.max(24, width - 8))}</Text>
            {isRunning ? <Text color={theme.accent}>…</Text> : null}
          </Box>
          {!isRunning && item.metadata?.diff?.length ? (
            <Box paddingLeft={2}>
              <DiffView diffs={item.metadata.diff} theme={theme} width={Math.max(24, width - 4)} />
            </Box>
          ) : !isRunning && result ? (
            <Box flexDirection="column" paddingLeft={2}>
              <Box flexDirection="row">
                <Text color={theme.muted}>⎿ </Text>
                <Text color={item.error ? theme.error : theme.muted} wrap="truncate-end">
                  {truncateSingleLine(result, Math.max(16, width - 10))}
                </Text>
              </Box>
              {toolResultPreviewLines(item.name, item.output ?? "", item.error).map((line, i) => (
                <Text key={i} color={theme.muted} dimColor wrap="truncate-end">
                  {"  "}{truncateSingleLine(line, Math.max(16, width - 12))}
                </Text>
              ))}
            </Box>
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
            <StreamingMarkdown text={item.text} theme={theme} />
          </Box>
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
          <Text bold color={theme.accent}>▌ {item.title}</Text>
          <Box flexDirection="column" paddingLeft={2} marginTop={1}>
            {item.rows.map((row, idx) => (
              <Box key={idx} flexDirection="row">
                <Text color={theme.muted}>{row.label.padEnd(14)}</Text>
                <Text color="white">{row.value}</Text>
              </Box>
            ))}
          </Box>
        </Box>
      );
  }
}
