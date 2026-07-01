import { describe, expect, it } from "vitest";
import { cExtractor } from "./c.js";
import { extractorFor } from "./index.js";
import { parse } from "./parser.js";
import { type GraphNode, validateGraph } from "../types.js";

const SAMPLE = `#include <stdio.h>
#include "geometry.h"

struct Rect {
    double w;
    double h;
};

enum Color { RED, GREEN };

double helper(double v) {
    return v * 2;
}

double scaled(struct Rect *r) {
    return helper(r->w);
}

double area(struct Rect *r) {
    return scaled(r);
}

int main(void) {
    struct Rect r = {2, 3};
    return area(&r);
}
`;

async function extract(path: string, source: string) {
  const parsed = await parse("c", source);
  try {
    return cExtractor.extract({ path, source, root: parsed.root });
  } finally {
    parsed.dispose();
  }
}

function byLabel(nodes: GraphNode[], label: string) {
  return nodes.filter((n) => n.label === label);
}

describe("c extractor", () => {
  it("extracts a self-consistent graph", async () => {
    const { nodes, edges } = await extract("geometry.c", SAMPLE);
    expect(validateGraph({ meta: anyMeta(), nodes, edges })).toEqual([]);
  });

  it("emits file, struct/enum and function nodes", async () => {
    const { nodes } = await extract("geometry.c", SAMPLE);
    expect(byLabel(nodes, "geometry.c")[0]?.kind).toBe("file");
    expect(byLabel(nodes, "Rect")[0]?.kind).toBe("class");
    expect(byLabel(nodes, "Color")[0]?.kind).toBe("class");
    expect(byLabel(nodes, "scaled")[0]?.kind).toBe("function");
    expect(byLabel(nodes, "area")[0]?.kind).toBe("function");
  });

  it("emits imports edges for #include (system and local)", async () => {
    const { nodes, edges } = await extract("geometry.c", SAMPLE);
    expect(byLabel(nodes, "stdio.h")[0]?.kind).toBe("module");
    expect(byLabel(nodes, "geometry.h")[0]?.kind).toBe("module");
    const imports = edges.filter((e) => e.relation === "imports");
    expect(imports).toHaveLength(2);
    expect(imports.every((e) => e.confidence === "EXTRACTED")).toBe(true);
  });

  it("infers the call graph (main->area->scaled->helper)", async () => {
    const { nodes, edges } = await extract("geometry.c", SAMPLE);
    const calls = edges.filter((e) => e.relation === "calls");
    const id = (label: string) => byLabel(nodes, label)[0]!.id;
    expect(calls.some((e) => e.source === id("main") && e.target === id("area"))).toBe(true);
    expect(calls.some((e) => e.source === id("area") && e.target === id("scaled"))).toBe(true);
    expect(calls.some((e) => e.source === id("scaled") && e.target === id("helper"))).toBe(true);
    expect(calls.every((e) => e.confidence === "INFERRED")).toBe(true);
  });

  it("emits a candidate for a call to a function not defined in this file", async () => {
    const source = `double describe(struct Rect *r) {
    return area(r);
}
`;
    const { nodes, callCandidates } = await extract("main.c", source);
    const describeFn = byLabel(nodes, "describe")[0]!;
    expect(callCandidates).toContainEqual({ callerId: describeFn.id, calleeName: "area" });
  });

  it("is registered for the c language", () => {
    expect(extractorFor("c")).toBe(cExtractor);
  });
});

function anyMeta() {
  return { version: 1 as const, root: "/x", builtAt: "now", fileCount: 1 };
}
