import { Box, Text } from "../../vendor/ink-compat.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import React from "react";
import type { FileDiff } from "@luckycli/core";
import type { Theme } from "../themes.js";
import type { ApprovalRequest } from "../lib/requests.js";
import { inputString, truncateSingleLine, wrapText } from "../lib/format.js";
import { previewToolDiffs, PREVIEWABLE_TOOLS } from "../../approval-preview.js";
import { DiffView } from "./DiffView.js";

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
  const diff = usePreviewDiffs(request);
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

      {diff && diff.length > 0 ? (
        <Box marginTop={1}>
          <DiffView diffs={diff} theme={theme} width={Math.max(32, panelWidth - 6)} />
        </Box>
      ) : detail.preview.length > 0 ? (
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

/**
 * The diff of the change awaiting approval, rendered with DiffView in place of
 * the textual preview. Computed off the shared helper against the file on disk,
 * so line numbers and context match the file the tool is about to modify. It
 * resolves a frame or two after the prompt appears; until then (and for tools
 * with nothing to diff) the textual preview stands in.
 */
function usePreviewDiffs(request: ApprovalRequest): FileDiff[] | undefined {
  const [diffs, setDiffs] = React.useState<FileDiff[] | undefined>(undefined);
  React.useEffect(() => {
    if (!PREVIEWABLE_TOOLS.has(request.name)) {
      setDiffs(undefined);
      return;
    }
    let cancelled = false;
    setDiffs(undefined);
    void previewToolDiffs(request.name, request.input, async (path) => {
      try {
        return await readFile(resolve(process.cwd(), path), "utf8");
      } catch {
        return undefined;
      }
    }).then((result) => {
      if (!cancelled && result.length > 0) setDiffs(result);
    });
    return () => {
      cancelled = true;
    };
  }, [request]);
  return diffs;
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

  // The write tools get their structured diff from usePreviewDiffs; what these
  // branches carry is the wording, the target, and the textual stand-in shown
  // in the frames before that diff resolves (or if it can't be computed).
  if (request.name === "edit_file") {
    const path = inputString(request.input, "path");
    const newString = inputString(request.input, "newString") ?? "";
    return {
      question: "Apply this edit?",
      ...(path ? { target: path } : {}),
      preview: newString ? codePreview(newString, previewWidth, 8, "  ", "added") : [],
    };
  }

  if (request.name === "write_file") {
    const path = inputString(request.input, "path");
    const content = inputString(request.input, "content") ?? "";
    return {
      question: "Write this file?",
      ...(path ? { target: path } : {}),
      preview: content ? codePreview(content, previewWidth, 8, "  ", "added") : [],
    };
  }

  if (request.name === "apply_patch") {
    const patch = inputString(request.input, "patch");
    return {
      question: "Apply this patch?",
      preview: patch ? patchPreview(patch, previewWidth) : [],
    };
  }

  return {
    question: `Run ${request.name}?`,
    preview: objectPreview(request.input, previewWidth),
  };
}

/** Render raw patch text with +/- coloring (it is already a diff). */
function patchPreview(
  patch: string,
  width: number,
): { text: string; color?: "added" | "removed" | "muted" }[] {
  const lines = patch.replace(/\t/g, "  ").split("\n").slice(0, 24);
  const out = lines.map((line) => ({
    text: line.length > width ? `${line.slice(0, width - 1)}…` : line,
    color:
      line.startsWith("+") && !line.startsWith("+++")
        ? ("added" as const)
        : line.startsWith("-") && !line.startsWith("---")
          ? ("removed" as const)
          : ("muted" as const),
  }));
  const total = patch.split("\n").length;
  if (total > 24) out.push({ text: `… +${total - 24} more lines`, color: "muted" as const });
  return out;
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
