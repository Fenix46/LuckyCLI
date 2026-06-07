import { Box, Text } from "../../vendor/ink-compat.js";
import React from "react";
import type { AgentProfile, ProviderId } from "@luckycli/core";
import type { Theme } from "../themes.js";
import { truncateSingleLine } from "../lib/format.js";

/** Which view the /agents panel is showing. */
export type AgentsPanelView = "list" | "edit";

/** A profile being created or edited (model/provider chosen from the catalog). */
export interface AgentDraft {
  /** Original name when editing an existing profile; null when creating. */
  original: string | null;
  name: string;
  description: string;
  provider: ProviderId;
  model: string;
}

/** The four editable fields, in cursor order. */
export type AgentDraftField = "name" | "description" | "provider" | "model";
export const AGENT_DRAFT_FIELDS: AgentDraftField[] = [
  "name",
  "description",
  "provider",
  "model",
];

export function AgentsPanel({
  theme,
  width,
  view,
  profiles,
  selectedIndex,
  draft,
  fieldIndex,
  loggedInProviders,
  error,
}: {
  theme: Theme;
  width: number;
  view: AgentsPanelView;
  profiles: AgentProfile[];
  selectedIndex: number;
  draft: AgentDraft | null;
  fieldIndex: number;
  /** Providers the user has credentials for; others are shown but flagged. */
  loggedInProviders: Set<ProviderId>;
  error: string | null;
}): React.JSX.Element {
  const maxLabel = Math.max(24, width - 28);
  return (
    <Box flexDirection="column" paddingLeft={2} marginBottom={1} width="100%">
      <Text bold color={theme.accent}>
        🤖 SUB-AGENTS
      </Text>

      {view === "list" ? (
        <ListView
          theme={theme}
          profiles={profiles}
          selectedIndex={selectedIndex}
          loggedInProviders={loggedInProviders}
          maxLabel={maxLabel}
        />
      ) : draft ? (
        <EditView
          theme={theme}
          draft={draft}
          fieldIndex={fieldIndex}
          loggedInProviders={loggedInProviders}
        />
      ) : null}

      {error ? (
        <Box marginTop={1}>
          <Text color={theme.error ?? "red"}>{error}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function ListView({
  theme,
  profiles,
  selectedIndex,
  loggedInProviders,
  maxLabel,
}: {
  theme: Theme;
  profiles: AgentProfile[];
  selectedIndex: number;
  loggedInProviders: Set<ProviderId>;
  maxLabel: number;
}): React.JSX.Element {
  return (
    <Box flexDirection="column" marginTop={1}>
      {profiles.length === 0 ? (
        <Text color={theme.muted}>No sub-agents yet. Press [n] to create one.</Text>
      ) : (
        profiles.map((p, idx) => {
          const active = idx === selectedIndex;
          const offline = !loggedInProviders.has(p.provider);
          return (
            <Box key={p.name} flexDirection="row" gap={1}>
              <Text color={active ? theme.accent : theme.muted}>
                {active ? "❯" : " "}
              </Text>
              <Text bold={active} color={active ? theme.accent : "white"}>
                {truncateSingleLine(p.name, 16)}
              </Text>
              <Text color={theme.muted}>
                {truncateSingleLine(`${p.provider}/${p.model}`, maxLabel)}
              </Text>
              {offline ? (
                <Text color={theme.error ?? "red"}>(not logged in)</Text>
              ) : null}
            </Box>
          );
        })
      )}
      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>
          ↑↓ move · [n] new · [e] edit · [d] delete · esc close
        </Text>
      </Box>
    </Box>
  );
}

function EditView({
  theme,
  draft,
  fieldIndex,
  loggedInProviders,
}: {
  theme: Theme;
  draft: AgentDraft;
  fieldIndex: number;
  loggedInProviders: Set<ProviderId>;
}): React.JSX.Element {
  const offline = !loggedInProviders.has(draft.provider);
  const rows: { field: AgentDraftField; label: string; value: string; warn?: boolean }[] = [
    { field: "name", label: "Name", value: draft.name || "(type a name)" },
    {
      field: "description",
      label: "Description",
      value: draft.description || "(type a description)",
    },
    { field: "provider", label: "Provider", value: draft.provider, warn: offline },
    { field: "model", label: "Model", value: draft.model },
  ];
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.muted}>
        {draft.original ? `Editing "${draft.original}"` : "New sub-agent"}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {rows.map((row, idx) => {
          const active = idx === fieldIndex;
          return (
            <Box key={row.field} flexDirection="row" gap={1}>
              <Text color={active ? theme.accent : theme.muted}>
                {active ? "❯" : " "}
              </Text>
              <Text color={theme.muted}>{row.label.padEnd(12)}</Text>
              <Text bold={active} color={row.warn ? theme.error ?? "red" : active ? theme.accent : "white"}>
                {row.value}
                {row.warn ? "  (not logged in)" : ""}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>
          ↑↓ field · name/description: type · provider/model: ←→ to cycle · enter save · esc cancel
        </Text>
      </Box>
    </Box>
  );
}
