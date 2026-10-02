import React from "react";
import { describe, expect, it } from "vitest";
import { renderToScreen, scanPositions } from "../../vendor/ink/render-to-screen.js";
import { THEMES, type Theme } from "../themes.js";
import { Markdown } from "./Markdown.js";

const theme = THEMES[0] as Theme;
const md = `| Name | Notes |
|---|---|
| Alice | Leads the refactoring of the rendering pipeline |
| Bob | New |
`;

describe("markdown tables", () => {
  it("shows the real header names in a bordered grid", () => {
    const { screen } = renderToScreen(<Markdown text={md} theme={theme} width={80} />, 80);
    expect(scanPositions(screen, "Name")).toHaveLength(1);
    expect(scanPositions(screen, "Notes")).toHaveLength(1);
    expect(scanPositions(screen, "col_0")).toHaveLength(0);
    expect(scanPositions(screen, "╭")).toHaveLength(1);
    expect(scanPositions(screen, "Leads the refactoring of the rendering pipeline")).toHaveLength(1);
  });

  it("wraps cells inside the grid on a narrow terminal", () => {
    const { screen } = renderToScreen(<Markdown text={md} theme={theme} width={30} />, 30);
    expect(scanPositions(screen, "╭")).toHaveLength(1);
    expect(scanPositions(screen, "Leads the refactoring of the rendering pipeline")).toHaveLength(0);
    expect(scanPositions(screen, "pipeline")).toHaveLength(1);
  });

  it("stacks rows as records when the grid cannot fit", () => {
    const { screen } = renderToScreen(<Markdown text={md} theme={theme} width={14} />, 14);
    expect(scanPositions(screen, "╭")).toHaveLength(0);
    expect(scanPositions(screen, "Name")).toHaveLength(2);
    expect(scanPositions(screen, "Alice")).toHaveLength(1);
  });
});
