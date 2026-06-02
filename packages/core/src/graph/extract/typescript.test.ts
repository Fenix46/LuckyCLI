import { describe, expect, it } from "vitest";
import { type GraphNode, validateGraph } from "../types.js";
import { parse } from "./parser.js";
import { extractorFor } from "./index.js";
import { typescriptExtractor } from "./typescript.js";

const SAMPLE = `import { readFile } from "node:fs";
import Foo from "./foo.js";

export function alpha(x) {
  return beta(x);
}

export const beta = (y) => readFile(y);

export class Widget {
  render() {
    return alpha(1);
  }
}

export interface Shape {
  area(): number;
}
`;

async function extract(path: string, source: string) {
  const parsed = await parse("typescript", source);
  try {
    return typescriptExtractor.extract({ path, source, root: parsed.root });
  } finally {
    parsed.dispose();
  }
}

function byLabel(nodes: GraphNode[], label: string) {
  return nodes.find((n) => n.label === label);
}

describe("typescript extractor", () => {
  it("extracts a self-consistent graph (every edge endpoint exists)", async () => {
    const { nodes, edges } = await extract("src/sample.ts", SAMPLE);
    expect(validateGraph({ meta: anyMeta(), nodes, edges })).toEqual([]);
  });

  it("emits a file node and symbol nodes with locations", async () => {
    const { nodes } = await extract("src/sample.ts", SAMPLE);
    expect(byLabel(nodes, "sample.ts")?.kind).toBe("file");
    expect(byLabel(nodes, "alpha")?.kind).toBe("function");
    expect(byLabel(nodes, "beta")?.kind).toBe("function"); // arrow const
    expect(byLabel(nodes, "Widget")?.kind).toBe("class");
    expect(byLabel(nodes, "render")?.kind).toBe("method");
    expect(byLabel(nodes, "Shape")?.kind).toBe("interface");
    expect(byLabel(nodes, "alpha")?.sourceLocation).toBe("L4");
  });

  it("emits imports edges (EXTRACTED) to module nodes", async () => {
    const { nodes, edges } = await extract("src/sample.ts", SAMPLE);
    expect(byLabel(nodes, "node:fs")?.kind).toBe("module");
    expect(byLabel(nodes, "./foo.js")?.kind).toBe("module");
    const imports = edges.filter((e) => e.relation === "imports");
    expect(imports).toHaveLength(2);
    expect(imports.every((e) => e.confidence === "EXTRACTED")).toBe(true);
  });

  it("emits defines edges from file and from class to method", async () => {
    const { nodes, edges } = await extract("src/sample.ts", SAMPLE);
    const fileNode = byLabel(nodes, "sample.ts")!;
    const widget = byLabel(nodes, "Widget")!;
    const render = byLabel(nodes, "render")!;
    expect(
      edges.some((e) => e.source === fileNode.id && e.target === widget.id && e.relation === "defines"),
    ).toBe(true);
    expect(
      edges.some((e) => e.source === widget.id && e.target === render.id && e.relation === "defines"),
    ).toBe(true);
  });

  it("infers intra-file calls (alpha->beta, Widget.render->alpha)", async () => {
    const { nodes, edges } = await extract("src/sample.ts", SAMPLE);
    const calls = edges.filter((e) => e.relation === "calls");
    expect(calls.every((e) => e.confidence === "INFERRED")).toBe(true);

    const alpha = byLabel(nodes, "alpha")!;
    const beta = byLabel(nodes, "beta")!;
    const render = byLabel(nodes, "render")!;
    expect(calls.some((e) => e.source === alpha.id && e.target === beta.id)).toBe(true);
    expect(calls.some((e) => e.source === render.id && e.target === alpha.id)).toBe(true);
  });

  it("handles plain JS and is registered for js/tsx", async () => {
    const { nodes } = await extract("src/util.js", "function helper() {}\nexport const go = () => helper();\n");
    expect(byLabel(nodes, "helper")?.kind).toBe("function");
    expect(extractorFor("javascript")).toBeTruthy();
    expect(extractorFor("tsx")).toBeTruthy();
  });
});

function anyMeta() {
  return { version: 1 as const, root: "/x", builtAt: "now", fileCount: 1 };
}
