import { Box, Text } from "../../vendor/ink-compat.js";
import React from "react";
import type { CatalogSkill } from "@luckycli/core";
import type { Theme } from "../themes.js";
import type { InstalledSkillRow } from "../lib/skill-rows.js";
import { truncateSingleLine } from "../lib/format.js";

export type SkillPanelTab = "installed" | "search";

/**
 * Presentational panel for /skill, mirroring McpPanel: two tabs, a selectable
 * list per tab, a footer hint line, and — on the Installed tab — a confirm line
 * for removal (the actual state lives in useSkillPanel). Pure render.
 */
export function SkillPanel({
  theme,
  width,
  tab,
  installedRows,
  selectedInstalledIndex,
  pendingRemoval,
  query,
  results,
  selectedSearchIndex,
  loading,
  error,
}: {
  theme: Theme;
  width: number;
  tab: SkillPanelTab;
  installedRows: InstalledSkillRow[];
  selectedInstalledIndex: number;
  /** Name of the skill awaiting a y/n removal confirmation, if any. */
  pendingRemoval: string | null;
  query: string;
  results: CatalogSkill[];
  selectedSearchIndex: number;
  loading: boolean;
  error: string | null;
}): React.JSX.Element {
  const selected = installedRows[selectedInstalledIndex];
  return (
    <Box flexDirection="column" paddingLeft={2} marginBottom={1} width="100%">
      <Text bold color={theme.accent}>▌ Skills</Text>
      <Box flexDirection="row" marginTop={1}>
        <Text bold color={tab === "installed" ? theme.primary : theme.muted}>
          {tab === "installed" ? "❯ " : "  "}Installed
        </Text>
        <Text color={theme.muted}>   </Text>
        <Text bold color={tab === "search" ? theme.primary : theme.muted}>
          {tab === "search" ? "❯ " : "  "}Search
        </Text>
      </Box>

      {tab === "installed" ? (
        <Box flexDirection="column" marginTop={1}>
          {installedRows.length === 0 ? (
            <Text color={theme.muted}>
              No skills installed. Switch to Search (tab) to find and install some.
            </Text>
          ) : (
            installedRows.map((row, idx) => (
              <Box key={row.name} flexDirection="row">
                <Text color={idx === selectedInstalledIndex ? theme.accent : "gray"}>
                  {idx === selectedInstalledIndex ? "❯ " : "  "}
                </Text>
                <Text color={row.enabled ? theme.primary : theme.muted}>
                  {row.enabled ? "● " : "○ "}
                </Text>
                <Text bold color={idx === selectedInstalledIndex ? theme.primary : "white"}>
                  {row.name.padEnd(22)}
                </Text>
                <Text color={idx === selectedInstalledIndex ? "white" : theme.muted}>
                  {truncateSingleLine(row.summary, Math.max(20, width - 34))}
                </Text>
              </Box>
            ))
          )}
          {selected && selected.keywords.length > 0 ? (
            <Box marginTop={1}>
              <Text color={theme.muted}>
                keywords: <Text color="white">{truncateSingleLine(selected.keywords.join(", "), Math.max(20, width - 14))}</Text>
              </Text>
            </Box>
          ) : null}
          {error ? (
            <Box marginTop={1}><Text color={theme.error}>{error}</Text></Box>
          ) : null}
          <Box marginTop={1}>
            {pendingRemoval ? (
              <Text color={theme.error}>
                remove "{pendingRemoval}" from disk? y / n
              </Text>
            ) : (
              <Text color={theme.muted} dimColor>
                enter toggle · d remove · tab switch · esc close
              </Text>
            )}
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.muted}>
            query: <Text color="white">{query || "(type to search the skill catalog)"}</Text>
          </Text>
          {loading ? (
            <Text color={theme.accent}>Searching skill catalog...</Text>
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
                  {truncateSingleLine(item.description || "no description", Math.max(20, width - 38))}
                </Text>
              </Box>
            ))
          )}
          <Box marginTop={1}>
            <Text color={theme.muted} dimColor>type to search · enter install · tab switch · esc close</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
