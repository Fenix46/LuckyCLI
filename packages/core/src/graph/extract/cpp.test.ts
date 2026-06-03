import { describe, expect, it } from "vitest";
import { cppExtractor } from "./cpp.js";
import { extractorFor } from "./index.js";
import { parse } from "./parser.js";
import { type GraphNode, validateGraph } from "../types.js";

const SAMPLE = `#include <vector>
#include "shape.h"

namespace geo {

class Shape {
public:
    virtual double area() const = 0;
};

class Rect : public Shape {
public:
    double area() const override {
        return scaled();
    }
    double scaled() const;
private:
    double w_, h_;
    double helper(double v) const { return v * 2; }
};

double Rect::scaled() const {
    return helper(w_);
}

double freefn(int x) {
    return freehelper(x);
}

double freehelper(int x) {
    return x;
}

} // namespace geo
`;

async function extract(path: string, source: string) {
  const parsed = await parse("cpp", source);
  try {
    return cppExtractor.extract({ path, source, root: parsed.root });
  } finally {
    parsed.dispose();
  }
}

function byLabel(nodes: GraphNode[], label: string) {
  return nodes.filter((n) => n.label === label);
}

describe("cpp extractor", () => {
  it("extracts a self-consistent graph", async () => {
    const { nodes, edges } = await extract("shape.cpp", SAMPLE);
    expect(validateGraph({ meta: anyMeta(), nodes, edges })).toEqual([]);
  });

  it("emits file, namespace, class, method and free-function nodes", async () => {
    const { nodes } = await extract("shape.cpp", SAMPLE);
    expect(byLabel(nodes, "shape.cpp")[0]?.kind).toBe("file");
    expect(byLabel(nodes, "geo")[0]?.kind).toBe("module");
    expect(byLabel(nodes, "Shape")[0]?.kind).toBe("class");
    expect(byLabel(nodes, "Rect")[0]?.kind).toBe("class");
    expect(byLabel(nodes, "scaled")[0]?.kind).toBe("method");
    expect(byLabel(nodes, "freefn")[0]?.kind).toBe("function");
  });

  it("emits imports edges for #include (system and local)", async () => {
    const { nodes, edges } = await extract("shape.cpp", SAMPLE);
    expect(byLabel(nodes, "vector")[0]?.kind).toBe("module");
    expect(byLabel(nodes, "shape.h")[0]?.kind).toBe("module");
    const imports = edges.filter((e) => e.relation === "imports");
    expect(imports).toHaveLength(2);
    expect(imports.every((e) => e.confidence === "EXTRACTED")).toBe(true);
  });

  it("attaches members (incl. out-of-line Rect::scaled) to their class", async () => {
    const { nodes, edges } = await extract("shape.cpp", SAMPLE);
    const rect = byLabel(nodes, "Rect")[0]!;
    const methods = edges
      .filter((e) => e.source === rect.id && e.relation === "defines")
      .map((e) => nodes.find((n) => n.id === e.target))
      .filter((n) => n?.kind === "method")
      .map((n) => n?.label)
      .sort();
    expect(methods).toEqual(["area", "helper", "scaled"]);
  });

  it("infers member calls (area->scaled out-of-line ->helper)", async () => {
    const { nodes, edges } = await extract("shape.cpp", SAMPLE);
    const calls = edges.filter((e) => e.relation === "calls");
    const rect = byLabel(nodes, "Rect")[0]!;
    // Shape also has an `area`; resolve method ids within Rect.
    const id = (label: string) =>
      edges
        .filter((e) => e.source === rect.id && e.relation === "defines")
        .map((e) => nodes.find((n) => n.id === e.target))
        .find((n) => n?.label === label && n?.kind === "method")!.id;
    expect(calls.some((e) => e.source === id("area") && e.target === id("scaled"))).toBe(true);
    expect(calls.some((e) => e.source === id("scaled") && e.target === id("helper"))).toBe(true);
    expect(calls.every((e) => e.confidence === "INFERRED")).toBe(true);
  });

  it("infers free-function calls (freefn->freehelper)", async () => {
    const { nodes, edges } = await extract("shape.cpp", SAMPLE);
    const fn = byLabel(nodes, "freefn")[0]!;
    const helper = byLabel(nodes, "freehelper")[0]!;
    expect(
      edges.some((e) => e.relation === "calls" && e.source === fn.id && e.target === helper.id),
    ).toBe(true);
  });

  it("is registered for the cpp language", () => {
    expect(extractorFor("cpp")).toBe(cppExtractor);
  });
});

function anyMeta() {
  return { version: 1 as const, root: "/x", builtAt: "now", fileCount: 1 };
}
