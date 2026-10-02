import { Box, Text } from "../../vendor/ink-compat.js";
import React from "react";
import type { ProviderId } from "@luckycli/core";
import type { Theme } from "../themes.js";
import type { Item } from "../lib/items.js";
import {
  formatDuration,
  formatToolResultSummary,
  liveTailLines,
  toolResultPreviewLines,
  toolTarget,
  toolVerb,
  truncateSingleLine,
} from "../lib/format.js";
import { SPINNER_FRAMES } from "./constants.js";
import { GLYPH, SectionTitle } from "./kit.js";
import { DiffStats, DiffView } from "./DiffView.js";
import { Markdown } from "../markdown/Markdown.js";
import { StreamingMarkdown } from "../markdown/StreamingMarkdown.js";
import { IntroBanner } from "./IntroBanner.js";
import { PromptBlock } from "./PromptBlock.js";
import { StatusView } from "./StatusView.js";
import { link as terminalLink, LINK_END } from "../../vendor/ink/termio/osc.js";

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
          key={`${index}:${item.kind === "streaming" ? "assistant" : item.kind}`}
          item={item}
          previous={index > 0 ? items[index - 1] : undefined}
          next={items[index + 1]}
          theme={theme}
          width={width}
          provider={provider}
          model={model}
          // Only a running tool row animates. Every other row gets a constant
          // frame so the memoized item skips the 120ms spinner re-render —
          // otherwise the whole transcript reconciles on every tick.
          activityFrame={isRunningTool(item) ? activityFrame : 0}
        />
      ))}
    </Box>
  );
}

function isRunningTool(item: Item): boolean {
  return item.kind === "tool" && item.output === undefined;
}

function TranscriptItemInner({
  item,
  previous,
  next,
  theme,
  width,
  provider,
  model,
  activityFrame = 0,
}: {
  item: Item;
  previous?: Item | undefined;
  /** The following row; decides whether a tool row closes its branch. */
  next?: Item | undefined;
  theme: Theme;
  width: number;
  provider: ProviderId;
  model: string;
  activityFrame?: number;
}): React.JSX.Element {
  // Whitespace is the only separator: one blank line between blocks, none
  // between a reply and the tool calls hanging off it.
  return (
    <Box flexDirection="column" marginTop={spacingBefore(item, previous)}>
      <ItemView
        item={item}
        theme={theme}
        width={width}
        provider={provider}
        model={model}
        activityFrame={activityFrame}
        continuation={continuesReply(previous)}
        lastInGroup={next?.kind !== "tool"}
      />
    </Box>
  );
}

/**
 * Memoized on its props: committed items are immutable, so a row only
 * re-renders when its own item, neighbors, theme, size or frame changes.
 */
export const TranscriptItem = React.memo(TranscriptItemInner);

/**
 * A reply block that follows the agent's own tool rows or narration belongs
 * to the same reply: it drops the ◆ marker so a turn reads as one continuous
 * answer instead of a stack of repeated headers.
 */
function continuesReply(previous?: Item): boolean {
  return previous?.kind === "tool" || previous?.kind === "assistant" || previous?.kind === "streaming";
}

function spacingBefore(item: Item, previous?: Item): number {
  if (!previous) return 1;
  if (item.kind === "tool" && previous.kind === "tool") return 0;
  if (item.kind === "tool" && (previous.kind === "assistant" || previous.kind === "streaming")) return 0;
  return 1;
}

export function ItemView({
  item,
  theme,
  width,
  provider,
  model,
  activityFrame = 0,
  continuation = false,
  lastInGroup = true,
}: {
  item: Item;
  theme: Theme;
  width: number;
  provider?: ProviderId;
  model?: string;
  activityFrame?: number;
  /** This reply block continues the previous one: skip the marker. */
  continuation?: boolean;
  /** A tool row that closes its group draws └─ instead of ├─. */
  lastInGroup?: boolean;
}): React.JSX.Element {
  switch (item.kind) {
    case "intro":
      return (
        <IntroBanner
          theme={theme}
          provider={provider ?? "openai"}
          model={model ?? ""}
          width={width}
        />
      );
    case "user":
      return <PromptBlock text={item.text} width={width} theme={theme} />;
    case "assistant":
      return (
        <Reply theme={theme} continuation={continuation}>
          <Markdown text={item.text} theme={theme} width={width - REPLY_GUTTER} />
        </Reply>
      );
    case "streaming":
      // The live reply while it streams. Rendered IDENTICALLY to the finalized
      // "assistant" item above so it doesn't jump when the turn ends.
      return (
        <Reply theme={theme} continuation={continuation}>
          <StreamingMarkdown text={item.text} theme={theme} width={width - REPLY_GUTTER} />
        </Reply>
      );
    case "error":
      return (
        <Box flexDirection="row">
          <Box width={2} flexShrink={0}>
            <Text bold color={theme.error}>{GLYPH.fail}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text color={theme.error}>{item.text}</Text>
          </Box>
        </Box>
      );
    case "tool":
      return (
        <ToolRow
          item={item}
          theme={theme}
          width={width}
          activityFrame={activityFrame}
          last={lastInGroup}
        />
      );
    case "status":
      return (
        <StatusView
          provider={item.provider}
          context={item.context}
          costRates={item.costRates}
          theme={theme}
          width={width}
        />
      );
    case "turnSummary":
      return (
        <Box paddingLeft={2}>
          <Text color={theme.muted} wrap="truncate-end">
            {truncateSingleLine(item.text, Math.max(16, width - 4))}
          </Text>
        </Box>
      );
    case "diff":
      return (
        <Box flexDirection="column">
          <SectionTitle theme={theme} title={item.title} />
          <Box marginTop={1} paddingLeft={2}>
            <DiffView diffs={item.diffs} theme={theme} width={Math.max(24, width - 4)} />
          </Box>
        </Box>
      );
    case "notice":
      return (
        <Box paddingLeft={2}>
          {item.tone === "info" ? (
            <Text color={theme.muted}>{GLYPH.dot} </Text>
          ) : (
            <Text bold color={theme.warning}>{GLYPH.warn} </Text>
          )}
          <Text color={theme.muted} wrap="truncate-end">
            {truncateSingleLine(item.text, Math.max(16, width - 6))}
          </Text>
        </Box>
      );
    case "hint":
      return (
        <Box paddingLeft={2}>
          <Text color={theme.muted}>{item.text}</Text>
        </Box>
      );
    case "plan":
      return (
        <Box flexDirection="column" width={Math.max(48, Math.min(width, 104))}>
          <SectionTitle theme={theme} title="Plan" detail={item.title} />
          <Box
            marginTop={1}
            borderStyle="single"
            borderColor={theme.subtle}
            borderTop={false}
            borderRight={false}
            borderBottom={false}
            paddingLeft={2}
          >
            <Markdown text={item.markdown} theme={theme} width={Math.max(48, Math.min(width, 104)) - 3} />
          </Box>
        </Box>
      );
    case "command":
      return (
        <Box flexDirection="column">
          <SectionTitle theme={theme} title={item.title} />
          <Box flexDirection="column" paddingLeft={2} marginTop={1}>
            {item.rows.map((row, idx) => (
              <Box key={idx} flexDirection="row">
                <Box width={14} flexShrink={0}>
                  <Text color={theme.muted}>{row.link ? `${terminalLink(row.link)}${row.label}${LINK_END}` : row.label}</Text>
                </Box>
                <Box flexShrink={1}>
                  <Text color={theme.text}>{row.value}</Text>
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      );
  }
}

/** An assistant reply block: "◆" in the gutter on the first block only. */
/** Columns Reply's glyph column takes from the reply body. */
const REPLY_GUTTER = 2;

function Reply({
  theme,
  continuation,
  children,
}: React.PropsWithChildren<{ theme: Theme; continuation: boolean }>): React.JSX.Element {
  return (
    <Box flexDirection="row">
      <Box width={REPLY_GUTTER} flexShrink={0}>
        {continuation ? null : <Text color={theme.primary}>{GLYPH.reply}</Text>}
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {children}
      </Box>
    </Box>
  );
}

/**
 * One tool call as a branch of the reply tree:
 *
 *   ├─ Read src/parser.ts · 42 lines                       180ms
 *   │    preview lines / diff
 *   └─ Ran npm test · 12 passed                            1.4s
 *
 * The verb says what happened, the target is what it touched (accent), the
 * summary is the outcome (muted) and the duration sits on the right edge.
 */
function ToolRow({
  item,
  theme,
  width,
  activityFrame,
  last,
}: {
  item: Extract<Item, { kind: "tool" }>;
  theme: Theme;
  width: number;
  activityFrame: number;
  last: boolean;
}): React.JSX.Element {
  const isRunning = item.output === undefined;
  const verb = toolVerb(item.name, isRunning, false);
  // Targets are colored, so the quotes toolTarget adds for plain text go.
  const target = toolTarget(item.name, item.input).replace(/^"([^"]*)"/, "$1");
  const diffs = !isRunning ? item.metadata?.diff : undefined;
  const singleDiff = diffs?.length === 1 ? diffs[0] : undefined;
  // A single-file edit says it all with its counts; its text summary would
  // only repeat the path.
  const summary = singleDiff
    ? ""
    : item.output
      ? formatToolResultSummary(item.name, item.output, item.error)
      : "";
  const duration = item.durationMs !== undefined ? formatDuration(item.durationMs) : "";
  const status = item.error
    ? GLYPH.fail
    : isRunning
      ? SPINNER_FRAMES[activityFrame % SPINNER_FRAMES.length] ?? "·"
      : "";
  const statusColor = item.error ? theme.error : theme.accent;

  // Fixed columns: indent(0) + branch(3) + status(2) + verb + spaces + duration.
  const room = Math.max(16, width - 3 - (status ? 2 : 0) - verb.length - 1 - (duration ? duration.length + 2 : 0));
  const targetText = truncateSingleLine(target, Math.max(8, Math.min(room, Math.ceil(room * (summary ? 0.6 : 1)))));
  const summaryRoom = room - targetText.length - (targetText ? 3 : 0);
  const summaryText = summary && summaryRoom >= 8 ? truncateSingleLine(summary, summaryRoom) : "";

  const previewLines = isRunning
    ? item.live
      ? liveTailLines(item.live)
      : []
    : diffs?.length
      ? []
      : toolResultPreviewLines(item.name, item.output ?? "", item.error);
  const hasDiff = Boolean(diffs?.length);
  const hasChildren = previewLines.length > 0 || hasDiff;

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" width={width}>
        <Text color={theme.subtle}>{last ? GLYPH.last : GLYPH.branch} </Text>
        {status ? <Text bold color={statusColor}>{status} </Text> : null}
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end">
            <Text bold color={item.error ? theme.error : theme.text}>{verb}</Text>
            {targetText ? <Text color={theme.accent}> {targetText}</Text> : null}
            {summaryText ? (
              <Text color={item.error ? theme.error : theme.muted}> {GLYPH.dot} {summaryText}</Text>
            ) : null}
            {singleDiff ? (
              <Text>
                {"  "}
                <DiffStats diff={singleDiff} theme={theme} />
              </Text>
            ) : null}
          </Text>
        </Box>
        {duration ? <Text color={theme.muted}>  {duration}</Text> : null}
      </Box>
      {hasChildren ? (
        // The branch's vertical line runs down beside the children unless this
        // row closes the group.
        <Box
          flexDirection="row"
          {...(last
            ? { paddingLeft: 3 }
            : {
                borderStyle: "single" as const,
                borderColor: theme.subtle,
                borderTop: false,
                borderRight: false,
                borderBottom: false,
                paddingLeft: 2,
              })}
        >
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            {hasDiff ? (
              <DiffView diffs={diffs!} theme={theme} width={Math.max(24, width - 6)} header={false} />
            ) : (
              previewLines.map((line, i) => (
                <Text key={i} color={theme.muted} wrap="truncate-end">
                  {truncateSingleLine(line, Math.max(16, width - 8))}
                </Text>
              ))
            )}
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}
