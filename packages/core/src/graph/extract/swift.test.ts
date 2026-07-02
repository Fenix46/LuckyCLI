import { describe, expect, it } from "vitest";
import { extractorFor } from "./index.js";
import { parse } from "./parser.js";
import { swiftExtractor } from "./swift.js";
import { type GraphNode, validateGraph } from "../types.js";

const SAMPLE = `import Foundation
import UIKit

protocol Shape {
    func area() -> Double
}

class Rect: Shape {
    var w: Double
    var h: Double

    init(w: Double, h: Double) {
        self.w = w
        self.h = h
    }

    func area() -> Double {
        return scaled()
    }

    private func scaled() -> Double {
        return helper(w)
    }

    private func helper(_ v: Double) -> Double {
        return v * 2
    }
}

struct Point {
    var x: Double
}

func topLevel() -> Double {
    return topHelper()
}

func topHelper() -> Double {
    return 1.0
}
`;

async function extract(path: string, source: string) {
  const parsed = await parse("swift", source);
  try {
    return swiftExtractor.extract({ path, source, root: parsed.root });
  } finally {
    parsed.dispose();
  }
}

function byLabel(nodes: GraphNode[], label: string) {
  return nodes.filter((n) => n.label === label);
}

describe("swift extractor", () => {
  it("extracts a self-consistent graph", async () => {
    const { nodes, edges } = await extract("Rect.swift", SAMPLE);
    expect(validateGraph({ meta: anyMeta(), nodes, edges })).toEqual([]);
  });

  it("emits file, protocol, class, struct, method and function nodes", async () => {
    const { nodes } = await extract("Rect.swift", SAMPLE);
    expect(byLabel(nodes, "Rect.swift")[0]?.kind).toBe("file");
    expect(byLabel(nodes, "Shape")[0]?.kind).toBe("interface");
    expect(byLabel(nodes, "Rect")[0]?.kind).toBe("class");
    expect(byLabel(nodes, "Point")[0]?.kind).toBe("class");
    expect(byLabel(nodes, "scaled")[0]?.kind).toBe("method");
    expect(byLabel(nodes, "topLevel")[0]?.kind).toBe("function");
  });

  it("emits imports edges for import declarations", async () => {
    const { nodes, edges } = await extract("Rect.swift", SAMPLE);
    expect(byLabel(nodes, "Foundation")[0]?.kind).toBe("module");
    expect(byLabel(nodes, "UIKit")[0]?.kind).toBe("module");
    const imports = edges.filter((e) => e.relation === "imports");
    expect(imports).toHaveLength(2);
    expect(imports.every((e) => e.confidence === "EXTRACTED")).toBe(true);
  });

  it("attaches methods and the initializer to their class", async () => {
    const { nodes, edges } = await extract("Rect.swift", SAMPLE);
    const rect = byLabel(nodes, "Rect")[0]!;
    const methods = edges
      .filter((e) => e.source === rect.id && e.relation === "defines")
      .map((e) => nodes.find((n) => n.id === e.target))
      .filter((n) => n?.kind === "method")
      .map((n) => n?.label)
      .sort();
    expect(methods).toEqual(["area", "helper", "init", "scaled"]);
  });

  it("infers same-class calls (area->scaled->helper)", async () => {
    const { nodes, edges } = await extract("Rect.swift", SAMPLE);
    const calls = edges.filter((e) => e.relation === "calls");
    const rect = byLabel(nodes, "Rect")[0]!;
    // Shape also declares `area`; resolve method ids within Rect.
    const id = (label: string) =>
      edges
        .filter((e) => e.source === rect.id && e.relation === "defines")
        .map((e) => nodes.find((n) => n.id === e.target))
        .find((n) => n?.label === label && n?.kind === "method")!.id;
    expect(calls.some((e) => e.source === id("area") && e.target === id("scaled"))).toBe(true);
    expect(calls.some((e) => e.source === id("scaled") && e.target === id("helper"))).toBe(true);
    expect(calls.every((e) => e.confidence === "INFERRED")).toBe(true);
  });

  it("infers top-level function calls (topLevel->topHelper)", async () => {
    const { nodes, edges } = await extract("Rect.swift", SAMPLE);
    const fn = byLabel(nodes, "topLevel")[0]!;
    const helper = byLabel(nodes, "topHelper")[0]!;
    expect(
      edges.some((e) => e.relation === "calls" && e.source === fn.id && e.target === helper.id),
    ).toBe(true);
  });

  it("emits a candidate with a type-hinted receiver for param.method() calls", async () => {
    const source = `func run(r: Rect) -> Double {
    return r.area()
}
`;
    const { nodes, callCandidates } = await extract("Run.swift", source);
    const run = byLabel(nodes, "run")[0]!;
    expect(callCandidates).toContainEqual({
      callerId: run.id,
      calleeName: "area",
      receiverHint: "Rect",
    });
  });

  it("emits a candidate with the bare identifier hint for Type.method() calls", async () => {
    const source = `func run() -> Double {
    return Rect.defaultArea()
}
`;
    const { nodes, callCandidates } = await extract("Run.swift", source);
    const run = byLabel(nodes, "run")[0]!;
    expect(callCandidates).toContainEqual({
      callerId: run.id,
      calleeName: "defaultArea",
      receiverHint: "Rect",
    });
  });

  it("still resolves self.method() within the type instead of emitting a candidate", async () => {
    const source = `class Foo {
    func run() -> Double {
        return self.helper()
    }
    func helper() -> Double {
        return 1.0
    }
}
`;
    const { nodes, edges, callCandidates } = await extract("Foo.swift", source);
    const run = byLabel(nodes, "run")[0]!;
    const helper = byLabel(nodes, "helper")[0]!;
    expect(
      edges.some((e) => e.relation === "calls" && e.source === run.id && e.target === helper.id),
    ).toBe(true);
    expect(callCandidates ?? []).toHaveLength(0);
  });

  it("is registered for the swift language", () => {
    expect(extractorFor("swift")).toBe(swiftExtractor);
  });
});

function anyMeta() {
  return { version: 1 as const, root: "/x", builtAt: "now", fileCount: 1 };
}
