import { describe, expect, it } from "vitest";
import { callersOf, calleesOf, godNodes, neighborsOf, resolveNodes, summarize, topModules } from "./query.js";
import { type Graph, emptyGraph } from "./types.js";

function fixture(): Graph {
  const g = emptyGraph("/repo");
  g.meta.fileCount = 2;
  g.nodes = [
    { id: "a_ts", label: "a.ts", kind: "file", sourceFile: "a.ts" },
    { id: "alpha", label: "alpha", kind: "function", sourceFile: "a.ts", sourceLocation: "L1" },
    { id: "beta", label: "beta", kind: "function", sourceFile: "a.ts", sourceLocation: "L5" },
    { id: "gamma", label: "gamma", kind: "function", sourceFile: "a.ts", sourceLocation: "L9" },
    { id: "mod_fs", label: "node:fs", kind: "module", sourceFile: "node:fs" },
  ];
  g.edges = [
    { source: "a_ts", target: "alpha", relation: "defines", confidence: "EXTRACTED" },
    { source: "a_ts", target: "beta", relation: "defines", confidence: "EXTRACTED" },
    { source: "a_ts", target: "mod_fs", relation: "imports", confidence: "EXTRACTED" },
    { source: "alpha", target: "beta", relation: "calls", confidence: "INFERRED" },
    { source: "gamma", target: "beta", relation: "calls", confidence: "INFERRED" },
  ];
  return g;
}

describe("graph query helpers", () => {
  it("resolves by id, then label, then file path", () => {
    const g = fixture();
    expect(resolveNodes(g, "alpha").map((n) => n.id)).toEqual(["alpha"]);
    expect(resolveNodes(g, "node:fs").map((n) => n.id)).toEqual(["mod_fs"]);
    expect(resolveNodes(g, "a.ts").map((n) => n.id)).toContain("a_ts"); // label match wins
    expect(resolveNodes(g, "missing")).toEqual([]);
  });

  it("finds callers and callees over calls edges only", () => {
    const g = fixture();
    expect(callersOf(g, "beta").map((n) => n.id).sort()).toEqual(["alpha", "gamma"]);
    expect(calleesOf(g, "alpha").map((n) => n.id)).toEqual(["beta"]);
    expect(callersOf(g, "alpha")).toEqual([]);
  });

  it("lists neighbors with direction and relation", () => {
    const g = fixture();
    const n = neighborsOf(g, "beta");
    expect(n.some((x) => x.direction === "in" && x.relation === "defines" && x.node.id === "a_ts")).toBe(true);
    expect(n.filter((x) => x.relation === "calls" && x.direction === "in")).toHaveLength(2);
  });

  it("ranks god nodes by degree, excluding files and modules", () => {
    const g = fixture();
    const top = godNodes(g, 5);
    expect(top[0]?.node.id).toBe("beta"); // 3 edges
    expect(top.every((r) => r.node.kind !== "file" && r.node.kind !== "module")).toBe(true);
  });

  it("ranks most-imported modules", () => {
    const g = fixture();
    const mods = topModules(g, 5);
    expect(mods[0]?.node.id).toBe("mod_fs");
    expect(mods[0]?.degree).toBe(1);
  });

  it("summarizes counts and kinds", () => {
    const o = summarize(fixture());
    expect(o.fileCount).toBe(2);
    expect(o.nodeCount).toBe(5);
    expect(o.edgeCount).toBe(5);
    expect(o.kindCounts.function).toBe(3);
    expect(o.kindCounts.module).toBe(1);
  });
});
