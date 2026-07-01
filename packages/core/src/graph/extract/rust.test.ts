import { describe, expect, it } from "vitest";
import { type GraphNode, validateGraph } from "../types.js";
import { extractorFor } from "./index.js";
import { parse } from "./parser.js";
import { rustExtractor } from "./rust.js";

const SAMPLE = `use std::collections::HashMap;
use std::fmt;

struct Rect { w: f64, h: f64 }

trait Shape {
    fn area(&self) -> f64;
}

impl Shape for Rect {
    fn area(&self) -> f64 {
        self.w * self.h
    }
}

impl Rect {
    fn scaled(&self) -> f64 {
        self.area()
    }
}

fn alpha(x: i32) -> i32 {
    beta(x)
}

fn beta(y: i32) -> i32 {
    y
}
`;

async function extract(path: string, source: string) {
  const parsed = await parse("rust", source);
  try {
    return rustExtractor.extract({ path, source, root: parsed.root });
  } finally {
    parsed.dispose();
  }
}

function byLabel(nodes: GraphNode[], label: string) {
  return nodes.find((n) => n.label === label);
}

describe("rust extractor", () => {
  it("extracts a self-consistent graph", async () => {
    const { nodes, edges } = await extract("lib.rs", SAMPLE);
    expect(validateGraph({ meta: anyMeta(), nodes, edges })).toEqual([]);
  });

  it("emits file, fn, struct (class), trait (interface) and method nodes", async () => {
    const { nodes } = await extract("lib.rs", SAMPLE);
    expect(byLabel(nodes, "lib.rs")?.kind).toBe("file");
    expect(byLabel(nodes, "alpha")?.kind).toBe("function");
    expect(byLabel(nodes, "Rect")?.kind).toBe("class");
    expect(byLabel(nodes, "Shape")?.kind).toBe("interface");
    expect(byLabel(nodes, "scaled")?.kind).toBe("method");
  });

  it("emits imports edges for use declarations", async () => {
    const { nodes, edges } = await extract("lib.rs", SAMPLE);
    expect(byLabel(nodes, "std::collections::HashMap")?.kind).toBe("module");
    expect(byLabel(nodes, "std::fmt")?.kind).toBe("module");
    const imports = edges.filter((e) => e.relation === "imports");
    expect(imports).toHaveLength(2);
    expect(imports.every((e) => e.confidence === "EXTRACTED")).toBe(true);
  });

  it("attaches impl methods to the implementing type", async () => {
    const { nodes, edges } = await extract("lib.rs", SAMPLE);
    const rect = byLabel(nodes, "Rect")!;
    const defined = edges
      .filter((e) => e.source === rect.id && e.relation === "defines")
      .map((e) => nodes.find((n) => n.id === e.target));
    expect(defined.some((n) => n?.label === "scaled" && n?.kind === "method")).toBe(true);
    // the `impl Shape for Rect` method also attaches to Rect
    expect(defined.some((n) => n?.label === "area" && n?.kind === "method")).toBe(true);
  });

  it("infers an intra-file call alpha->beta", async () => {
    const { nodes, edges } = await extract("lib.rs", SAMPLE);
    const calls = edges.filter((e) => e.relation === "calls");
    const alpha = byLabel(nodes, "alpha")!;
    const beta = byLabel(nodes, "beta")!;
    expect(calls.some((e) => e.source === alpha.id && e.target === beta.id)).toBe(true);
    expect(calls.every((e) => e.confidence === "INFERRED")).toBe(true);
  });

  it("emits a self.method() candidate hinted with the enclosing impl type", async () => {
    const { nodes, callCandidates } = await extract("lib.rs", SAMPLE);
    const scaled = byLabel(nodes, "scaled")!;
    expect(callCandidates).toContainEqual({
      callerId: scaled.id,
      calleeName: "area",
      receiverHint: "Rect",
    });
  });

  it("emits a Type::assoc_fn() candidate hinted with the scoping type", async () => {
    const source = `struct Rect;
impl Rect {
    fn helper() -> f64 { 1.0 }
    fn scaled() -> f64 {
        Rect::helper()
    }
}
`;
    const { nodes, callCandidates } = await extract("lib.rs", source);
    const scaled = byLabel(nodes, "scaled")!;
    expect(callCandidates).toContainEqual({
      callerId: scaled.id,
      calleeName: "helper",
      receiverHint: "Rect",
    });
  });

  it("is registered for the rust language", () => {
    expect(extractorFor("rust")).toBe(rustExtractor);
  });
});

function anyMeta() {
  return { version: 1 as const, root: "/x", builtAt: "now", fileCount: 1 };
}
