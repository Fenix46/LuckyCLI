import { describe, expect, it } from "vitest";
import { extractorFor } from "./index.js";
import { kotlinExtractor } from "./kotlin.js";
import { parse } from "./parser.js";
import { type GraphNode, validateGraph } from "../types.js";

const SAMPLE = `package com.example.geo

import kotlin.math.PI
import java.util.List

interface Shape {
    fun area(): Double
}

class Rect(val w: Double, val h: Double) : Shape {
    override fun area(): Double {
        return scaled()
    }

    private fun scaled(): Double {
        return helper(w)
    }

    private fun helper(v: Double): Double {
        return v * 2
    }
}

fun topLevel(): Double {
    return topHelper()
}

fun topHelper(): Double {
    return 1.0
}
`;

async function extract(path: string, source: string) {
  const parsed = await parse("kotlin", source);
  try {
    return kotlinExtractor.extract({ path, source, root: parsed.root });
  } finally {
    parsed.dispose();
  }
}

function byLabel(nodes: GraphNode[], label: string) {
  return nodes.filter((n) => n.label === label);
}

describe("kotlin extractor", () => {
  it("extracts a self-consistent graph", async () => {
    const { nodes, edges } = await extract("Rect.kt", SAMPLE);
    expect(validateGraph({ meta: anyMeta(), nodes, edges })).toEqual([]);
  });

  it("emits file, interface, class, method and top-level function nodes", async () => {
    const { nodes } = await extract("Rect.kt", SAMPLE);
    expect(byLabel(nodes, "Rect.kt")[0]?.kind).toBe("file");
    expect(byLabel(nodes, "Shape")[0]?.kind).toBe("interface");
    expect(byLabel(nodes, "Rect")[0]?.kind).toBe("class");
    expect(byLabel(nodes, "scaled")[0]?.kind).toBe("method");
    expect(byLabel(nodes, "topLevel")[0]?.kind).toBe("function");
  });

  it("emits imports edges for import directives", async () => {
    const { nodes, edges } = await extract("Rect.kt", SAMPLE);
    expect(byLabel(nodes, "kotlin.math.PI")[0]?.kind).toBe("module");
    expect(byLabel(nodes, "java.util.List")[0]?.kind).toBe("module");
    const imports = edges.filter((e) => e.relation === "imports");
    expect(imports).toHaveLength(2);
    expect(imports.every((e) => e.confidence === "EXTRACTED")).toBe(true);
  });

  it("attaches methods to their declaring class", async () => {
    const { nodes, edges } = await extract("Rect.kt", SAMPLE);
    const rect = byLabel(nodes, "Rect")[0]!;
    const methods = edges
      .filter((e) => e.source === rect.id && e.relation === "defines")
      .map((e) => nodes.find((n) => n.id === e.target))
      .filter((n) => n?.kind === "method")
      .map((n) => n?.label)
      .sort();
    expect(methods).toEqual(["area", "helper", "scaled"]);
  });

  it("infers same-class calls (area->scaled->helper)", async () => {
    const { nodes, edges } = await extract("Rect.kt", SAMPLE);
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
    const { nodes, edges } = await extract("Rect.kt", SAMPLE);
    const fn = byLabel(nodes, "topLevel")[0]!;
    const helper = byLabel(nodes, "topHelper")[0]!;
    expect(
      edges.some((e) => e.relation === "calls" && e.source === fn.id && e.target === helper.id),
    ).toBe(true);
  });

  it("is registered for the kotlin language", () => {
    expect(extractorFor("kotlin")).toBe(kotlinExtractor);
  });
});

function anyMeta() {
  return { version: 1 as const, root: "/x", builtAt: "now", fileCount: 1 };
}
