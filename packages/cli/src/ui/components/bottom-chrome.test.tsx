/**
 * Smoke tests for the bottom-chrome components extracted from App.tsx
 * (Pickers, SlashMenu, StatusFooter), rendered through the vendored ink
 * fork's renderToScreen — same pattern as markdown/Table.test.tsx.
 */
import React from "react";
import { describe, expect, it } from "vitest";
import { renderToScreen, scanPositions } from "../../vendor/ink/render-to-screen.js";
import { THEMES, type Theme } from "../themes.js";
import { EffortPickerView, ModelPickerView, ThemePickerView } from "./Pickers.js";
import { SlashMenu } from "./SlashMenu.js";
import { StatusFooter } from "./StatusFooter.js";

const theme = THEMES[0] as Theme;

describe("EffortPickerView", () => {
  it("renders the title, the model and the cursor on the selected level", () => {
    const { screen } = renderToScreen(
      <EffortPickerView theme={theme} model="gpt-5.1-codex" levels={["low", "high"]} selectedIndex={1} />,
      60,
    );
    expect(scanPositions(screen, "Reasoning effort")).toHaveLength(1);
    expect(scanPositions(screen, "gpt-5.1-codex")).toHaveLength(1);
    expect(scanPositions(screen, "❯ high")).toHaveLength(1);
  });
});

describe("ModelPickerView", () => {
  it("stars the active model and points at the selected one", () => {
    const { screen } = renderToScreen(
      <ModelPickerView
        theme={theme}
        provider="claude"
        activeModel="claude-sonnet-5"
        items={["claude-sonnet-5", "claude-opus-4-8"]}
        selectedIndex={1}
      />,
      60,
    );
    expect(scanPositions(screen, "Select model")).toHaveLength(1);
    expect(scanPositions(screen, "★ claude-sonnet-5")).toHaveLength(1);
    expect(scanPositions(screen, "❯")).toHaveLength(1);
  });

  it("shows the empty-state hint when nothing matches", () => {
    const { screen } = renderToScreen(
      <ModelPickerView theme={theme} provider="claude" activeModel="x" items={[]} selectedIndex={0} />,
      60,
    );
    expect(scanPositions(screen, "No matching model").length).toBeGreaterThan(0);
  });
});

describe("ThemePickerView", () => {
  it("lists themes with ids and names, starring the active one", () => {
    const items = THEMES.slice(0, 2).map((t) => ({ id: t.id, name: t.name }));
    const { screen } = renderToScreen(
      <ThemePickerView theme={theme} items={items} selectedIndex={0} />,
      60,
    );
    expect(scanPositions(screen, "Interface theme")).toHaveLength(1);
    expect(scanPositions(screen, `★ ${theme.id}`)).toHaveLength(1);
  });
});

describe("SlashMenu", () => {
  it("renders names and descriptions with the cursor on the selection", () => {
    const { screen } = renderToScreen(
      <SlashMenu
        theme={theme}
        commands={[
          { name: "/help", desc: "show commands" },
          { name: "/model", desc: "switch model" },
        ]}
        selectedIndex={1}
      />,
      60,
    );
    expect(scanPositions(screen, "/help")).toHaveLength(1);
    expect(scanPositions(screen, "❯ /model")).toHaveLength(1);
    expect(scanPositions(screen, "switch model")).toHaveLength(1);
  });
});

describe("StatusFooter", () => {
  it("shows the accept-edits banner when the mode is on", () => {
    const { screen } = renderToScreen(
      <StatusFooter
        theme={theme}
        width={80}
        permissionMode="acceptEdits"
        showScrollHint={false}
        contextStatus={null}
      />,
      80,
    );
    expect(scanPositions(screen, "accept edits on").length).toBeGreaterThan(0);
  });

  it("shows the cycle hint and the scroll hint otherwise", () => {
    const { screen } = renderToScreen(
      <StatusFooter
        theme={theme}
        width={80}
        permissionMode="default"
        showScrollHint={true}
        contextStatus={null}
      />,
      80,
    );
    expect(scanPositions(screen, "shift+tab: accept edits").length).toBeGreaterThan(0);
    expect(scanPositions(screen, "scroll to view history").length).toBeGreaterThan(0);
  });
});
