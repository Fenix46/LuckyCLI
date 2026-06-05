import { Box, Text } from "../../vendor/ink-compat.js";
import React from "react";
import type { CatalogServerSummary } from "@luckycli/core";
import type { Theme } from "../themes.js";
import type { InstalledMcpRow } from "../lib/mcp-rows.js";
import { truncateSingleLine } from "../lib/format.js";

export type McpPanelTab = "installed" | "search";

export function McpPanel({
  theme,
  width,
  tab,
  installedRows,
  selectedInstalledIndex,
  query,
  results,
  selectedSearchIndex,
  loading,
  error,
}: {
  theme: Theme;
  width: number;
  tab: McpPanelTab;
  installedRows: InstalledMcpRow[];
  selectedInstalledIndex: number;
  query: string;
  results: CatalogServerSummary[];
  selectedSearchIndex: number;
  loading: boolean;
  error: string | null;
}): React.JSX.Element {
  return (
    <Box flexDirection="column" paddingLeft={2} marginBottom={0.5} width="100%">
      <Text bold color={theme.accent}>🧩 MCP CONTROL PANEL</Text>
      <Box flexDirection="row" marginTop={0.2}>
        <Text bold color={tab === "installed" ? theme.primary : theme.muted}>
          {tab === "installed" ? "❯ " : "  "}Installed
        </Text>
        <Text color={theme.muted}>   </Text>
        <Text bold color={tab === "search" ? theme.primary : theme.muted}>
          {tab === "search" ? "❯ " : "  "}Search
        </Text>
      </Box>

      {tab === "installed" ? (
        <Box flexDirection="column" marginTop={0.4}>
          {installedRows.length === 0 ? (
            <Text color={theme.muted}>No MCP servers configured.</Text>
          ) : (
            installedRows.map((row, idx) => (
              <Box key={row.name} flexDirection="row">
                <Text color={idx === selectedInstalledIndex ? theme.accent : "gray"}>
                  {idx === selectedInstalledIndex ? "❯ " : "  "}
                </Text>
                <Text bold color={idx === selectedInstalledIndex ? theme.primary : "white"}>
                  {row.name.padEnd(22)}
                </Text>
                <Text color={idx === selectedInstalledIndex ? "white" : theme.muted}>
                  ┃ {truncateSingleLine(row.summary, Math.max(20, width - 32))}
                </Text>
              </Box>
            ))
          )}
          <Box marginTop={0.5}>
            <Text color={theme.muted}>Enter toggle enable · d remove · r reload · Tab switch tab · Esc close</Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={0.4}>
          <Text color={theme.muted}>query: <Text color="white">{query || "(type to search official registry)"}</Text></Text>
          {loading ? (
            <Text color={theme.accent}>Searching MCP registry...</Text>
          ) : error ? (
            <Text color={theme.error}>{error}</Text>
          ) : results.length === 0 ? (
            <Text color={theme.muted}>No search results.</Text>
          ) : (
            results.map((item, idx) => (
              <Box key={item.name} flexDirection="row">
                <Text color={idx === selectedSearchIndex ? theme.accent : "gray"}>
                  {idx === selectedSearchIndex ? "❯ " : "  "}
                </Text>
                <Text bold color={idx === selectedSearchIndex ? theme.primary : "white"}>
                  {truncateSingleLine(item.name, 28)}
                </Text>
                <Text color={idx === selectedSearchIndex ? "white" : theme.muted}>
                  ┃ {truncateSingleLine(item.title ?? item.description ?? item.version ?? "no description", Math.max(20, width - 38))}
                </Text>
              </Box>
            ))
          )}
          <Box marginTop={0.5}>
            <Text color={theme.muted}>Type to search · Enter install selected · Tab switch tab · Esc close</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
