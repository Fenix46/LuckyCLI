import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Graph, emptyGraph, saveGraph } from "../../graph/index.js";
import { graphOverviewTool, graphQueryTool } from "./graph.js";

function fixture(root: string): Graph {
  const g = emptyGraph(root);
  g.meta.fileCount = 1;
  g.nodes = [
    { id: "a_ts", label: "a.ts", kind: "file", sourceFile: "a.ts" },
    { id: "alpha", label: "alpha", kind: "function", sourceFile: "a.ts", sourceLocation: "L1" },
    { id: "beta", label: "beta", kind: "function", sourceFile: "a.ts", sourceLocation: "L5" },
    { id: "mod_fs", label: "node:fs", kind: "module", sourceFile: "node:fs", external: true },
  ];
  g.edges = [
    { source: "a_ts", target: "alpha", relation: "defines", confidence: "EXTRACTED" },
    { source: "a_ts", target: "beta", relation: "defines", confidence: "EXTRACTED" },
    { source: "a_ts", target: "mod_fs", relation: "imports", confidence: "EXTRACTED" },
    { source: "alpha", target: "beta", relation: "calls", confidence: "INFERRED" },
  ];
  return g;
}

describe("graph tools", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "lucky-graphtool-"));
    await saveGraph(cwd, fixture(cwd));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("graph_query find returns location", async () => {
    const r = await graphQueryTool.execute({ query: "alpha" }, { cwd });
    expect(r.content).toContain("alpha (function) — a.ts:L1");
  });

  it("graph_query callers/callees traverse calls edges", async () => {
    const callers = await graphQueryTool.execute({ query: "beta", relation: "callers" }, { cwd });
    expect(callers.content).toContain("alpha (function)");
    const callees = await graphQueryTool.execute({ query: "alpha", relation: "callees" }, { cwd });
    expect(callees.content).toContain("beta (function)");
  });

  it("graph_query neighbors splits project code from external libraries", async () => {
    const r = await graphQueryTool.execute({ query: "a.ts", relation: "neighbors" }, { cwd });
    // The file's own symbols are under project code.
    expect(r.content).toContain("project code");
    expect(r.content).toContain("alpha (function)");
    // The library import is grouped under external, marked, and counted.
    expect(r.content).toContain("External libraries (1)");
    expect(r.content).toContain("node:fs (external module)");
  });

  it("graph_query find resolves a library by its short name", async () => {
    // node:fs is the only module; querying "fs" should reach it.
    const r = await graphQueryTool.execute({ query: "fs" }, { cwd });
    expect(r.content).toContain("node:fs (external module)");
  });

  it("graph_query file lists symbols in a file", async () => {
    const r = await graphQueryTool.execute({ query: "a.ts", relation: "file" }, { cwd });
    expect(r.content).toContain("alpha");
    expect(r.content).toContain("beta");
  });

  it("graph_query reports unknown queries", async () => {
    const r = await graphQueryTool.execute({ query: "nope", relation: "callers" }, { cwd });
    expect(r.content).toContain('No node found for "nope"');
  });

  it("graph_overview summarizes the graph", async () => {
    const r = await graphOverviewTool.execute({}, { cwd });
    expect(r.content).toContain("1 files");
    expect(r.content).toContain("Most connected symbols");
    expect(r.content).toContain("beta (function)");
    expect(r.content).toContain("node:fs");
  });

  it("both tools handle a missing graph gracefully", async () => {
    const empty = await mkdtemp(join(tmpdir(), "lucky-nograph-"));
    try {
      const q = await graphQueryTool.execute({ query: "x" }, { cwd: empty });
      const o = await graphOverviewTool.execute({}, { cwd: empty });
      expect(q.content).toContain("lucky graph build");
      expect(o.content).toContain("lucky graph build");
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});
