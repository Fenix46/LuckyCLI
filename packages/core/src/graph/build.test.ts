import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAndSaveGraph, buildGraph } from "./build.js";
import { loadGraph } from "./store.js";
import { validateGraph } from "./types.js";

describe("graph build pipeline", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lucky-build-"));
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "pkg"), { recursive: true });
    await mkdir(join(root, "node_modules", "dep"), { recursive: true });
    await writeFile(
      join(root, "src", "a.ts"),
      `import { helper } from "./b.js";\nexport function alpha() { return helper(); }\n`,
    );
    await writeFile(
      join(root, "src", "b.ts"),
      `export const helper = () => 1;\n`,
    );
    await writeFile(
      join(root, "pkg", "m.py"),
      `import os\n\ndef run():\n    return run()\n`,
    );
    await writeFile(join(root, "README.md"), "# not code\n");
    await writeFile(join(root, "node_modules", "dep", "x.js"), "module.exports = 1;\n");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("builds a valid graph across TS and Python, skipping non-code and junk dirs", async () => {
    const summary = await buildGraph(root);

    expect(summary.fileCount).toBe(3); // a.ts, b.ts, m.py — not README.md or node_modules
    expect(validateGraph(summary.graph)).toEqual([]);
    expect(summary.graph.meta.root).toBe(root);

    const labels = summary.graph.nodes.map((n) => n.label);
    expect(labels).toContain("alpha");
    expect(labels).toContain("helper");
    expect(labels).toContain("run");
    expect(labels).toContain("os"); // python module
    expect(summary.skipped).toEqual([]);
  });

  it("marks library imports as external, leaving project code unmarked", async () => {
    const summary = await buildGraph(root);
    const byLabel = (label: string) =>
      summary.graph.nodes.find((n) => n.label === label);

    // `import os` resolves to no repo file → external library node.
    expect(byLabel("os")?.external).toBe(true);

    // Project code is never external.
    expect(byLabel("alpha")?.external).toBeUndefined();
    expect(byLabel("helper")?.external).toBeUndefined();
    expect(byLabel("run")?.external).toBeUndefined();

    // Only `module` nodes are ever flagged; every external node is a module.
    for (const node of summary.graph.nodes) {
      if (node.external) expect(node.kind).toBe("module");
    }
  });

  it("resolves relative imports to the real file node, dropping the stub", async () => {
    const summary = await buildGraph(root);
    const { nodes, edges } = summary.graph;

    // a.ts imports "./b.js" — the stub module is gone, replaced by a file→file edge.
    const stub = nodes.find((n) => n.kind === "module" && n.label === "./b.js");
    expect(stub).toBeUndefined();

    const aFile = nodes.find((n) => n.sourceFile === "src/a.ts" && n.kind === "file")!;
    const bFile = nodes.find((n) => n.sourceFile === "src/b.ts" && n.kind === "file")!;
    const resolved = edges.find(
      (e) => e.relation === "imports" && e.source === aFile.id && e.target === bFile.id,
    );
    expect(resolved).toBeDefined();

    // The external library import (`import os`) is untouched.
    expect(nodes.some((n) => n.kind === "module" && n.label === "os")).toBe(true);
  });

  it("reports progress for each detected file", async () => {
    const seen: string[] = [];
    const summary = await buildGraph(root, {
      onProgress: (p) => {
        seen.push(p.file);
        expect(p.total).toBe(3);
      },
    });
    expect(seen).toHaveLength(3);
    expect(summary.nodeCount).toBeGreaterThan(0);
  });

  it("persists to .lucky/graph/graph.json and reloads identically", async () => {
    const built = await buildAndSaveGraph(root);
    expect(built.path).toContain(join(".lucky", "graph", "graph.json"));

    const reloaded = await loadGraph(root);
    expect(reloaded.nodes).toEqual(built.graph.nodes);
    expect(reloaded.edges).toEqual(built.graph.edges);
  });

  it("is idempotent — rebuilding yields the same nodes and edges", async () => {
    const first = await buildGraph(root);
    const second = await buildGraph(root);
    expect(second.graph.nodes).toEqual(first.graph.nodes);
    expect(second.graph.edges).toEqual(first.graph.edges);
  });
});

describe("graph build pipeline — cross-file calls", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lucky-build-xfile-"));
    await writeFile(
      join(root, "shapes.go"),
      `package main

type Rect struct{ w, h float64 }

func (r Rect) Area() float64 { return r.w * r.h }
`,
    );
    await writeFile(
      join(root, "main.go"),
      `package main

func describe(r Rect) float64 {
	return r.Area()
}
`,
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("resolves a receiver method call across files into an AMBIGUOUS calls edge", async () => {
    const summary = await buildGraph(root);
    const { nodes, edges } = summary.graph;

    const describeFn = nodes.find((n) => n.label === "describe")!;
    const areaMethod = nodes.find((n) => n.label === "Area")!;
    expect(areaMethod.sourceFile).toBe("shapes.go");
    expect(describeFn.sourceFile).toBe("main.go");

    const resolved = edges.find(
      (e) => e.source === describeFn.id && e.target === areaMethod.id && e.relation === "calls",
    );
    expect(resolved?.confidence).toBe("AMBIGUOUS");
  });
});

describe("graph build pipeline — cross-file calls (rust)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lucky-build-xfile-rs-"));
    await writeFile(
      join(root, "shapes.rs"),
      `pub struct Rect { pub w: f64, pub h: f64 }

impl Rect {
    pub fn area(&self) -> f64 { self.w * self.h }
}
`,
    );
    await writeFile(
      join(root, "main.rs"),
      `mod shapes;
use shapes::Rect;

fn describe(r: &Rect) -> f64 {
    r.area()
}
`,
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("resolves a receiver.method() call across files into an AMBIGUOUS calls edge (unique bare-name fallback)", async () => {
    const summary = await buildGraph(root);
    const { nodes, edges } = summary.graph;

    const describeFn = nodes.find((n) => n.label === "describe")!;
    const areaMethod = nodes.find((n) => n.label === "area")!;
    expect(areaMethod.sourceFile).toBe("shapes.rs");
    expect(describeFn.sourceFile).toBe("main.rs");

    const resolved = edges.find(
      (e) => e.source === describeFn.id && e.target === areaMethod.id && e.relation === "calls",
    );
    expect(resolved?.confidence).toBe("AMBIGUOUS");
  });
});

describe("graph build pipeline — cross-file calls (java)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lucky-build-xfile-java-"));
    await writeFile(
      join(root, "Rect.java"),
      `public class Rect {
    public double area() { return 1.0; }
}
`,
    );
    await writeFile(
      join(root, "Describer.java"),
      `public class Describer {
    public double describe(Rect r) {
        return r.area();
    }
}
`,
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("resolves a param.method() call across files into an AMBIGUOUS calls edge", async () => {
    const summary = await buildGraph(root);
    const { nodes, edges } = summary.graph;

    const describeMethod = nodes.find((n) => n.label === "describe")!;
    const areaMethod = nodes.find((n) => n.label === "area")!;
    expect(areaMethod.sourceFile).toBe("Rect.java");
    expect(describeMethod.sourceFile).toBe("Describer.java");

    const resolved = edges.find(
      (e) =>
        e.source === describeMethod.id && e.target === areaMethod.id && e.relation === "calls",
    );
    expect(resolved?.confidence).toBe("AMBIGUOUS");
  });
});

describe("graph build pipeline — cross-file calls (c)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lucky-build-xfile-c-"));
    await writeFile(
      join(root, "geometry.c"),
      `double area(double w, double h) {
    return w * h;
}
`,
    );
    await writeFile(
      join(root, "main.c"),
      `double describe(double w, double h) {
    return area(w, h);
}
`,
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("resolves a call to a function defined in another translation unit into an AMBIGUOUS calls edge", async () => {
    const summary = await buildGraph(root);
    const { nodes, edges } = summary.graph;

    const describeFn = nodes.find((n) => n.label === "describe")!;
    const areaFn = nodes.find((n) => n.label === "area")!;
    expect(areaFn.sourceFile).toBe("geometry.c");
    expect(describeFn.sourceFile).toBe("main.c");

    const resolved = edges.find(
      (e) => e.source === describeFn.id && e.target === areaFn.id && e.relation === "calls",
    );
    expect(resolved?.confidence).toBe("AMBIGUOUS");
  });
});
