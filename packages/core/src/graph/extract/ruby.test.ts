import { describe, expect, it } from "vitest";
import { type GraphNode, validateGraph } from "../types.js";
import { extractorFor } from "./index.js";
import { parse } from "./parser.js";
import { rubyExtractor } from "./ruby.js";

const SAMPLE = `require "json"
require_relative "helper"

module Geometry
  class Shape
    def area
      raise NotImplementedError
    end
  end

  class Rect < Shape
    def initialize(w, h)
      @w = w
      @h = h
    end

    def area
      scaled()
    end

    def scaled
      helper(@w)
    end

    def self.unit
      Rect.new(1, 1)
    end

    def helper(v)
      v * 2
    end
  end
end

def top_level_fn
  top_helper()
end

def top_helper
  1
end
`;

async function extract(path: string, source: string) {
  const parsed = await parse("ruby", source);
  try {
    return rubyExtractor.extract({ path, source, root: parsed.root });
  } finally {
    parsed.dispose();
  }
}

function byLabel(nodes: GraphNode[], label: string) {
  return nodes.filter((n) => n.label === label);
}

describe("ruby extractor", () => {
  it("extracts a self-consistent graph", async () => {
    const { nodes, edges } = await extract("geometry.rb", SAMPLE);
    expect(validateGraph({ meta: anyMeta(), nodes, edges })).toEqual([]);
  });

  it("emits file, module, class, method and top-level function nodes", async () => {
    const { nodes } = await extract("geometry.rb", SAMPLE);
    expect(byLabel(nodes, "geometry.rb")[0]?.kind).toBe("file");
    expect(byLabel(nodes, "Geometry")[0]?.kind).toBe("module");
    expect(byLabel(nodes, "Rect")[0]?.kind).toBe("class");
    expect(byLabel(nodes, "scaled")[0]?.kind).toBe("method");
    expect(byLabel(nodes, "unit")[0]?.kind).toBe("method");
    expect(byLabel(nodes, "top_level_fn")[0]?.kind).toBe("function");
  });

  it("emits imports edges for require / require_relative", async () => {
    const { nodes, edges } = await extract("geometry.rb", SAMPLE);
    expect(byLabel(nodes, "json")[0]?.kind).toBe("module");
    expect(byLabel(nodes, "helper")[0]?.kind).toBe("module");
    const imports = edges.filter((e) => e.relation === "imports");
    expect(imports).toHaveLength(2);
    expect(imports.every((e) => e.confidence === "EXTRACTED")).toBe(true);
  });

  it("nests classes inside their module and methods inside their class", async () => {
    const { nodes, edges } = await extract("geometry.rb", SAMPLE);
    const mod = byLabel(nodes, "Geometry")[0]!;
    const classesInModule = edges
      .filter((e) => e.source === mod.id && e.relation === "defines")
      .map((e) => nodes.find((n) => n.id === e.target))
      .filter((n) => n?.kind === "class")
      .map((n) => n?.label)
      .sort();
    expect(classesInModule).toEqual(["Rect", "Shape"]);

    const rect = byLabel(nodes, "Rect")[0]!;
    const methodsInRect = edges
      .filter((e) => e.source === rect.id && e.relation === "defines")
      .map((e) => nodes.find((n) => n.id === e.target))
      .filter((n) => n?.kind === "method")
      .map((n) => n?.label)
      .sort();
    expect(methodsInRect).toEqual(["area", "helper", "initialize", "scaled", "unit"]);
  });

  it("infers same-class calls (area->scaled->helper)", async () => {
    const { nodes, edges } = await extract("geometry.rb", SAMPLE);
    const calls = edges.filter((e) => e.relation === "calls");
    const rect = byLabel(nodes, "Rect")[0]!;
    // Shape also has an `area` method; resolve method ids within Rect.
    const rectMethod = (label: string) =>
      edges
        .filter((e) => e.source === rect.id && e.relation === "defines")
        .map((e) => nodes.find((n) => n.id === e.target))
        .find((n) => n?.label === label && n?.kind === "method")!.id;
    expect(
      calls.some((e) => e.source === rectMethod("area") && e.target === rectMethod("scaled")),
    ).toBe(true);
    expect(
      calls.some((e) => e.source === rectMethod("scaled") && e.target === rectMethod("helper")),
    ).toBe(true);
    expect(calls.every((e) => e.confidence === "INFERRED")).toBe(true);
  });

  it("infers top-level function calls (top_level_fn->top_helper)", async () => {
    const { nodes, edges } = await extract("geometry.rb", SAMPLE);
    const fn = byLabel(nodes, "top_level_fn")[0]!;
    const helper = byLabel(nodes, "top_helper")[0]!;
    expect(
      edges.some(
        (e) => e.relation === "calls" && e.source === fn.id && e.target === helper.id,
      ),
    ).toBe(true);
  });

  it("emits a candidate hinted with a constant receiver for Type.m calls", async () => {
    const source = `def run
  Rect.default_area
end
`;
    const { nodes, callCandidates } = await extract("run.rb", source);
    const run = byLabel(nodes, "run")[0]!;
    expect(callCandidates).toContainEqual({
      callerId: run.id,
      calleeName: "default_area",
      receiverHint: "Rect",
    });
  });

  it("emits a candidate hinted with the variable name for obj.m calls", async () => {
    const source = `def run(r)
  r.area
end
`;
    const { nodes, callCandidates } = await extract("run.rb", source);
    const run = byLabel(nodes, "run")[0]!;
    expect(callCandidates).toContainEqual({
      callerId: run.id,
      calleeName: "area",
      receiverHint: "r",
    });
  });

  it("still resolves self.m within the scope instead of emitting a candidate", async () => {
    const source = `class Foo
  def run
    self.helper
  end

  def helper
    1
  end
end
`;
    const { nodes, edges, callCandidates } = await extract("foo.rb", source);
    const run = byLabel(nodes, "run")[0]!;
    const helper = byLabel(nodes, "helper")[0]!;
    expect(
      edges.some((e) => e.relation === "calls" && e.source === run.id && e.target === helper.id),
    ).toBe(true);
    expect(callCandidates ?? []).toHaveLength(0);
  });

  it("does not emit candidates for require or constructor calls", async () => {
    const source = `require "json"

def run
  Rect.new
end
`;
    const { callCandidates } = await extract("run.rb", source);
    expect(callCandidates ?? []).toHaveLength(0);
  });

  it("is registered for the ruby language", () => {
    expect(extractorFor("ruby")).toBe(rubyExtractor);
  });
});

function anyMeta() {
  return { version: 1 as const, root: "/x", builtAt: "now", fileCount: 1 };
}
