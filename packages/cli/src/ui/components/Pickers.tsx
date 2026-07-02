/**
 * Bottom-chrome picker overlays (effort, model, theme), extracted from
 * App.tsx's render (the deferred follow-up in APP_REFACTOR_PLAN.md). All three
 * share the same list shape: ❯ marks the cursor, ★ marks the active value,
 * and a PickerHint footer explains the keys. State (selected index, open/close)
 * stays in App — these are pure render components.
 */
import React from "react";
import { Box, Text } from "../../vendor/ink-compat.js";
import { PROVIDER_CATALOG, antigravityModelLabel, type ProviderId } from "@luckycli/core";
import type { Theme } from "../themes.js";
import { PickerHint } from "./PickerHint.js";

function PickerFrame(props: React.PropsWithChildren<{ theme: Theme }>): React.JSX.Element {
  return (
    <Box flexDirection="column" paddingLeft={2} marginBottom={1} width="100%">
      {props.children}
      <PickerHint theme={props.theme} />
    </Box>
  );
}

export function EffortPickerView({
  theme,
  model,
  levels,
  selectedIndex,
}: {
  theme: Theme;
  model: string;
  levels: string[];
  selectedIndex: number;
}): React.JSX.Element {
  return (
    <PickerFrame theme={theme}>
      <Text bold color={theme.accent}>
        Reasoning effort <Text color={theme.muted}>· {model}</Text>
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {levels.map((level, idx) => (
          <Box key={level} flexDirection="row">
            <Text color={idx === selectedIndex ? theme.accent : "gray"}>
              {idx === selectedIndex ? "❯ " : "  "}
            </Text>
            <Text color={idx === selectedIndex ? theme.primary : "white"}>{level}</Text>
          </Box>
        ))}
      </Box>
    </PickerFrame>
  );
}

export function ModelPickerView({
  theme,
  provider,
  activeModel,
  items,
  selectedIndex,
}: {
  theme: Theme;
  provider: ProviderId;
  activeModel: string;
  items: string[];
  selectedIndex: number;
}): React.JSX.Element {
  return (
    <PickerFrame theme={theme}>
      <Text bold color={theme.accent}>
        Select model <Text color={theme.muted}>· {PROVIDER_CATALOG[provider].displayName}</Text>
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {items.length > 0 ? (
          items.map((model, idx) => (
            <Box key={model} flexDirection="row">
              <Text color={idx === selectedIndex ? theme.accent : "gray"}>
                {idx === selectedIndex ? "❯ " : "  "}
              </Text>
              <Text
                bold={model === activeModel}
                color={idx === selectedIndex ? theme.primary : "white"}
              >
                {model === activeModel ? "★ " : "  "}
                {provider === "antigravity" ? antigravityModelLabel(model) : model}
                {provider === "antigravity" ? (
                  <Text color={theme.muted}> {" · "}{model}</Text>
                ) : null}
              </Text>
            </Box>
          ))
        ) : (
          <Text color={theme.warning}>No matching model. Type /model {"<model-id>"}.</Text>
        )}
      </Box>
    </PickerFrame>
  );
}

export function ThemePickerView({
  theme,
  items,
  selectedIndex,
}: {
  /** Active theme (also the highlight target in the list). */
  theme: Theme;
  items: Array<{ id: string; name: string }>;
  selectedIndex: number;
}): React.JSX.Element {
  return (
    <PickerFrame theme={theme}>
      <Text bold color={theme.accent}>Interface theme</Text>
      <Box flexDirection="column" marginTop={1}>
        {items.length > 0 ? (
          items.map((candidate, idx) => (
            <Box key={candidate.id} flexDirection="row">
              <Text color={idx === selectedIndex ? theme.accent : "gray"}>
                {idx === selectedIndex ? "❯ " : "  "}
              </Text>
              <Text
                bold={candidate.id === theme.id}
                color={idx === selectedIndex ? theme.primary : "white"}
              >
                {candidate.id === theme.id ? "★ " : "  "}
                {candidate.id.padEnd(12)}
              </Text>
              <Text color={idx === selectedIndex ? "white" : theme.muted}>{candidate.name}</Text>
            </Box>
          ))
        ) : (
          <Text color={theme.warning}>No matching theme. Type /theme.</Text>
        )}
      </Box>
    </PickerFrame>
  );
}
