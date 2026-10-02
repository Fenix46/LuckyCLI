import { Box, Text } from "../../vendor/ink-compat.js";
import os from "node:os";
import React from "react";
import { PROVIDER_CATALOG, type ProviderId } from "@luckycli/core";
import type { Theme } from "../themes.js";
import { firstName, prettyCwd, truncateMiddle } from "../lib/format.js";
import { APP_VERSION } from "./constants.js";
import { GLYPH } from "./kit.js";

/** Commands worth discovering first, shown under the welcome card. */
const STARTER_TIPS: ReadonlyArray<readonly [command: string, what: string]> = [
  ["/model", "switch model"],
  ["/resume", "pick up a session"],
  ["/help", "all commands"],
];

/**
 * The opening card on a fresh session: a compact wordmark, who/where you are,
 * and a few first commands to try. It stays small on purpose so the
 * conversation, not the chrome, owns the screen.
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
  /** Available content width — caps the card so it never overflows. */
  width?: number;
}): React.JSX.Element {
  const name = firstName(os.userInfo().username);
  const providerName = PROVIDER_CATALOG[provider].displayName;
  const cardWidth = width !== undefined ? Math.min(width, 76) : 76;
  // Border + paddingX take 6 columns; keep the directory on one line.
  const cwd = truncateMiddle(prettyCwd(process.cwd()), Math.max(12, cardWidth - 8));
  const narrow = width !== undefined && width < 56;

  return (
    <Box flexDirection="column">
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.subtle}
        paddingX={2}
        paddingY={1}
        width={cardWidth}
        flexShrink={1}
      >
        <Text>
          <Text bold color={theme.primary}>{GLYPH.clover} </Text>
          <Wordmark theme={theme} text="lucky" />
          <Text color={theme.muted}>  v{APP_VERSION}</Text>
        </Text>
        <Box flexDirection="column" marginTop={1}>
          <Text bold color={theme.text}>Welcome back, {name}.</Text>
          <Text color={theme.muted} wrap="truncate-end">
            {providerName} {GLYPH.dot} <Text color={theme.accent}>{model}</Text>
          </Text>
          <Text color={theme.muted} wrap="truncate-end">{cwd}</Text>
        </Box>
      </Box>
      <Box paddingLeft={2} marginTop={1} flexDirection={narrow ? "column" : "row"} gap={narrow ? 0 : 3}>
        {STARTER_TIPS.map(([command, what]) => (
          <Text key={command}>
            <Text color={theme.accent}>{command}</Text>
            <Text color={theme.muted}> {what}</Text>
          </Text>
        ))}
      </Box>
    </Box>
  );
}

/** The product name, bold, with a primary→accent gradient across its letters. */
function Wordmark({ theme, text }: { theme: Theme; text: string }): React.JSX.Element {
  const from = parseHex(theme.primary);
  const to = parseHex(theme.accent);
  if (!from || !to) {
    return <Text bold color={theme.primary}>{text}</Text>;
  }
  return (
    <Text bold>
      {[...text].map((char, i) => (
        <Text key={i} color={blend(from, to, text.length <= 1 ? 0 : i / (text.length - 1))}>
          {char}
        </Text>
      ))}
    </Text>
  );
}

function blend(from: [number, number, number], to: [number, number, number], t: number): string {
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
