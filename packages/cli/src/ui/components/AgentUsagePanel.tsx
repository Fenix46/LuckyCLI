import { Box, Text } from "../../vendor/ink-compat.js";
import React from "react";
import type { Theme } from "../themes.js";
import type { AgentUsageMap } from "../lib/requests.js";
import { truncateSingleLine } from "../lib/format.js";

/**
 * Live token consumption of the sub-agents spawned during this turn, anchored in
 * the bottom chrome (above the prompt). One row per profile — name, its
 * provider/model, and total tokens consumed — plus a TOTAL line. Renders nothing
 * until at least one sub-agent has run, so it adds no chrome to a normal chat.
 *
 * Phase 1 tracks tokens only (no cost in $); the panel sums input + output +
 * cache tokens, the same numbers the Agent already reports.
 */
export function AgentUsagePanel({
  usage,
  theme,
  width,
}: {
  usage: AgentUsageMap;
  theme: Theme;
  width: number;
}): React.JSX.Element | null {
  if (usage.size === 0) return null;

  const entries = [...usage.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  let total = 0;
  const rows = entries.map(([name, e]) => {
    const tokens = totalTokens(e.usage);
    total += tokens;
    return { name, model: `${e.provider}/${e.model}`, tokens };
  });

  // Reserve space for indent + token column.
  const maxLabel = Math.max(20, width - 24);

  return (
    <Box flexDirection="column" marginBottom={1} paddingLeft={2}>
      <Text color={theme.muted}>
        Sub-agents (<Text bold>{rows.length}</Text>: {formatTokens(total)} tokens)
      </Text>
      <Box flexDirection="column">
        {rows.map((row) => (
          <Box key={row.name} flexDirection="row" gap={1}>
            <Text color={theme.accent} bold>
              {truncateSingleLine(`${row.name} · ${row.model}`, maxLabel)}
            </Text>
            <Text color={theme.muted}>{formatTokens(row.tokens)} tok</Text>
          </Box>
        ))}
        <Text color={theme.muted}>
          {"  "}TOTAL {formatTokens(total)} tok
        </Text>
      </Box>
    </Box>
  );
}

function totalTokens(usage: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    (usage.cacheReadTokens ?? 0) +
    (usage.cacheWriteTokens ?? 0)
  );
}

/** Compact token count: 1234 -> "1.2k". */
function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}
