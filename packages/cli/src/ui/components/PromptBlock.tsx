import { Box, Text } from "../../vendor/ink-compat.js";
import React from "react";
import type { Theme } from "../themes.js";

export function PromptBlock({
  text,
  width,
  cursorOffset,
  active = false,
  theme,
}: {
  text: string;
  width: number;
  cursorOffset?: number;
  active?: boolean;
  /** Active theme; sent-message colors fall back to lucky-dark values. */
  theme?: Theme;
}): React.JSX.Element {
  const lineWidth = Math.max(18, width);

  // Active = the live input line. Keep it clean: a chevron prompt and the typed
  // text in the terminal's default foreground, with no "you" badge and no
  // background fill. The full highlight is reserved for sent messages so they
  // stand out in the transcript.
  if (active) {
    const lines = promptBlockLines(text, cursorOffset, lineWidth, "› ");
    return (
      <Box flexDirection="column" width="100%">
        {lines.map((line, index) => (
          <Text key={`${index}-${line.text}`}>
            {line.beforeCursor}
            {line.cursor ? <Text inverse>{line.cursor}</Text> : null}
            {line.afterCursor}
          </Text>
        ))}
      </Box>
    );
  }

  // Sent user message: a "you ›" badge over a full-width highlight, so the
  // user's own turns stay instantly distinguishable in the scrollback. The
  // colors come from the theme so a light palette gets a light block.
  const bg = theme?.userBg ?? "#223246";
  const fg = theme?.userFg ?? "#f2f5f8";
  const pad = theme?.muted ?? "#9ba6b8";
  const lines = promptBlockLines(text, cursorOffset, lineWidth, "you › ");

  return (
    <Box flexDirection="column" width="100%">
      {lines.map((line, index) => (
        <Text key={`${index}-${line.text}`} backgroundColor={bg} color={fg} bold={index === 0}>
          {line.beforeCursor}
          {line.cursor ? (
            <Text inverse backgroundColor={bg} color={fg}>
              {line.cursor}
            </Text>
          ) : null}
          {line.afterCursor}
          <Text backgroundColor={bg} color={pad}>
            {line.pad}
          </Text>
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
