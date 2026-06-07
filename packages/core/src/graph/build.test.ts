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
