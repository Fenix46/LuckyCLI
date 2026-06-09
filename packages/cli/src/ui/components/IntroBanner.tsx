import { Box, Text } from "../../vendor/ink-compat.js";
import os from "node:os";
import React from "react";
import { PROVIDER_CATALOG, type ProviderId } from "@luckycli/core";
import type { Theme } from "../themes.js";
import { firstName, prettyCwd } from "../lib/format.js";
import { APP_VERSION, LOGO, LOGO_WIDTH } from "./constants.js";

/**
 * The opening banner shown on a fresh session: the LUCKY wordmark with a
 * vertical color gradient, followed by a compact session summary. On narrow
 * terminals (where the wordmark would wrap and shred) it degrades to a
 * one-line header carrying the same information.
 */
export function IntroBanner({
  theme,
  provider,
  model,
  width,
}: {
  theme: Theme;
  provider: ProviderId;
  model: string;
  /** Available content width — caps the card so it never overflows the
   *  terminal edge, and selects the compact layout when the wordmark
   *  wouldn't fit. */
  width?: number;
}): React.JSX.Element {
  const name = firstName(os.userInfo().username);
  const providerName = PROVIDER_CATALOG[provider].displayName;
  const cwd = prettyCwd(process.cwd());
  // Border + paddingX consume 6 columns around the content.
  const compact = width !== undefined && width < LOGO_WIDTH + 6;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.accent}
      paddingX={2}
      paddingY={1}
      flexShrink={1}
      {...(width ? { width: Math.min(width, 100) } : {})}
    >
      {compact ? (
        <Text bold color={theme.primary}>
          ☘ LuckyCLI <Text color={theme.muted}>v{APP_VERSION}</Text>
        </Text>
      ) : (
        <Box flexDirection="column">
          {LOGO.map((line, i) => (
            <Text key={i} color={gradientColor(theme, i, LOGO.length)}>
              {line}
            </Text>
          ))}
          <Text color={theme.muted}>
            ☘ v{APP_VERSION} · multi-provider terminal agent
          </Text>
        </Box>
      )}

      <Box flexDirection="column" marginTop={1}>
        <Text bold>Welcome back, {name}</Text>
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.muted}>
            {"model "}
            <Text color={theme.primary}>
              {providerName} · {model}
            </Text>
          </Text>
          <Text color={theme.muted}>
            {"cwd   "}
            <Text color={theme.primary}>{cwd}</Text>
          </Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color={theme.muted}>
          / commands · shift+tab permissions · esc interrupt
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Per-line tint for the wordmark: a linear blend from primary to accent.
 * Falls back to primary when a theme uses named ANSI colors (not blendable).
 */
function gradientColor(theme: Theme, index: number, total: number): string {
  const from = parseHex(theme.primary);
  const to = parseHex(theme.accent);
  if (!from || !to) return theme.primary;
  const t = total <= 1 ? 0 : index / (total - 1);
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  return (
    "#" +
    [mix(from[0], to[0]), mix(from[1], to[1]), mix(from[2], to[2])]
      .map((c) => c.toString(16).padStart(2, "0"))
      .join("")
  );
}

function parseHex(color: string): [number, number, number] | undefined {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return undefined;
  const v = parseInt(m[1]!, 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}
