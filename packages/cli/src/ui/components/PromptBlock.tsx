import { Box, Text } from "../../vendor/ink-compat.js";
import React from "react";
import type { Theme } from "../themes.js";
import { GLYPH } from "./kit.js";

export function PromptBlock({
  text,
  width,
  cursorOffset,
  active = false,
  theme,
  placeholder,
}: {
  text: string;
  width: number;
  cursorOffset?: number;
  active?: boolean;
  /** Active theme; sent-message colors fall back to lucky-dark values. */
  theme?: Theme;
  /** Muted hint shown in an empty live input. */
  placeholder?: string;
}): React.JSX.Element {
  const lineWidth = Math.max(18, width);

  // Active = the live input line: a brand-colored chevron and the typed text
  // in the theme's body color, no background. An empty prompt shows a muted
  // placeholder after the cursor so a fresh session invites typing.
  if (active) {
    const marker = `${GLYPH.user} `;
    const lines = promptBlockLines(text, cursorOffset, lineWidth, marker);
    const chevron = theme?.primary;
    const body = theme?.text;
    const showPlaceholder = text.length === 0 && placeholder;
    return (
      <Box flexDirection="column" width="100%">
        {lines.map((line, index) => (
          <Text key={`${index}-${line.text}`} color={body}>
            {index === 0 ? (
              <Text bold color={chevron}>{line.beforeCursor.slice(0, marker.length)}</Text>
            ) : (
              line.beforeCursor.slice(0, marker.length)
            )}
            {line.beforeCursor.slice(marker.length)}
            {line.cursor ? <Text inverse>{line.cursor}</Text> : null}
            {showPlaceholder ? <Text color={theme?.muted}>{placeholder}</Text> : line.afterCursor}
          </Text>
        ))}
      </Box>
    );
  }

  // Sent user message: the chevron over a faint full-width band, so the
  // user's own turns stay easy to find in the scrollback without shouting.
  const bg = theme?.userBg ?? "#1c222b";
  const fg = theme?.userFg ?? "#eef1f5";
  const chevron = theme?.primary ?? "#3ddc97";
  const marker = `${GLYPH.user} `;
  const lines = promptBlockLines(text, cursorOffset, lineWidth, marker);

  return (
    <Box flexDirection="column" width="100%">
      {lines.map((line, index) => (
        <Text key={`${index}-${line.text}`} backgroundColor={bg} color={fg}>
          {index === 0 ? (
            <Text bold backgroundColor={bg} color={chevron}>
              {line.beforeCursor.slice(0, marker.length)}
            </Text>
          ) : (
            line.beforeCursor.slice(0, marker.length)
          )}
          {line.beforeCursor.slice(marker.length)}
          {line.cursor ? (
            <Text inverse backgroundColor={bg} color={fg}>
              {line.cursor}
            </Text>
          ) : null}
          {line.afterCursor}
          <Text backgroundColor={bg}>{line.pad}</Text>
        </Text>
      ))}
    </Box>
  );
}

interface PromptBlockLine {
  text: string;
  beforeCursor: string;
  cursor: string;
  afterCursor: string;
  pad: string;
}

function promptBlockLines(
  text: string,
  cursorOffset: number | undefined,
  width: number,
  marker: string,
): PromptBlockLine[] {
  const logicalLines = (text || "").split("\n");
  const rows: PromptBlockLine[] = [];
  let offset = 0;

  logicalLines.forEach((line, index) => {
    const prefix = index === 0 ? marker : " ".repeat(marker.length);
    const available = Math.max(1, width - prefix.length);
    const chunks = chunkPromptLine(line, available);
    const lineStart = offset;
    const lineEnd = lineStart + line.length;
    const cursorOnLine =
      cursorOffset !== undefined && cursorOffset >= lineStart && cursorOffset <= lineEnd;

    // Each chunk carries its exact original offset so cursor position is correct
    chunks.forEach((chunk, chunkIndex) => {
      const chunkText = chunk.text;
      const chunkStart = lineStart + chunk.origOffset;
      const chunkEnd = chunkStart + chunkText.length;
      const cursorOnChunk =
        cursorOnLine &&
        cursorOffset !== undefined &&
        cursorOffset >= chunkStart &&
        cursorOffset <= chunkEnd &&
        (cursorOffset < chunkEnd || chunkIndex === chunks.length - 1);
      const localCursor = cursorOnChunk && cursorOffset !== undefined
        ? cursorOffset - chunkStart
        : -1;
      const label = chunkIndex === 0 ? prefix : " ".repeat(prefix.length);
      const content = `${label}${chunkText || " "}`;

      if (localCursor >= 0) {
        const cursorAbsolute = label.length + localCursor;
        const cursorChar = content[cursorAbsolute] ?? " ";
        const beforeCursor = content.slice(0, cursorAbsolute);
        const afterCursor = content.slice(cursorAbsolute + 1);
        rows.push(padPromptLine({ text: content, beforeCursor, cursor: cursorChar, afterCursor }, width));
      } else {
        rows.push(padPromptLine({ text: content, beforeCursor: content, cursor: "", afterCursor: "" }, width));
      }
    });

    offset = lineEnd + 1;
  });

  return rows;
}

function chunkPromptLine(line: string, width: number): { text: string; origOffset: number }[] {
  if (line.length === 0) return [{ text: "", origOffset: 0 }];
  if (width <= 0) return [{ text: line, origOffset: 0 }];

  // Find word-boundary break positions: start of each word in the original string
  // plus 0 (beginning).
  const breakpoints: number[] = [0];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === " ") {
      breakpoints.push(i + 1);
    }
  }

  const chunks: { text: string; origOffset: number }[] = [];
  let linePos = 0; // position in the original line

  while (linePos < line.length) {
    // How far we can go without exceeding width
    const lineEnd = Math.min(linePos + width, line.length);

    if (lineEnd >= line.length) {
      // Rest of the line fits on one chunk
      chunks.push({ text: line.slice(linePos), origOffset: linePos });
      linePos = line.length;
    } else {
      // Find the last word break at or before lineEnd so we don't split a word
      let breakIdx = lineEnd;
      for (let j = breakpoints.length - 1; j >= 0; j--) {
        if (breakpoints[j]! <= lineEnd) {
          breakIdx = breakpoints[j]!;
          break;
        }
      }

      if (breakIdx <= linePos) {
        // No break found within range — a single word exceeds width; force cut
        breakIdx = lineEnd;
      }

      chunks.push({ text: line.slice(linePos, breakIdx), origOffset: linePos });
      linePos = breakIdx;
    }
  }

  return chunks;
}

function padPromptLine(
  line: Omit<PromptBlockLine, "pad">,
  width: number,
): PromptBlockLine {
  const pad = " ".repeat(Math.max(0, width - line.text.length));
  return { ...line, pad };
}
