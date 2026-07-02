/**
 * One-row status bar under the input frame, extracted from App.tsx's render
 * (the deferred follow-up in APP_REFACTOR_PLAN.md). Left side keeps its
 * natural width (permission-mode hint); a flexGrow spacer pushes the right
 * side (scroll hint + context/effort readout) to the edge, truncating instead
 * of spilling past the terminal — matches Claude Code's footer shape.
 */
import React from "react";
import { Box, Text } from "../../vendor/ink-compat.js";
import type { ContextStatus } from "@luckycli/core";
import type { Theme } from "../themes.js";
import { formatStatusFooter } from "../lib/status.js";
import type { PermissionMode } from "../lib/requests.js";

export function StatusFooter({
  theme,
  width,
  permissionMode,
  showScrollHint,
  contextStatus,
  effort,
  thinking,
}: {
  theme: Theme;
  /** Content width (terminal width minus the root's paddingX). */
  width: number;
  permissionMode: PermissionMode;
  /** True once the transcript has scrollback worth mentioning. */
  showScrollHint: boolean;
  contextStatus: ContextStatus | null;
  effort?: string | undefined;
  thinking?: string | undefined;
}): React.JSX.Element {
  return (
    <Box width={width} marginTop={1} overflow="hidden">
      <Box flexDirection="row" gap={1} flexShrink={0}>
        {permissionMode === "acceptEdits" ? (
          <Text color={theme.success} bold>
            ⏵⏵ accept edits on{" "}
            <Text color={theme.muted} dimColor>
              (shift+tab to cycle)
            </Text>
          </Text>
        ) : (
          <Text color={theme.muted} dimColor>
            shift+tab: accept edits
          </Text>
        )}
      </Box>
      <Box flexGrow={1} />
      <Box flexDirection="row" gap={1} flexShrink={1}>
        {showScrollHint ? (
          <Text color={theme.muted} dimColor wrap="truncate">
            scroll to view history{"  "}
          </Text>
        ) : null}
        <Text color={theme.muted} dimColor wrap="truncate">
          {formatStatusFooter(contextStatus, {
            ...(effort ? { effort } : {}),
            ...(thinking ? { thinking } : {}),
          })}
        </Text>
      </Box>
    </Box>
  );
}
