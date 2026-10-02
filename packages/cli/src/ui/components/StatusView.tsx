import { Box, Text } from "../../vendor/ink-compat.js";
import React from "react";
import { type ContextStatus, type ProviderStatus, type TokenCostRates } from "@luckycli/core";
import type { Theme } from "../themes.js";
import { meterColor, SectionTitle } from "./kit.js";
import {
  statusDetails,
  compactStatusNotes,
  contextUsagePercent,
  contextDetail,
  quotaLabel,
  quotaUsedPercent,
  quotaResetDetail,
  totalUsageDetail,
  estimatedCostDetail,
} from "../lib/status.js";

export function StatusView({
  provider,
  context,
  costRates,
  theme,
  width,
}: {
  provider: ProviderStatus;
  context: ContextStatus;
  costRates?: TokenCostRates;
  theme: Theme;
  width: number;
}): React.JSX.Element {
  const panelWidth = Math.max(56, Math.min(width - 4, 112));
  const details = statusDetails(provider, context);
  const notes = compactStatusNotes(provider.notes ?? []);
  const contextUsage = contextUsagePercent(context);
  const cost = costRates ? estimatedCostDetail(context, costRates) : undefined;

  return (
    <Box flexDirection="column" marginTop={1} paddingLeft={1}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.subtle}
        paddingX={2}
        paddingY={1}
        width={panelWidth}
      >
        <Box marginBottom={1}>
          <SectionTitle theme={theme} title={provider.displayName} detail={provider.provider} />
        </Box>

        <Box flexDirection="column" marginBottom={1}>
          {details.map((row) => (
            <Box key={row.label} flexDirection="row">
              <Box width={15}>
                <Text color={theme.muted}>{row.label}</Text>
              </Box>
              <Text color={theme.text}>{row.value}</Text>
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

        {totalUsageDetail(context) ? (
          <Box marginTop={1}>
            <Text color={theme.muted}>Session usage: {totalUsageDetail(context)}</Text>
          </Box>
        ) : null}
        {cost ? (
          <Box>
            <Text color={theme.muted}>Estimated cost: {cost}</Text>
          </Box>
        ) : null}

        {provider.quotas?.length ? (
          <Box flexDirection="column">
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
    <Box flexDirection="column" marginTop={1}>
      <Text bold color={theme.text}>{label}</Text>
      <Box flexDirection="row">
        <Text color={meterColor(theme, safePercent)}>{"█".repeat(filled)}</Text>
        <Text color={theme.subtle}>{"░".repeat(empty)}</Text>
        <Text color={theme.text}> {unavailable ? "unknown" : `${safePercent}% used`}</Text>
        {detail ? <Text color={theme.muted}> {detail}</Text> : null}
      </Box>
    </Box>
  );
}
