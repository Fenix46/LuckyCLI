import { Box, Text } from "../../vendor/ink-compat.js";
import os from "node:os";
import React from "react";
import { PROVIDER_CATALOG, type ProviderId } from "@luckycli/core";
import type { Theme } from "../themes.js";
import { firstName, prettyCwd } from "../lib/format.js";
import { APP_VERSION, MASCOT } from "./constants.js";

/**
 * The opening banner shown on a fresh session — a bordered welcome card with a
 * mascot and provider info on the left, and a tips / what's-new panel on the
 * right, in the spirit of Claude Code's startup box.
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
  /** Available content width — caps the bordered card so it can never grow
   *  past the terminal edge (the box otherwise sizes to its intrinsic
   *  side-by-side content width and overflows right at any terminal size). */
  width?: number;
}): React.JSX.Element {
  const name = firstName(os.userInfo().username);
  const providerName = PROVIDER_CATALOG[provider].displayName;
  const cwd = prettyCwd(process.cwd());

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
      <Box marginBottom={1}>
        <Text bold color={theme.primary}>
          LuckyCLI{" "}
        </Text>
        <Text color={theme.muted}>v{APP_VERSION}</Text>
      </Box>

      <Box flexDirection="row">
        {/* Left: greeting + mascot + context */}
        <Box flexDirection="column" marginRight={3}>
          <Text bold color={theme.success}>
            Welcome back {name}!
          </Text>
          <Box flexDirection="column" marginY={1}>
            {MASCOT.map((line, i) => (
              <Text key={i} color={theme.success}>
                {line}
              </Text>
            ))}
          </Box>
          <Text color={theme.muted}>
            {providerName} · {model}
          </Text>
          <Text color={theme.muted}>multi-provider terminal agent</Text>
          <Text color={theme.muted}>{cwd}</Text>
        </Box>

        {/* Right: tips + what's new, divided by a vertical rule */}
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={theme.muted}
          borderTop={false}
          borderRight={false}
          borderBottom={false}
          paddingLeft={3}
        >
          <Text bold color={theme.warning}>
            Tips for getting started
          </Text>
          <Text color={theme.muted}>Type / to open the command directory</Text>
          <Text color={theme.muted}>Run /model to switch model</Text>
          <Text color={theme.muted}>Run /status to check your provider</Text>
          <Text color={theme.muted}>Run /mcp to inspect MCP servers</Text>

          <Box marginTop={1}>
            <Text bold color={theme.warning}>
              What's new
            </Text>
          </Box>
          <Text color={theme.muted}>Resume sessions with --continue / --resume</Text>
          <Text color={theme.muted}>Single-binary install · no Node required</Text>
        </Box>
      </Box>
    </Box>
  );
}
