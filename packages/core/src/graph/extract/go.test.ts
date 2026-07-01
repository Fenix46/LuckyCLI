import { describe, expect, it } from "vitest";
import { type GraphNode, validateGraph } from "../types.js";
import { goExtractor } from "./go.js";
import { extractorFor } from "./index.js";
import { parse } from "./parser.js";

const SAMPLE = `package main

import (
	"fmt"
	"os/exec"
)

type Shape interface {
	Area() float64
}

type Rect struct {
	w, h float64
}

func (r Rect) Area() float64 {
	return r.w * r.h
}

func alpha(x int) int {
	return beta(x)
}

func beta(y int) int {
	fmt.Println(y)
	return y
}
`;

async function extract(path: string, source: string) {
  const parsed = await parse("go", source);
  try {
    return goExtractor.extract({ path, source, root: parsed.root });
  } finally {
    parsed.dispose();
  }
}

function byLabel(nodes: GraphNode[], label: string) {
  return nodes.find((n) => n.label === label);
}

describe("go extractor", () => {
  it("extracts a self-consistent graph", async () => {
    const { nodes, edges } = await extract("main.go", SAMPLE);
    expect(validateGraph({ meta: anyMeta(), nodes, edges })).toEqual([]);
  });

  it("emits file, func, struct (class), interface and method nodes", async () => {
    const { nodes } = await extract("main.go", SAMPLE);
    expect(byLabel(nodes, "main.go")?.kind).toBe("file");
    expect(byLabel(nodes, "alpha")?.kind).toBe("function");
    expect(byLabel(nodes, "Rect")?.kind).toBe("class");
    expect(byLabel(nodes, "Shape")?.kind).toBe("interface");
    expect(byLabel(nodes, "Area")?.kind).toBe("method");
    expect(byLabel(nodes, "alpha")?.sourceLocation).toBe("L20");
  });

  it("emits imports edges for each import spec", async () => {
    const { nodes, edges } = await extract("main.go", SAMPLE);
    expect(byLabel(nodes, "fmt")?.kind).toBe("module");
    expect(byLabel(nodes, "os/exec")?.kind).toBe("module");
    const imports = edges.filter((e) => e.relation === "imports");
    expect(imports).toHaveLength(2);
    expect(imports.every((e) => e.confidence === "EXTRACTED")).toBe(true);
  });

  it("attaches the method to its receiver type", async () => {
    const { nodes, edges } = await extract("main.go", SAMPLE);
    const rect = byLabel(nodes, "Rect")!;
    const defined = edges
      .filter((e) => e.source === rect.id && e.relation === "defines")
      .map((e) => nodes.find((n) => n.id === e.target));
    expect(defined.some((n) => n?.label === "Area" && n?.kind === "method")).toBe(true);
  });

  it("infers an intra-file call alpha->beta and defers selector calls to cross-file resolution", async () => {
    const { nodes, edges, callCandidates } = await extract("main.go", SAMPLE);
    const calls = edges.filter((e) => e.relation === "calls");
    const alpha = byLabel(nodes, "alpha")!;
    const beta = byLabel(nodes, "beta")!;
    expect(calls.some((e) => e.source === alpha.id && e.target === beta.id)).toBe(true);
    expect(calls.every((e) => e.confidence === "INFERRED")).toBe(true);
    // beta calls fmt.Println (selector) — not a local symbol → no direct edge,
    // but a candidate for the cross-file resolution pass instead.
    expect(calls.some((e) => e.source === beta.id)).toBe(false);
    expect(
      callCandidates?.some((c) => c.callerId === beta.id && c.calleeName === "Println"),
    ).toBe(true);
  });

  it("emits a candidate with a type-hinted receiver for recv.Method() calls", async () => {
    const source = `package main

type Rect struct{ w, h float64 }

func (r Rect) Area() float64 { return r.w * r.h }

func describe(r Rect) float64 {
	return r.Area()
}
`;
    const { nodes, callCandidates } = await extract("shapes.go", source);
    const describeFn = byLabel(nodes, "describe")!;
    expect(callCandidates).toContainEqual({
      callerId: describeFn.id,
      calleeName: "Area",
      receiverHint: "Rect",
    });
  });

  it("is registered for the go language", () => {
    expect(extractorFor("go")).toBe(goExtractor);
  });
});

function anyMeta() {
  return { version: 1 as const, root: "/x", builtAt: "now", fileCount: 1 };
}
