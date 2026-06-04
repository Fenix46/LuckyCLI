import { Box, Text } from "ink";
import React from "react";

export function PromptBlock({
  text,
  width,
  cursorOffset,
  active = false,
}: {
  text: string;
  width: number;
  cursorOffset?: number;
  active?: boolean;
}): React.JSX.Element {
  const lineWidth = Math.max(18, width);

  // Active = the live input line. Keep it clean: a chevron prompt and the typed
  // text, with no "you" badge and no background fill. The full highlight is
  // reserved for sent messages so they stand out in the transcript.
  if (active) {
    const lines = promptBlockLines(text, cursorOffset, lineWidth, "› ");
    return (
      <Box flexDirection="column" width="100%">
        {lines.map((line, index) => (
          <Text key={`${index}-${line.text}`} color="#f2f5f8">
            {line.beforeCursor}
            {line.cursor ? <Text inverse>{line.cursor}</Text> : null}
            {line.afterCursor}
          </Text>
        ))}
      </Box>
    );
  }

  // Sent user message: a "you ›" badge over a full-width highlight, so the
  // user's own turns stay instantly distinguishable in the scrollback.
  const bg = "#223246";
  const fg = "#f2f5f8";
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
          <Text backgroundColor={bg} color="#9ba6b8">
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

    chunks.forEach((chunk, chunkIndex) => {
      const chunkStart = lineStart + chunkIndex * available;
      const chunkEnd = chunkStart + chunk.length;
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
      const content = `${label}${chunk || " "}`;

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

function chunkPromptLine(line: string, width: number): string[] {
  if (line.length === 0) return [""];
  const chunks: string[] = [];
  for (let i = 0; i < line.length; i += width) {
    chunks.push(line.slice(i, i + width));
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
