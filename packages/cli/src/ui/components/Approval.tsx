import { Box, Text } from "../../vendor/ink-compat.js";
import React from "react";
import type { Theme } from "../themes.js";
import type { ApprovalRequest } from "../lib/requests.js";
import { inputString, truncateSingleLine, wrapText } from "../lib/format.js";

export function ApprovalRequestView({
  request,
  selectedIndex,
  options,
  theme,
  width,
}: {
  request: ApprovalRequest;
  selectedIndex: number;
  options: readonly ("allow" | "always" | "deny")[];
  theme: Theme;
  width: number;
}): React.JSX.Element {
  const detail = approvalDisplay(request, width);
  const panelWidth = Math.max(48, Math.min(width, 104));
  return (
    <Box
      flexDirection="column"
      marginTop={1}
      width={panelWidth}
      borderStyle="single"
      borderColor={theme.warning}
      borderTop={false}
      borderRight={false}
      borderBottom={false}
      paddingLeft={2}
    >
      <Box flexDirection="row">
        <Text bold color={theme.warning}>Permission required</Text>
        <Text color={theme.muted}> · {request.name}</Text>
      </Box>

      <Box marginTop={1}>
        <Text bold color="white">{detail.question}</Text>
      </Box>

      {detail.target ? (
        <Box marginTop={1} flexDirection="row">
          <Text color={theme.muted}>target  </Text>
          <Text color={theme.primary}>{detail.target}</Text>
        </Box>
      ) : null}

      {detail.preview.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {detail.preview.map((line, index) => (
            <Box key={index} flexDirection="row">
              <Text color={theme.muted} dimColor>│ </Text>
              <Text color={line.color === "added" ? theme.success : line.color === "removed" ? theme.error : theme.muted}>
                {line.text}
              </Text>
            </Box>
          ))}
        </Box>
      ) : null}

      <Box flexDirection="column" marginTop={1}>
        {options.map((option, index) => (
          <ApprovalOptionView
            key={option}
            option={option}
            selected={index === selectedIndex}
            theme={theme}
          />
        ))}
      </Box>

      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>↑↓ / jk move · enter approve · esc reject</Text>
      </Box>
    </Box>
  );
}

function ApprovalOptionView({
  option,
  selected,
  theme,
}: {
  option: "allow" | "always" | "deny";
  selected: boolean;
  theme: Theme;
}): React.JSX.Element {
  const label =
    option === "allow" ? "Allow once" : option === "always" ? "Allow always" : "Reject";
  const description =
    option === "allow"
      ? "Run this tool call"
      : option === "always"
        ? "Remember this exact request for this session"
        : "Block it and continue";
  const color = option === "deny" ? theme.error : option === "always" ? theme.accent : theme.success;
  return (
    <Box flexDirection="row">
      <Text bold={selected} color={selected ? color : theme.muted}>
        {selected ? "❯ " : "  "}
        {label.padEnd(14)}
      </Text>
      <Text color={selected ? "white" : theme.muted} dimColor={!selected}>{description}</Text>
    </Box>
  );
}

interface ApprovalDisplay {
  question: string;
  target?: string;
  preview: { text: string; color?: "added" | "removed" | "muted" }[];
}

function approvalDisplay(request: ApprovalRequest, width: number): ApprovalDisplay {
  const previewWidth = Math.max(32, Math.min(width - 8, 96));
  if (request.name === "exec") {
    const command = inputString(request.input, "command");
    return {
      question: "Run this shell command?",
      preview: command ? codePreview(command, previewWidth, 5) : [],
    };
  }

  if (request.name === "edit_file") {
    const path = inputString(request.input, "path");
    const oldString = inputString(request.input, "oldString");
    const newString = inputString(request.input, "newString");
    return {
      question: "Apply this edit?",
      ...(path ? { target: path } : {}),
      preview: editPreview(oldString, newString, previewWidth),
    };
  }

  if (request.name === "write_file") {
    const path = inputString(request.input, "path");
    const content = inputString(request.input, "content");
    return {
      question: "Write this file?",
      ...(path ? { target: path } : {}),
      preview: content ? codePreview(content, previewWidth, 8) : [],
    };
  }

  return {
    question: `Run ${request.name}?`,
    preview: objectPreview(request.input, previewWidth),
  };
}

function editPreview(
  oldString: string | undefined,
  newString: string | undefined,
  width: number,
): { text: string; color?: "added" | "removed" | "muted" }[] {
  const lines: { text: string; color?: "added" | "removed" | "muted" }[] = [];
  if (oldString) {
    lines.push({ text: "Remove:", color: "muted" });
    lines.push(...codePreview(oldString, width - 2, 5, "- ", "removed"));
  }
  if (newString) {
    if (lines.length > 0) lines.push({ text: "", color: "muted" });
    lines.push({ text: "Add:", color: "muted" });
    lines.push(...codePreview(newString, width - 2, 5, "+ ", "added"));
  }
  return lines.length > 0 ? lines : [{ text: "No preview available", color: "muted" }];
}

function codePreview(
  value: string,
  width: number,
  maxLines: number,
  prefix = "  ",
  color: "added" | "removed" | "muted" = "muted",
): { text: string; color?: "added" | "removed" | "muted" }[] {
  const normalized = value.replace(/\t/g, "  ");
  const rawLines = normalized.split("\n");
  const visibleLines = rawLines.slice(0, maxLines);
  const lines = visibleLines.flatMap((line) =>
    wrapText(`${prefix}${line || " "}`, width).map((wrapped) => ({ text: wrapped, color })),
  );
  if (rawLines.length > maxLines) {
    lines.push({ text: `${prefix}… ${rawLines.length - maxLines} more lines`, color: "muted" });
  }
  return lines;
}

function objectPreview(
  input: unknown,
  width: number,
): { text: string; color?: "added" | "removed" | "muted" }[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return [];
  }
  return Object.entries(input as Record<string, unknown>)
    .slice(0, 8)
    .map(([key, value]) => {
      const rendered =
        typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
      return {
        text: `  ${key}: ${truncateSingleLine(rendered, width - key.length - 4)}`,
        color: "muted" as const,
      };
    });
}
