import { Box, Text } from "../../vendor/ink-compat.js";
import React from "react";
import type { ContextStatus, ProviderStatus } from "@luckycli/core";
import type { Theme } from "../themes.js";
import {
  statusDetails,
  compactStatusNotes,
  contextUsagePercent,
  contextDetail,
  quotaLabel,
  quotaUsedPercent,
  quotaResetDetail,
} from "../lib/status.js";

export function StatusView({
  provider,
  context,
  theme,
  width,
}: {
  provider: ProviderStatus;
  context: ContextStatus;
  theme: Theme;
  width: number;
}): React.JSX.Element {
  const panelWidth = Math.max(56, Math.min(width - 4, 112));
  const details = statusDetails(provider, context);
  const notes = compactStatusNotes(provider.notes ?? []);
  const contextUsage = contextUsagePercent(context);

  return (
    <Box flexDirection="column" marginY={0.4} paddingLeft={1}>
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={theme.muted}
        paddingX={2}
        paddingY={1}
        width={panelWidth}
      >
        <Box flexDirection="row" marginBottom={1}>
          <Text bold color={theme.accent}>›_ </Text>
          <Text bold>{provider.displayName}</Text>
          <Text color={theme.muted}> ({provider.provider})</Text>
        </Box>

        <Box flexDirection="column" marginBottom={1}>
          {details.map((row) => (
            <Box key={row.label} flexDirection="row">
              <Box width={15}>
                <Text color={theme.muted}>{row.label}:</Text>
              </Box>
              <Text color="white">{row.value}</Text>
              {row.hint ? <Text color={theme.muted}> {row.hint}</Text> : null}
            </Box>
          ))}
        </Box>

        <UsageBar
          label="Context"
          percent={contextUsage}
          unavailable={contextUsage === undefined}
          detail={contextDetail(context)}
          theme={theme}
          width={panelWidth - 8}
        />

        {provider.quotas?.length ? (
          <Box flexDirection="column" marginTop={1}>
            {provider.quotas.map((quota, index) => (
              <UsageBar
                key={`${quota.label}-${index}`}
                label={quotaLabel(quota.label)}
                percent={quotaUsedPercent(quota)}
                detail={quotaResetDetail(quota)}
                theme={theme}
                width={panelWidth - 8}
              />
            ))}
          </Box>
        ) : (
          <Box marginTop={1}>
            <Text color={theme.muted}>Quota windows not available from this provider.</Text>
          </Box>
        )}

        {notes.length ? (
          <Box flexDirection="column" marginTop={1}>
            {notes.map((note) => (
              <Text key={note} color={theme.muted}>{note}</Text>
            ))}
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

export function UsageBar({
  label,
  percent,
  detail,
  unavailable,
  theme,
  width,
}: {
  label: string;
  percent: number | undefined;
  detail: string | undefined;
  unavailable?: boolean;
  theme: Theme;
  width: number;
}): React.JSX.Element {
  const barWidth = Math.max(18, Math.min(36, width - 25));
  const safePercent = percent === undefined ? 0 : Math.max(0, Math.min(100, percent));
  const filled = Math.round((safePercent / 100) * barWidth);
  const empty = Math.max(0, barWidth - filled);

  return (
    <Box flexDirection="column" marginTop={0.3}>
      <Text bold color="white">{label}</Text>
      <Box flexDirection="row">
        <Text color={theme.accent}>{"█".repeat(filled)}</Text>
        <Text color={theme.muted}>{"░".repeat(empty)}</Text>
        <Text color="white"> {unavailable ? "unknown" : `${safePercent}% used`}</Text>
        {detail ? <Text color={theme.muted}> {detail}</Text> : null}
      </Box>
    </Box>
  );
}
