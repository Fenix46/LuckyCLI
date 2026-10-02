import { Box, Text } from "../../vendor/ink-compat.js";
import React from "react";
import type {
  CatalogServerSummary,
  McpPromptDescriptor,
  McpResourceDescriptor,
} from "@luckycli/core";
import type { Theme } from "../themes.js";
import { KeyHints, SectionTitle, Tabs, parseHints } from "./kit.js";
import type { InstalledMcpRow } from "../lib/mcp-rows.js";
import { truncateSingleLine } from "../lib/format.js";

export type McpPanelTab = "installed" | "search";

export interface McpCapabilityDetails {
  server: string;
  prompts: McpPromptDescriptor[];
  resources: McpResourceDescriptor[];
  loading: boolean;
  error: string | null;
}

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
  capabilityDetails,
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
  capabilityDetails: McpCapabilityDetails | null;
}): React.JSX.Element {
  return (
    <Box flexDirection="column" paddingLeft={1} marginBottom={1} width="100%">
      <SectionTitle theme={theme} title="MCP servers" />
      <Box marginTop={1}>
        <Tabs
          theme={theme}
          current={tab}
          tabs={[
            { id: "installed", label: "Installed" },
            { id: "search", label: "Search" },
          ]}
        />
      </Box>

      {tab === "installed" ? (
        <Box flexDirection="column" marginTop={1}>
          {installedRows.length === 0 ? (
            <Text color={theme.muted}>No MCP servers configured.</Text>
          ) : (
            installedRows.map((row, idx) => (
              <Box key={row.name} flexDirection="row">
                <Text color={idx === selectedInstalledIndex ? theme.accent : theme.muted}>
                  {idx === selectedInstalledIndex ? "❯ " : "  "}
                </Text>
                <Text bold color={idx === selectedInstalledIndex ? theme.accent : theme.text}>
                  {row.name.padEnd(22)}
                </Text>
                <Text color={idx === selectedInstalledIndex ? theme.text : theme.muted}>
                  {truncateSingleLine(row.summary, Math.max(20, width - 32))}
                </Text>
              </Box>
            ))
          )}
          <KeyHints theme={theme} hints={parseHints("enter toggle · d remove · r reload · tab switch · esc close")} />
          {capabilityDetails ? (
            <CapabilityDetails details={capabilityDetails} theme={theme} width={width} />
          ) : null}
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.muted}>query: <Text color={theme.text}>{query || "(type to search official registry)"}</Text></Text>
          {loading ? (
            <Text color={theme.accent}>Searching MCP registry...</Text>
          ) : error ? (
            <Text color={theme.error}>{error}</Text>
          ) : results.length === 0 ? (
            <Text color={theme.muted}>No search results.</Text>
          ) : (
            results.map((item, idx) => (
              <Box key={item.name} flexDirection="row">
                <Text color={idx === selectedSearchIndex ? theme.accent : theme.muted}>
                  {idx === selectedSearchIndex ? "❯ " : "  "}
                </Text>
                <Text bold color={idx === selectedSearchIndex ? theme.accent : theme.text}>
                  {truncateSingleLine(item.name, 28)}
                </Text>
                <Text color={idx === selectedSearchIndex ? theme.text : theme.muted}>
                  {truncateSingleLine(item.title ?? item.description ?? item.version ?? "no description", Math.max(20, width - 38))}
                </Text>
              </Box>
            ))
          )}
          <KeyHints theme={theme} hints={parseHints("type to search · enter install · tab switch · esc close")} />
        </Box>
      )}
    </Box>
  );
}

function CapabilityDetails({
  details,
  theme,
  width,
}: {
  details: McpCapabilityDetails;
  theme: Theme;
  width: number;
}): React.JSX.Element {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color={theme.accent}>{details.server} capabilities</Text>
      {details.loading ? <Text color={theme.muted}>Loading capabilities...</Text> : null}
      {details.error ? <Text color={theme.error}>{details.error}</Text> : null}
      {!details.loading && !details.error ? (
        <>
          <Text color={theme.muted}>prompts: {details.prompts.length}</Text>
          {details.prompts.slice(0, 3).map((prompt) => (
            <Text key={prompt.name} color={theme.text}>
              {`  · ${truncateSingleLine(prompt.name, Math.max(16, width - 8))}`}
            </Text>
          ))}
          <Text color={theme.muted}>resources: {details.resources.length}</Text>
          {details.resources.slice(0, 3).map((resource) => (
            <Text key={resource.uri} color={theme.text}>
              {`  · ${truncateSingleLine(resource.name, Math.max(16, width - 8))}`}
            </Text>
          ))}
        </>
      ) : null}
    </Box>
  );
}
