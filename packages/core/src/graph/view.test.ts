import { describe, expect, it } from "vitest";
import { renderGraphHtml } from "./view.js";
import { type Graph, emptyGraph } from "./types.js";

function fixture(): Graph {
  const g = emptyGraph("/repo");
  g.meta.fileCount = 1;
  g.meta.builtAt = "2026-06-07T00:00:00.000Z";
  g.nodes = [
    { id: "a_ts", label: "a.ts", kind: "file", sourceFile: "a.ts" },
    { id: "alpha", label: "alpha", kind: "function", sourceFile: "a.ts", sourceLocation: "L1" },
    { id: "beta", label: "beta", kind: "function", sourceFile: "a.ts", sourceLocation: "L5" },
    { id: "mod_react", label: "react", kind: "module", sourceFile: "react", external: true },
  ];
  g.edges = [
    { source: "a_ts", target: "alpha", relation: "defines", confidence: "EXTRACTED" },
    { source: "a_ts", target: "beta", relation: "defines", confidence: "EXTRACTED" },
    { source: "a_ts", target: "mod_react", relation: "imports", confidence: "EXTRACTED" },
    { source: "alpha", target: "beta", relation: "calls", confidence: "INFERRED" },
  ];
  return g;
}

describe("renderGraphHtml", () => {
  it("produces a self-contained HTML document with the vis-network script", () => {
    const html = renderGraphHtml(fixture());
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("vis-network");
    expect(html).toContain("new vis.Network");
  });

  it("embeds every node and edge as data", () => {
    const html = renderGraphHtml(fixture());
    for (const id of ["a_ts", "alpha", "beta", "mod_react"]) {
      expect(html).toContain(`"id":"${id}"`);
    }
    // an edge endpoint pair shows up in the embedded edge data
    expect(html).toContain(`"from":"alpha","to":"beta"`);
    // relation is carried as the edge label
    expect(html).toContain(`"label":"calls"`);
  });

  it("marks external nodes with dashed borders and dims them", () => {
    const html = renderGraphHtml(fixture());
    // external node carries the dashed border-style marker
    expect(html).toContain("borderDashes");
    // internal nodes don't get the dashed treatment for their own fill colour
    const reactIdx = html.indexOf('"id":"mod_react"');
    expect(reactIdx).toBeGreaterThan(-1);
  });

  it("renders the overview numbers from summarize()", () => {
    const html = renderGraphHtml(fixture());
    // 4 nodes total, 1 external → 3 internal, 4 edges, 1 file
    expect(html).toContain(">4<"); // node and edge counts both 4
    expect(html).toContain(">3<"); // internal node count
    expect(html).toContain(">1<"); // external + file counts
    expect(html).toContain("built 2026-06-07T00:00:00.000Z");
  });

  it("escapes HTML in the project root path", () => {
    const g = fixture();
    g.meta.root = "/repo/<script>";
    const html = renderGraphHtml(g);
    expect(html).toContain("/repo/&lt;script&gt;");
    expect(html).not.toContain("/repo/<script>");
  });
});
