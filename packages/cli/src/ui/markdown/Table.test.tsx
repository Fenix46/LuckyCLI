import React from "react";
import { describe, expect, it } from "vitest";
import { renderToScreen, scanPositions } from "../../vendor/ink/render-to-screen.js";
import Table from "./Table.js";

describe("markdown Table", () => {
  it("renders headers, cells and borders through the vendored ink fork", () => {
    const { screen, height } = renderToScreen(
      <Table data={[{ name: "Alice", age: 30 }, { name: "Bob", age: 4 }]} />,
      40,
    );

    // 2 data rows + heading + 3 border lines + separator.
    expect(height).toBeGreaterThanOrEqual(7);
    expect(scanPositions(screen, "name").length).toBeGreaterThan(0);
    expect(scanPositions(screen, "Alice")).toHaveLength(1);
    expect(scanPositions(screen, "Bob")).toHaveLength(1);
    // Box-drawing corners come from the skeleton rows.
    expect(scanPositions(screen, "╭")).toHaveLength(1);
    expect(scanPositions(screen, "╯")).toHaveLength(1);
  });

  it("derives columns from the union of row keys when not specified", () => {
    const { screen } = renderToScreen(
      <Table data={[{ a: 1 }, { b: 2 }]} />,
      40,
    );
    expect(scanPositions(screen, "a").length).toBeGreaterThan(0);
    expect(scanPositions(screen, "b").length).toBeGreaterThan(0);
  });
});
