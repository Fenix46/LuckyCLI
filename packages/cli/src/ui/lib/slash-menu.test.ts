import { describe, expect, it } from "vitest";
import { clampSelection, slashMenuAction } from "./slash-menu.js";

const names = ["/mcp", "/model", "/skill"];

describe("clampSelection", () => {
  it("keeps the index inside the list", () => {
    expect(clampSelection(0, 4)).toBe(0);
    expect(clampSelection(2, 5)).toBe(1);
    expect(clampSelection(2, -3)).toBe(0);
    expect(clampSelection(3, 1)).toBe(1);
  });
});

describe("slashMenuAction", () => {
  it("moves with arrows and wraps", () => {
    expect(slashMenuAction({ input: "/m", names, selectedIndex: 0, dismissed: false, key: { downArrow: true } })).toEqual({
      type: "move",
      index: 1,
    });
    expect(slashMenuAction({ input: "/m", names, selectedIndex: 0, dismissed: false, key: { upArrow: true } })).toEqual({
      type: "move",
      index: 2,
    });
  });

  it("clamps a stale selection before acting", () => {
    expect(slashMenuAction({ input: "/m", names: ["/model"], selectedIndex: 5, dismissed: false, key: { tab: true } })).toEqual({
      type: "complete",
      name: "/model",
    });
  });

  it("completes on tab and executes on enter", () => {
    expect(slashMenuAction({ input: "/mo", names, selectedIndex: 1, dismissed: false, key: { tab: true } })).toEqual({
      type: "complete",
      name: "/model",
    });
    expect(slashMenuAction({ input: "/mo", names, selectedIndex: 1, dismissed: false, key: { return: true } })).toEqual({
      type: "execute",
      name: "/model",
    });
  });

  it("leaves an exact command to ChatInput", () => {
    expect(
      slashMenuAction({ input: "/model", names: ["/model"], selectedIndex: 0, dismissed: false, key: { return: true } }),
    ).toEqual({ type: "none" });
  });

  it("leaves a modified enter for a newline", () => {
    expect(
      slashMenuAction({
        input: "/mo",
        names,
        selectedIndex: 1,
        dismissed: false,
        key: { return: true, ctrl: true },
      }),
    ).toEqual({ type: "none" });
  });

  it("dismisses on the first esc and clears on the second", () => {
    expect(slashMenuAction({ input: "/m", names, selectedIndex: 0, dismissed: false, key: { escape: true } })).toEqual({
      type: "dismiss",
    });
    expect(slashMenuAction({ input: "/m", names, selectedIndex: 0, dismissed: true, key: { escape: true } })).toEqual({
      type: "clear",
    });
  });

  it("does nothing when the menu is dismissed or empty", () => {
    expect(slashMenuAction({ input: "/m", names, selectedIndex: 0, dismissed: true, key: { return: true } })).toEqual({
      type: "none",
    });
    expect(slashMenuAction({ input: "/mcp ", names: [], selectedIndex: 0, dismissed: false, key: { return: true } })).toEqual({
      type: "none",
    });
  });
});
