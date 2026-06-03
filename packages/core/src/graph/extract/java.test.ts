import { describe, expect, it } from "vitest";
import { type GraphNode, validateGraph } from "../types.js";
import { extractorFor } from "./index.js";
import { javaExtractor } from "./java.js";
import { parse } from "./parser.js";

const SAMPLE = `package com.example.app;

import java.util.List;
import java.util.Map;

public interface Shape {
    double area();
}

public class Rect implements Shape {
    private double w, h;

    public double area() {
        return scaled();
    }

    private double scaled() {
        return helper(w);
    }

    static double helper(double v) {
        return v * 2;
    }
}
`;

async function extract(path: string, source: string) {
  const parsed = await parse("java", source);
  try {
    return javaExtractor.extract({ path, source, root: parsed.root });
  } finally {
    parsed.dispose();
  }
}

function byLabel(nodes: GraphNode[], label: string) {
  return nodes.filter((n) => n.label === label);
}

describe("java extractor", () => {
  it("extracts a self-consistent graph", async () => {
    const { nodes, edges } = await extract("Rect.java", SAMPLE);
    expect(validateGraph({ meta: anyMeta(), nodes, edges })).toEqual([]);
  });

  it("emits file, class, interface and method nodes", async () => {
    const { nodes } = await extract("Rect.java", SAMPLE);
    expect(byLabel(nodes, "Rect.java")[0]?.kind).toBe("file");
    expect(byLabel(nodes, "Rect")[0]?.kind).toBe("class");
    expect(byLabel(nodes, "Shape")[0]?.kind).toBe("interface");
    expect(byLabel(nodes, "scaled")[0]?.kind).toBe("method");
  });

  it("emits imports edges for import declarations", async () => {
    const { nodes, edges } = await extract("Rect.java", SAMPLE);
    expect(byLabel(nodes, "java.util.List")[0]?.kind).toBe("module");
    expect(byLabel(nodes, "java.util.Map")[0]?.kind).toBe("module");
    const imports = edges.filter((e) => e.relation === "imports");
    expect(imports).toHaveLength(2);
    expect(imports.every((e) => e.confidence === "EXTRACTED")).toBe(true);
  });

  it("attaches methods to their declaring class", async () => {
    const { nodes, edges } = await extract("Rect.java", SAMPLE);
    const rect = byLabel(nodes, "Rect")[0]!;
    const defined = edges
      .filter((e) => e.source === rect.id && e.relation === "defines")
      .map((e) => nodes.find((n) => n.id === e.target));
    expect(defined.filter((n) => n?.kind === "method").map((n) => n?.label).sort()).toEqual([
      "area",
      "helper",
      "scaled",
    ]);
  });

  it("infers same-class calls (area->scaled->helper)", async () => {
    const { nodes, edges } = await extract("Rect.java", SAMPLE);
    const calls = edges.filter((e) => e.relation === "calls");
    const rect = byLabel(nodes, "Rect")[0]!;
    // Resolve method ids within Rect (Shape also has an "area" method).
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

  it("is registered for the java language", () => {
    expect(extractorFor("java")).toBe(javaExtractor);
  });
});

function anyMeta() {
  return { version: 1 as const, root: "/x", builtAt: "now", fileCount: 1 };
}
