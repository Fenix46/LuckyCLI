import { describe, expect, it } from "vitest";
import { csharpExtractor } from "./csharp.js";
import { extractorFor } from "./index.js";
import { parse } from "./parser.js";
import { type GraphNode, validateGraph } from "../types.js";

const SAMPLE = `using System;
using System.Collections.Generic;

namespace App.Geometry
{
    interface IShape
    {
        double Area();
    }

    class Rect : IShape
    {
        private double w, h;

        public double Area()
        {
            return Scaled();
        }

        private double Scaled()
        {
            return Helper(w);
        }

        static double Helper(double v)
        {
            return v * 2;
        }
    }

    enum Color { Red, Green }
}
`;

async function extract(path: string, source: string) {
  const parsed = await parse("csharp", source);
  try {
    return csharpExtractor.extract({ path, source, root: parsed.root });
  } finally {
    parsed.dispose();
  }
}

function byLabel(nodes: GraphNode[], label: string) {
  return nodes.filter((n) => n.label === label);
}

describe("csharp extractor", () => {
  it("extracts a self-consistent graph", async () => {
    const { nodes, edges } = await extract("Rect.cs", SAMPLE);
    expect(validateGraph({ meta: anyMeta(), nodes, edges })).toEqual([]);
  });

  it("emits file, namespace, interface, class and method nodes", async () => {
    const { nodes } = await extract("Rect.cs", SAMPLE);
    expect(byLabel(nodes, "Rect.cs")[0]?.kind).toBe("file");
    expect(byLabel(nodes, "App.Geometry")[0]?.kind).toBe("module");
    expect(byLabel(nodes, "IShape")[0]?.kind).toBe("interface");
    expect(byLabel(nodes, "Rect")[0]?.kind).toBe("class");
    expect(byLabel(nodes, "Color")[0]?.kind).toBe("class");
    expect(byLabel(nodes, "Scaled")[0]?.kind).toBe("method");
  });

  it("emits imports edges for using directives", async () => {
    const { nodes, edges } = await extract("Rect.cs", SAMPLE);
    expect(byLabel(nodes, "System")[0]?.kind).toBe("module");
    expect(byLabel(nodes, "System.Collections.Generic")[0]?.kind).toBe("module");
    const imports = edges.filter((e) => e.relation === "imports");
    expect(imports).toHaveLength(2);
    expect(imports.every((e) => e.confidence === "EXTRACTED")).toBe(true);
  });

  it("nests types inside the namespace and methods inside their class", async () => {
    const { nodes, edges } = await extract("Rect.cs", SAMPLE);
    const ns = byLabel(nodes, "App.Geometry")[0]!;
    const typesInNs = edges
      .filter((e) => e.source === ns.id && e.relation === "defines")
      .map((e) => nodes.find((n) => n.id === e.target))
      .filter((n) => n?.kind === "class" || n?.kind === "interface")
      .map((n) => n?.label)
      .sort();
    expect(typesInNs).toEqual(["Color", "IShape", "Rect"]);

    const rect = byLabel(nodes, "Rect")[0]!;
    const methods = edges
      .filter((e) => e.source === rect.id && e.relation === "defines")
      .map((e) => nodes.find((n) => n.id === e.target))
      .filter((n) => n?.kind === "method")
      .map((n) => n?.label)
      .sort();
    expect(methods).toEqual(["Area", "Helper", "Scaled"]);
  });

  it("infers same-class calls (Area->Scaled->Helper)", async () => {
    const { nodes, edges } = await extract("Rect.cs", SAMPLE);
    const calls = edges.filter((e) => e.relation === "calls");
    const rect = byLabel(nodes, "Rect")[0]!;
    // IShape also declares an `Area` method; resolve method ids within Rect.
    const id = (label: string) =>
      edges
        .filter((e) => e.source === rect.id && e.relation === "defines")
        .map((e) => nodes.find((n) => n.id === e.target))
        .find((n) => n?.label === label && n?.kind === "method")!.id;
    expect(calls.some((e) => e.source === id("Area") && e.target === id("Scaled"))).toBe(true);
    expect(calls.some((e) => e.source === id("Scaled") && e.target === id("Helper"))).toBe(true);
    expect(calls.every((e) => e.confidence === "INFERRED")).toBe(true);
  });

  it("is registered for the csharp language", () => {
    expect(extractorFor("csharp")).toBe(csharpExtractor);
  });
});

function anyMeta() {
  return { version: 1 as const, root: "/x", builtAt: "now", fileCount: 1 };
}
