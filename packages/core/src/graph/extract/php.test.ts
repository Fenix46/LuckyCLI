import { describe, expect, it } from "vitest";
import { extractorFor } from "./index.js";
import { parse } from "./parser.js";
import { phpExtractor } from "./php.js";
import { type GraphNode, validateGraph } from "../types.js";

const SAMPLE = `<?php
namespace App\\Geometry;

use App\\Util\\Helper;
use App\\Math;

interface Shape {
    public function area(): float;
}

class Rect implements Shape {
    private float $w;
    private float $h;

    public function area(): float {
        return $this->scaled();
    }

    private function scaled(): float {
        return $this->helper($this->w);
    }

    private function helper(float $v): float {
        return $v * 2;
    }
}

function top_level_fn() {
    return top_helper();
}

function top_helper() {
    return 1;
}
`;

async function extract(path: string, source: string) {
  const parsed = await parse("php", source);
  try {
    return phpExtractor.extract({ path, source, root: parsed.root });
  } finally {
    parsed.dispose();
  }
}

function byLabel(nodes: GraphNode[], label: string) {
  return nodes.filter((n) => n.label === label);
}

describe("php extractor", () => {
  it("extracts a self-consistent graph", async () => {
    const { nodes, edges } = await extract("Rect.php", SAMPLE);
    expect(validateGraph({ meta: anyMeta(), nodes, edges })).toEqual([]);
  });

  it("emits file, namespace, interface, class, method and function nodes", async () => {
    const { nodes } = await extract("Rect.php", SAMPLE);
    expect(byLabel(nodes, "Rect.php")[0]?.kind).toBe("file");
    expect(byLabel(nodes, "App\\Geometry")[0]?.kind).toBe("module");
    expect(byLabel(nodes, "Shape")[0]?.kind).toBe("interface");
    expect(byLabel(nodes, "Rect")[0]?.kind).toBe("class");
    expect(byLabel(nodes, "scaled")[0]?.kind).toBe("method");
    expect(byLabel(nodes, "top_level_fn")[0]?.kind).toBe("function");
  });

  it("emits imports edges for use declarations", async () => {
    const { nodes, edges } = await extract("Rect.php", SAMPLE);
    expect(byLabel(nodes, "App\\Util\\Helper")[0]?.kind).toBe("module");
    expect(byLabel(nodes, "App\\Math")[0]?.kind).toBe("module");
    const imports = edges.filter((e) => e.relation === "imports");
    expect(imports).toHaveLength(2);
    expect(imports.every((e) => e.confidence === "EXTRACTED")).toBe(true);
  });

  it("attaches methods to their declaring class", async () => {
    const { nodes, edges } = await extract("Rect.php", SAMPLE);
    const rect = byLabel(nodes, "Rect")[0]!;
    const methods = edges
      .filter((e) => e.source === rect.id && e.relation === "defines")
      .map((e) => nodes.find((n) => n.id === e.target))
      .filter((n) => n?.kind === "method")
      .map((n) => n?.label)
      .sort();
    expect(methods).toEqual(["area", "helper", "scaled"]);
  });

  it("infers $this calls (area->scaled->helper)", async () => {
    const { nodes, edges } = await extract("Rect.php", SAMPLE);
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

  it("infers top-level function calls (top_level_fn->top_helper)", async () => {
    const { nodes, edges } = await extract("Rect.php", SAMPLE);
    const fn = byLabel(nodes, "top_level_fn")[0]!;
    const helper = byLabel(nodes, "top_helper")[0]!;
    expect(
      edges.some(
        (e) => e.relation === "calls" && e.source === fn.id && e.target === helper.id,
      ),
    ).toBe(true);
  });

  it("is registered for the php language", () => {
    expect(extractorFor("php")).toBe(phpExtractor);
  });
});

function anyMeta() {
  return { version: 1 as const, root: "/x", builtAt: "now", fileCount: 1 };
}
