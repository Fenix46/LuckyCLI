import { describe, expect, it } from "vitest";
import { type GraphNode, validateGraph } from "../types.js";
import { extractorFor } from "./index.js";
import { parse } from "./parser.js";
import { pythonExtractor } from "./python.js";

const SAMPLE = `import os
from pathlib import Path
from .utils import helper as h

def alpha(x):
    return beta(x)

def beta(y):
    return h(y)

class Widget:
    def render(self):
        return alpha(1)
`;

async function extract(path: string, source: string) {
  const parsed = await parse("python", source);
  try {
    return pythonExtractor.extract({ path, source, root: parsed.root });
  } finally {
    parsed.dispose();
  }
}

function byLabel(nodes: GraphNode[], label: string) {
  return nodes.find((n) => n.label === label);
}

describe("python extractor", () => {
  it("extracts a self-consistent graph", async () => {
    const { nodes, edges } = await extract("pkg/sample.py", SAMPLE);
    expect(validateGraph({ meta: anyMeta(), nodes, edges })).toEqual([]);
  });

  it("emits file, function, class and method nodes", async () => {
    const { nodes } = await extract("pkg/sample.py", SAMPLE);
    expect(byLabel(nodes, "sample.py")?.kind).toBe("file");
    expect(byLabel(nodes, "alpha")?.kind).toBe("function");
    expect(byLabel(nodes, "Widget")?.kind).toBe("class");
    expect(byLabel(nodes, "render")?.kind).toBe("method");
    expect(byLabel(nodes, "alpha")?.sourceLocation).toBe("L5");
  });

  it("emits imports edges for import and from-import (module name only)", async () => {
    const { nodes, edges } = await extract("pkg/sample.py", SAMPLE);
    expect(byLabel(nodes, "os")?.kind).toBe("module");
    expect(byLabel(nodes, "pathlib")?.kind).toBe("module");
    expect(byLabel(nodes, ".utils")?.kind).toBe("module");
    const imports = edges.filter((e) => e.relation === "imports");
    expect(imports).toHaveLength(3);
    expect(imports.every((e) => e.confidence === "EXTRACTED")).toBe(true);
  });

  it("defines methods under their class, functions under the file", async () => {
    const { nodes, edges } = await extract("pkg/sample.py", SAMPLE);
    const file = byLabel(nodes, "sample.py")!;
    const widget = byLabel(nodes, "Widget")!;
    const render = byLabel(nodes, "render")!;
    const alpha = byLabel(nodes, "alpha")!;
    expect(
      edges.some((e) => e.source === widget.id && e.target === render.id && e.relation === "defines"),
    ).toBe(true);
    expect(
      edges.some((e) => e.source === file.id && e.target === alpha.id && e.relation === "defines"),
    ).toBe(true);
    // render's id is class-qualified, distinct from a hypothetical top-level "render"
    expect(render.id).not.toBe(alpha.id);
  });

  it("infers intra-file calls and ignores calls to imported names", async () => {
    const { nodes, edges } = await extract("pkg/sample.py", SAMPLE);
    const calls = edges.filter((e) => e.relation === "calls");
    const alpha = byLabel(nodes, "alpha")!;
    const beta = byLabel(nodes, "beta")!;
    const render = byLabel(nodes, "render")!;
    expect(calls.every((e) => e.confidence === "INFERRED")).toBe(true);
    expect(calls.some((e) => e.source === alpha.id && e.target === beta.id)).toBe(true);
    expect(calls.some((e) => e.source === render.id && e.target === alpha.id)).toBe(true);
    // beta calls h(), but h is imported, not a local symbol → no edge
    expect(calls.some((e) => e.source === beta.id)).toBe(false);
  });

  it("is registered for the python language", () => {
    expect(extractorFor("python")).toBe(pythonExtractor);
  });
});

function anyMeta() {
  return { version: 1 as const, root: "/x", builtAt: "now", fileCount: 1 };
}
