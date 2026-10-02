/**
 * Bottom-chrome picker overlays (effort, model, theme). All three share the
 * same list shape from the kit: ❯ marks the cursor, ● marks the active value,
 * and a key legend explains the keys. State (selected index, open/close)
 * stays in App — these are pure render components. Model and theme lists
 * scroll (ScrollList) so a long catalog never floods the screen.
 */
import React from "react";
import { Box, Text } from "../../vendor/ink-compat.js";
import { PROVIDER_CATALOG, type ProviderId } from "@luckycli/core";
import type { Theme } from "../themes.js";
import { PickerHint } from "./PickerHint.js";
import { OptionRow, SectionTitle } from "./kit.js";
import { ScrollList } from "./ScrollList.js";

function PickerFrame(
  props: React.PropsWithChildren<{ theme: Theme; title: string; detail?: string }>,
): React.JSX.Element {
  return (
    <Box flexDirection="column" paddingLeft={1} marginBottom={1} width="100%">
      <SectionTitle theme={props.theme} title={props.title} detail={props.detail} />
      <Box flexDirection="column" marginTop={1}>
        {props.children}
      </Box>
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
    <PickerFrame theme={theme} title="Reasoning effort" detail={model}>
      {levels.map((level, idx) => (
        <OptionRow key={level} theme={theme} selected={idx === selectedIndex} label={level} />
      ))}
    </PickerFrame>
  );
}

export function ModelPickerView({
  theme,
  provider,
  activeModel,
  items,
  labels = {},
  selectedIndex,
}: {
  theme: Theme;
  provider: ProviderId;
  activeModel: string;
  items: string[];
  /** Display names by model id, for providers whose ids aren't readable. */
  labels?: Record<string, string>;
  selectedIndex: number;
}): React.JSX.Element {
  return (
    <PickerFrame theme={theme} title="Select model" detail={PROVIDER_CATALOG[provider].displayName}>
      {items.length > 0 ? (
        <ScrollList
          theme={theme}
          count={items.length}
          selectedIndex={selectedIndex}
          renderRow={(idx) => {
            const model = items[idx]!;
            return (
              <OptionRow
                key={model}
                theme={theme}
                selected={idx === selectedIndex}
                active={model === activeModel}
                label={labels[model] ?? model}
                {...(labels[model] ? { detail: model } : {})}
              />
            );
          }}
        />
      ) : (
        <Text color={theme.warning}>No matching model. Type /model {"<model-id>"}.</Text>
      )}
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
    <PickerFrame theme={theme} title="Interface theme">
      {items.length > 0 ? (
        <ScrollList
          theme={theme}
          count={items.length}
          selectedIndex={selectedIndex}
          renderRow={(idx) => {
            const candidate = items[idx]!;
            return (
              <OptionRow
                key={candidate.id}
                theme={theme}
                selected={idx === selectedIndex}
                active={candidate.id === theme.id}
                label={candidate.id}
                labelWidth={16}
                detail={candidate.name}
              />
            );
          }}
        />
      ) : (
        <Text color={theme.warning}>No matching theme. Type /theme.</Text>
      )}
    </PickerFrame>
  );
}
