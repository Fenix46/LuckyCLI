import { describe, expect, it } from "vitest";
import { filterCommands, fuzzyMatch } from "./fuzzy.js";

describe("fuzzyMatch", () => {
  it("ranks exact above prefix above subsequence", () => {
    expect(fuzzyMatch("model", "model")?.score).toBe(1000);
    const prefix = fuzzyMatch("mod", "model")?.score ?? 0;
    const sub = fuzzyMatch("mdl", "model")?.score ?? 0;
    expect(prefix).toBeGreaterThan(sub);
    expect(sub).toBeGreaterThan(0);
  });

  it("returns the matched positions for highlighting", () => {
    expect(fuzzyMatch("mdl", "model")?.positions).toEqual([0, 2, 4]);
    expect(fuzzyMatch("mod", "model")?.positions).toEqual([0, 1, 2]);
  });

  it("does not match missing or out-of-order characters", () => {
    expect(fuzzyMatch("xyz", "model")).toBeNull();
    expect(fuzzyMatch("lmod", "model")).toBeNull();
  });

  it("matches everything for an empty query", () => {
    expect(fuzzyMatch("", "model")).toEqual({ score: 0, positions: [] });
  });
});

describe("filterCommands", () => {
  const entries = [
    { name: "/model" },
    { name: "/mcp" },
    { name: "/compact" },
    { name: "/skill" },
  ];

  it("filters by fuzzy match and keeps command order on ties", () => {
    expect(filterCommands(entries, "m").map((m) => m.item.name)).toEqual([
      "/mcp",
      "/model",
      "/compact",
    ]);
  });

  it("finds a subsequence", () => {
    expect(filterCommands(entries, "mdl").map((m) => m.item.name)).toEqual(["/model"]);
  });

  it("lifts recent commands to the top of the matching set", () => {
    expect(filterCommands(entries, "m", ["/compact", "/mcp"]).map((m) => m.item.name)).toEqual([
      "/compact",
      "/mcp",
      "/model",
    ]);
  });

  it("still filters recent entries out when they do not match", () => {
    expect(filterCommands(entries, "mdl", ["/skill"]).map((m) => m.item.name)).toEqual(["/model"]);
  });

  it("returns the match positions with each item", () => {
    const [model] = filterCommands(entries, "mdl");
    expect(model?.positions).toEqual([0, 2, 4]);
  });
});
