import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type Graph,
  GRAPH_FORMAT_VERSION,
  assertValidGraph,
  emptyGraph,
  makeNodeId,
  parseGraph,
  validateGraph,
} from "./types.js";
import {
  edgesFrom,
  edgesTo,
  findNodesByLabel,
  getNode,
  graphFilePath,
  loadGraph,
  nodesInFile,
  saveGraph,
  tryLoadGraph,
} from "./store.js";

function sampleGraph(root: string): Graph {
  const graph = emptyGraph(root);
  graph.meta.fileCount = 1;
  graph.nodes = [
    { id: "src_a_ts", label: "a.ts", kind: "file", sourceFile: "src/a.ts" },
    { id: "foo", label: "foo", kind: "function", sourceFile: "src/a.ts", sourceLocation: "L1" },
    { id: "bar", label: "bar", kind: "function", sourceFile: "src/a.ts", sourceLocation: "L5" },
  ];
  graph.edges = [
    { source: "foo", target: "bar", relation: "calls", confidence: "INFERRED" },
    { source: "src_a_ts", target: "foo", relation: "defines", confidence: "EXTRACTED" },
  ];
  return graph;
}

describe("graph types", () => {
  it("normalizes node ids stably", () => {
    expect(makeNodeId("Foo Bar")).toBe("foo_bar");
    expect(makeNodeId("src/utils.ts::Foo")).toBe("src_utils_ts_foo");
    expect(makeNodeId("--Foo--")).toBe("foo");
    expect(makeNodeId("a.b.c")).toBe("a_b_c");
  });

  it("parses a well-formed graph and rejects bad shapes", () => {
    const graph = sampleGraph("/tmp/x");
    expect(parseGraph(graph)).toEqual(graph);

    expect(() => parseGraph({ nodes: [], edges: [] })).toThrow(); // missing meta
    expect(() =>
      parseGraph({
        meta: { version: GRAPH_FORMAT_VERSION, root: "/x", builtAt: "now", fileCount: 0 },
        nodes: [{ id: "a", label: "a", kind: "banana", sourceFile: "a.ts" }],
        edges: [],
      }),
    ).toThrow(); // invalid kind
    expect(() =>
      parseGraph({
        meta: { version: GRAPH_FORMAT_VERSION, root: "/x", builtAt: "now", fileCount: 0 },
        nodes: [],
        edges: [{ source: "a", target: "b", relation: "calls", confidence: "MAYBE" }],
      }),
    ).toThrow(); // invalid confidence
  });

  it("flags duplicate ids and dangling edge endpoints", () => {
    const graph = sampleGraph("/tmp/x");
    expect(validateGraph(graph)).toEqual([]);

    graph.nodes.push({ id: "foo", label: "foo2", kind: "function", sourceFile: "src/a.ts" });
    graph.edges.push({ source: "ghost", target: "foo", relation: "calls", confidence: "INFERRED" });
    const errors = validateGraph(graph);
    expect(errors.some((e) => e.includes("Duplicate node id 'foo'"))).toBe(true);
    expect(errors.some((e) => e.includes("source 'ghost'"))).toBe(true);
    expect(() => assertValidGraph(graph)).toThrow(/2 error/);
  });
});

describe("graph store", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lucky-graph-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("round-trips a graph through save/load under .lucky/graph", async () => {
    const graph = sampleGraph(root);
    const path = await saveGraph(root, graph);

    expect(path).toBe(graphFilePath(root));
    await expect(loadGraph(root)).resolves.toEqual(graph);
  });

  it("returns null when no graph exists, throws on corrupt json", async () => {
    await expect(tryLoadGraph(root)).resolves.toBeNull();

    await saveGraph(root, sampleGraph(root));
    await writeFile(graphFilePath(root), "{ not json", "utf8");
    await expect(loadGraph(root)).rejects.toThrow();
  });

  it("refuses to save a graph that fails validation", async () => {
    const graph = sampleGraph(root);
    graph.edges.push({ source: "ghost", target: "foo", relation: "calls", confidence: "INFERRED" });
    await expect(saveGraph(root, graph)).rejects.toThrow(/does not match any node id/);
  });

  it("answers basic queries", async () => {
    const graph = sampleGraph(root);
    expect(getNode(graph, "foo")?.label).toBe("foo");
    expect(getNode(graph, "missing")).toBeUndefined();
    expect(findNodesByLabel(graph, "FOO").map((n) => n.id)).toEqual(["foo"]);
    expect(nodesInFile(graph, "src/a.ts")).toHaveLength(3);
    expect(edgesFrom(graph, "foo").map((e) => e.target)).toEqual(["bar"]);
    expect(edgesTo(graph, "foo").map((e) => e.source)).toEqual(["src_a_ts"]);
  });
});
