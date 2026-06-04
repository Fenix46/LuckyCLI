import { Box, Text } from "ink";
import React from "react";
import type { ProviderId } from "@luckycli/core";
import type { Theme } from "../themes.js";
import type { Item } from "../lib/items.js";
import { formatToolAction, formatToolResultSummary, truncateSingleLine } from "../lib/format.js";
import { Markdown } from "../markdown/Markdown.js";
import { IntroBanner } from "./IntroBanner.js";
import { PromptBlock } from "./PromptBlock.js";
import { StatusView } from "./StatusView.js";

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
    <Box flexDirection="column" marginY={0.3}>
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
    <Box marginY={0.2}>
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
          />
        </Box>
      );
    case "user":
      return (
        <Box flexDirection="column" marginY={0.2}>
          <PromptBlock text={item.text} width={width} />
        </Box>
      );
    case "assistant":
      return (
        <Box flexDirection="column" marginY={0.2}>
          <Box flexDirection="row" marginBottom={0.1}>
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
        <Box flexDirection="column" marginY={0.2}>
          <Box flexDirection="row" marginBottom={0.1}>
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
        <Box flexDirection="row" paddingLeft={2} marginY={0.1} gap={1}>
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
    case "command":
      return (
        <Box flexDirection="column" paddingLeft={2} marginY={0.2}>
          <Text bold color={theme.accent}>ℹ {item.title}</Text>
          <Box flexDirection="column" paddingLeft={2} marginTop={0.1}>
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
