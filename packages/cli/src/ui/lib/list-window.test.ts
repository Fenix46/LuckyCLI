import { describe, expect, it } from "vitest";
import { listWindow } from "./list-window.js";

describe("listWindow", () => {
  it("shows everything when the list fits", () => {
    expect(listWindow(5, 3, 8)).toEqual({ start: 0, end: 5, above: 0, below: 0 });
  });

  it("pins to the top while the selection is near the start", () => {
    expect(listWindow(20, 1, 8)).toEqual({ start: 0, end: 8, above: 0, below: 12 });
  });

  it("centers the selection in the middle of the list", () => {
    expect(listWindow(20, 10, 8)).toEqual({ start: 6, end: 14, above: 6, below: 6 });
  });

  it("pins to the bottom at the end of the list", () => {
    expect(listWindow(20, 19, 8)).toEqual({ start: 12, end: 20, above: 12, below: 0 });
  });

  it("clamps an out-of-range selection", () => {
    expect(listWindow(20, 99, 8)).toEqual({ start: 12, end: 20, above: 12, below: 0 });
  });
});
