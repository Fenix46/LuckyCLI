import { Box, Text } from "../../vendor/ink-compat.js";
import React from "react";
import type { DiffHunk, FileDiff } from "@luckycli/core";
import type { Theme } from "../themes.js";

/** Cap on rendered change+context rows per file, to keep the transcript sane. */
const MAX_RENDERED_LINES = 20;

/**
 * Themed unified-diff renderer: per-file header with +N −M counts, hunks with
 * line numbers, added/removed lines on the theme's diff backgrounds. Used both
 * in the transcript (after edits run) and in the approval preview.
 */
export function DiffView({
  diffs,
  theme,
  width,
}: {
  diffs: FileDiff[];
  theme: Theme;
  width: number;
}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      {diffs.map((diff) => (
        <FileDiffView key={diff.path} diff={diff} theme={theme} width={width} />
      ))}
    </Box>
  );
}

function FileDiffView({
  diff,
  theme,
  width,
}: {
  diff: FileDiff;
  theme: Theme;
  width: number;
}): React.JSX.Element {
  const deleted = !diff.created && diff.additions === 0 && diff.deletions > 0 && isFullDeletion(diff);
  const verb = diff.created ? "Created" : deleted ? "Deleted" : "Updated";
  // Widest line number in play, for a stable gutter.
  const gutter = Math.max(
    2,
    String(
      diff.hunks.reduce(
        (max, hunk) => Math.max(max, hunk.oldStart + hunk.oldLines, hunk.newStart + hunk.newLines),
        0,
      ),
    ).length,
  );
  const textWidth = Math.max(16, width - gutter - 4);

  let budget = MAX_RENDERED_LINES;
  const rendered: React.JSX.Element[] = [];
  let truncated = 0;
  for (const [hunkIndex, hunk] of diff.hunks.entries()) {
    if (budget <= 0) {
      truncated += hunk.lines.length;
      continue;
    }
    if (hunkIndex > 0 && budget > 0) {
      rendered.push(
        <Text key={`gap-${hunkIndex}`} color={theme.muted} dimColor>
          {" ".repeat(gutter)} ⋮
        </Text>,
      );
    }
    for (const [lineIndex, line] of hunk.lines.entries()) {
      if (budget <= 0) {
        truncated += hunk.lines.length - lineIndex;
        break;
      }
      budget--;
      rendered.push(
        <DiffLineView
          key={`${hunkIndex}-${lineIndex}`}
          line={line}
          gutter={gutter}
          textWidth={textWidth}
          theme={theme}
        />,
      );
    }
  }

  return (
    <Box flexDirection="column">
      <Text color={theme.muted}>
        ⎿ {verb} <Text color={theme.primary}>{diff.path}</Text>{" "}
        {diff.additions > 0 ? <Text color={theme.success}>+{diff.additions}</Text> : null}
        {diff.additions > 0 && diff.deletions > 0 ? " " : ""}
        {diff.deletions > 0 ? <Text color={theme.error}>-{diff.deletions}</Text> : null}
      </Text>
      <Box flexDirection="column" paddingLeft={2}>
        {rendered}
        {truncated > 0 ? (
          <Text color={theme.muted} dimColor>
            … +{truncated} more lines
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}

function DiffLineView({
  line,
  gutter,
  textWidth,
  theme,
}: {
  line: DiffHunk["lines"][number];
  gutter: number;
  textWidth: number;
  theme: Theme;
}): React.JSX.Element {
  const lineNo = line.type === "del" ? line.oldLine : line.newLine;
  const no = String(lineNo ?? "").padStart(gutter);
  const marker = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
  const text = clip(line.text, textWidth);
  if (line.type === "context") {
    return (
      <Text>
        <Text color={theme.muted} dimColor>{no} </Text>
        <Text color={theme.muted}>{marker} {text}</Text>
      </Text>
    );
  }
  const bg = line.type === "add" ? theme.diffAddedBg : theme.diffRemovedBg;
  return (
    <Text>
      <Text color={theme.muted} dimColor>{no} </Text>
      <Text backgroundColor={bg}>{marker} {padTo(text, textWidth)}</Text>
    </Text>
  );
}

function isFullDeletion(diff: FileDiff): boolean {
  return diff.hunks.every((hunk) => hunk.lines.every((line) => line.type !== "add"));
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\t/g, "  ");
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function padTo(text: string, width: number): string {
  return text.length < width ? text + " ".repeat(width - text.length) : text;
}
