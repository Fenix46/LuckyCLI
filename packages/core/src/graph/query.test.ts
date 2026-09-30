import { describe, expect, it } from "vitest";
import {
  callersOf,
  calleesOf,
  godNodes,
  blastRadius,
  impactOf,
  neighborsOf,
  resolveNodes,
  suggestNodes,
  summarize,
  topModules,
} from "./query.js";
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
    {
      id: "mod_exo",
      label: "androidx.media3.exoplayer.ExoPlayer",
      kind: "module",
      sourceFile: "androidx.media3.exoplayer.ExoPlayer",
      external: true,
    },
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

  it("suggests near-miss symbols by case-insensitive substring, prefix first", () => {
    const g = emptyGraph("/repo");
    g.nodes = [
      { id: "f1", label: "loadPlaylistFromFile", kind: "method", sourceFile: "p.kt", sourceLocation: "L1" },
      { id: "f2", label: "loadPlaylistFromXtream", kind: "method", sourceFile: "p.kt", sourceLocation: "L9" },
      { id: "f3", label: "reloadPlaylist", kind: "function", sourceFile: "p.kt", sourceLocation: "L20" },
      { id: "p_kt", label: "p.kt", kind: "file", sourceFile: "p.kt" },
      { id: "mod", label: "a.b.loadPlaylist", kind: "module", sourceFile: "a.b.loadPlaylist" },
    ];
    const ids = suggestNodes(g, "loadPlaylist").map((n) => n.id);
    // prefix matches (f1, f2) rank before the mid-word match (f3); files/modules excluded.
    expect(ids).toEqual(["f1", "f2", "f3"]);
  });

  it("matches in either direction and is case-insensitive", () => {
    const g = emptyGraph("/repo");
    g.nodes = [
      { id: "f1", label: "loadPlaylistFromFile", kind: "method", sourceFile: "p.kt", sourceLocation: "L1" },
    ];
    // query is longer than the label only when the label contains it; here the
    // query is a substring of the label, case-insensitively.
    expect(suggestNodes(g, "PLAYLISTFROM").map((n) => n.id)).toEqual(["f1"]);
    expect(suggestNodes(g, "nope")).toEqual([]);
    expect(suggestNodes(g, "")).toEqual([]);
  });

  it("returns deterministic, bounded impact neighbors", () => {
    const impacts = impactOf(fixture(), "beta", 2);
    expect(impacts).toHaveLength(1);
    expect(impacts[0]?.node.label).toBe("beta");
    expect(impacts[0]?.neighbors.map((neighbor) => [neighbor.direction, neighbor.node.label])).toEqual([
      ["in", "alpha"],
      ["in", "gamma"],
    ]);
    expect(() => impactOf(fixture(), "beta", 0)).toThrow(/positive integer/);
  });

  it("caps suggestions at the requested limit", () => {
    const g = emptyGraph("/repo");
    g.nodes = Array.from({ length: 25 }, (_, i) => ({
      id: `n${i}`,
      label: `handler${String(i).padStart(2, "0")}`,
      kind: "function" as const,
      sourceFile: "h.ts",
    }));
    expect(suggestNodes(g, "handler", 5)).toHaveLength(5);
  });

  it("resolves a module by its short name (last segment of the FQN)", () => {
    const g = fixture();
    // language-agnostic: queries the short name, matches the qualified module.
    expect(resolveNodes(g, "ExoPlayer").map((n) => n.id)).toEqual(["mod_exo"]);
    expect(resolveNodes(g, "exoplayer").map((n) => n.id)).toEqual(["mod_exo"]); // case-insensitive
    // an exact label still wins over a short-name match.
    expect(resolveNodes(g, "androidx.media3.exoplayer.ExoPlayer").map((n) => n.id)).toEqual(["mod_exo"]);
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
    expect(o.nodeCount).toBe(6);
    expect(o.edgeCount).toBe(5);
    expect(o.kindCounts.function).toBe(3);
    expect(o.kindCounts.module).toBe(1); // only the non-external module is counted
    expect(o.externalNodeCount).toBe(1); // the ExoPlayer library node
    expect(o.internalNodeCount).toBe(5);
  });
});

describe("blastRadius", () => {
  function chain(): Graph {
    const g = emptyGraph("/repo");
    g.nodes = [
      { id: "core", label: "core", kind: "function", sourceFile: "core.ts", sourceLocation: "L1" },
      { id: "svc", label: "svc", kind: "function", sourceFile: "svc.ts", sourceLocation: "L1" },
      { id: "api", label: "api", kind: "function", sourceFile: "api.ts", sourceLocation: "L1" },
      { id: "cli", label: "cli", kind: "function", sourceFile: "cli.ts", sourceLocation: "L1" },
      { id: "far", label: "far", kind: "function", sourceFile: "far.ts", sourceLocation: "L1" },
      { id: "core_ts", label: "core.ts", kind: "file", sourceFile: "core.ts" },
      { id: "lib", label: "lodash", kind: "module", sourceFile: "lodash", external: true },
    ];
    g.edges = [
      { source: "svc", target: "core", relation: "calls", confidence: "EXTRACTED" },
      { source: "api", target: "svc", relation: "calls", confidence: "EXTRACTED" },
      { source: "cli", target: "api", relation: "calls", confidence: "EXTRACTED" },
      { source: "far", target: "cli", relation: "calls", confidence: "EXTRACTED" },
      { source: "core_ts", target: "core", relation: "defines", confidence: "EXTRACTED" },
      { source: "lib", target: "core", relation: "uses", confidence: "EXTRACTED" },
      { source: "api", target: "core", relation: "references", confidence: "EXTRACTED" },
    ];
    return g;
  }

  it("walks dependents breadth-first up to the depth limit, skipping containment and externals", () => {
    const radius = blastRadius(chain(), "core");
    expect(radius.dependents.map((d) => [d.node.id, d.depth])).toEqual([
      ["svc", 1],
      ["api", 1],
      ["cli", 2],
      ["far", 3],
    ]);
    expect(radius.files).toEqual(["svc.ts", "api.ts", "cli.ts", "far.ts"]);
    expect(radius.truncated).toBe(false);
  });

  it("honors the depth and node limits", () => {
    expect(blastRadius(chain(), "core", { maxDepth: 2 }).dependents.map((d) => d.node.id)).not.toContain("far");
    const cut = blastRadius(chain(), "core", { limit: 1 });
    expect(cut.dependents).toHaveLength(1);
    expect(cut.truncated).toBe(true);
  });
});
