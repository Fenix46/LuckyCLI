/**
 * Render smoke tests for transcript rows: finished shell commands show their
 * duration and the tail of their output; turn recaps and queued prompts
 * render as single muted lines.
 */
import React from "react";
import { describe, expect, it } from "vitest";
import { renderToScreen, scanPositions } from "../../vendor/ink/render-to-screen.js";
import { THEMES, type Theme } from "../themes.js";
import { ItemView } from "./Transcript.js";
import { QueuedPromptsView } from "./QueuedPrompts.js";

const theme = THEMES[0] as Theme;

describe("tool rows", () => {
  it("shows a finished command with its duration and output tail", () => {
    const { screen } = renderToScreen(
      <ItemView
        item={{
          kind: "tool",
          id: "c1",
          name: "exec",
          input: { command: "npm test" },
          output: ["> vitest run", "a", "b", "c", "d", "e", "Tests 12 passed"].join("\n"),
          durationMs: 1400,
        }}
        theme={theme}
        width={80}
      />,
      80,
    );
    expect(scanPositions(screen, "Ran npm test")).toHaveLength(1);
    expect(scanPositions(screen, "1.4s")).toHaveLength(1);
    expect(scanPositions(screen, "> vitest run")).toHaveLength(1);
    expect(scanPositions(screen, "… 2 more lines")).toHaveLength(1);
    expect(scanPositions(screen, "Tests 12 passed")).toHaveLength(1);
  });
});

describe("turn recap", () => {
  it("renders the summary text", () => {
    const { screen } = renderToScreen(
      <ItemView item={{ kind: "turnSummary", text: "✓ done in 12s · 4 tools" }} theme={theme} width={80} />,
      80,
    );
    expect(scanPositions(screen, "done in 12s · 4 tools")).toHaveLength(1);
  });
});

describe("QueuedPromptsView", () => {
  it("lists the next prompts and counts the rest", () => {
    const prompts = ["one", "two", "three", "four"].map((text) => ({ text, content: text }));
    const { screen } = renderToScreen(<QueuedPromptsView prompts={prompts} theme={theme} width={100} />, 100);
    expect(scanPositions(screen, "queued (4)")).toHaveLength(1);
    expect(scanPositions(screen, "1. one")).toHaveLength(1);
    expect(scanPositions(screen, "3. three")).toHaveLength(1);
    expect(scanPositions(screen, "+1 more")).toHaveLength(1);
  });
});
