/**
 * One-row status bar under the input frame. Left: the permission mode, so the
 * user always knows how much the agent may do on its own. Right: how full the
 * context is (a meter that warms up as it fills), session token usage and the
 * model settings. The right side truncates instead of spilling past the edge.
 */
import React from "react";
import { Box, Text } from "../../vendor/ink-compat.js";
import type { ContextStatus } from "@luckycli/core";
import type { Theme } from "../themes.js";
import { contextFooter } from "../lib/status.js";
import type { PermissionMode } from "../lib/requests.js";
import { GLYPH, Meter } from "./kit.js";

export function StatusFooter({
  theme,
  width,
  permissionMode,
  showScrollHint,
  contextStatus,
  model,
  effort,
  thinking,
  usage,
}: {
  theme: Theme;
  /** Content width (terminal width minus the root's paddingX). */
  width: number;
  permissionMode: PermissionMode;
  /** True once the transcript has scrollback worth mentioning. */
  showScrollHint: boolean;
  contextStatus: ContextStatus | null;
  /** Active model id, shown last on the right. */
  model?: string | undefined;
  effort?: string | undefined;
  thinking?: string | undefined;
  /** Session tokens (and cost, when rates are configured). */
  usage?: string | undefined;
}): React.JSX.Element {
  const ctx = contextFooter(contextStatus);
  const settings = [
    model,
    effort ? `effort ${effort}` : undefined,
    thinking ? `thinking ${thinking}` : undefined,
  ].filter(Boolean);
  return (
    <Box width={width} marginTop={1} paddingX={1} overflow="hidden">
      <Box flexDirection="row" flexShrink={0} paddingRight={3}>
        <ModeBadge theme={theme} mode={permissionMode} />
        {showScrollHint && width >= 140 ? (
          <Text color={theme.subtle}>   scroll for history</Text>
        ) : null}
      </Box>
      <Box flexGrow={1} />
      <Box flexDirection="row" flexShrink={1}>
        <Text wrap="truncate-end">
          <Text color={theme.muted}>ctx </Text>
          {ctx.percent !== undefined ? (
            <Text>
              <Meter theme={theme} percent={ctx.percent} />
              <Text> </Text>
            </Text>
          ) : null}
          <Text color={theme.muted}>{ctx.label}</Text>
          {usage ? <Text color={theme.muted}>{`   ${usage}`}</Text> : null}
          {settings.length > 0 ? (
            <Text color={theme.subtle}>{`   ${settings.join(` ${GLYPH.dot} `)}`}</Text>
          ) : null}
        </Text>
      </Box>
    </Box>
  );
}

/** "● ask first" / "● accept edits" / "● auto", with the shift+tab hint. */
function ModeBadge({ theme, mode }: { theme: Theme; mode: PermissionMode }): React.JSX.Element {
  const [label, color] =
    mode === "acceptEdits"
      ? ["accept edits on", theme.success]
      : mode === "auto"
        ? ["auto mode on", theme.warning]
        : ["ask before edits", theme.muted];
  return (
    <Text>
      <Text color={color}>{GLYPH.active} </Text>
      <Text bold={mode !== "normal"} color={mode === "normal" ? theme.muted : color}>
        {label}
      </Text>
      <Text color={theme.subtle}>  shift+tab</Text>
    </Text>
  );
}
