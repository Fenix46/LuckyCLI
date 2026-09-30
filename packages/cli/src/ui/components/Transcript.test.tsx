/**
 * Render smoke tests for transcript rows: finished shell commands show their
 * duration and the tail of their output; turn recaps and queued prompts
 * render as single muted lines.
 */
import React from "react";
import { describe, expect, it } from "vitest";
import { renderToScreen, scanPositions } from "../../vendor/ink/render-to-screen.js";
import { THEMES, type Theme } from "../themes.js";
import { ItemView, TranscriptList } from "./Transcript.js";
import { ActivityIndicator } from "./ActivityIndicator.js";
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

describe("reply layout", () => {
  it("shows the lucky header once per reply, not after its own tool rows", () => {
    const { screen } = renderToScreen(
      <TranscriptList
        items={[
          { kind: "user", text: "go" },
          { kind: "assistant", text: "Looking around." },
          { kind: "tool", name: "list_dir", input: { path: "." }, output: "a\nb" },
          { kind: "assistant", text: "All done." },
        ]}
        width={80}
        theme={theme}
        provider="openai"
        model="gpt-4o"
      />,
      80,
    );
    expect(scanPositions(screen, "lucky ›")).toHaveLength(1);
    expect(scanPositions(screen, "All done.")).toHaveLength(1);
  });

  it("renders an interruption as a notice, not an error", () => {
    const { screen } = renderToScreen(
      <ItemView item={{ kind: "notice", text: "Interrupted · tell lucky what to do instead" }} theme={theme} width={80} />,
      80,
    );
    expect(scanPositions(screen, "✕ Interrupted")).toHaveLength(1);
    expect(scanPositions(screen, "error")).toHaveLength(0);
  });
});

describe("ActivityIndicator", () => {
  it("shows what is running and how to interrupt", () => {
    const { screen } = renderToScreen(
      <ActivityIndicator theme={theme} elapsedSeconds={12} frame={0} phase="working" detail="Run npm test" width={90} />,
      90,
    );
    expect(scanPositions(screen, "working")).toHaveLength(1);
    expect(scanPositions(screen, "Run npm test")).toHaveLength(1);
    expect(scanPositions(screen, "12s")).toHaveLength(1);
    expect(scanPositions(screen, "esc to interrupt")).toHaveLength(1);
  });
});
