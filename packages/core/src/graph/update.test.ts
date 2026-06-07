import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { rm as rmFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAndSaveGraph } from "./build.js";
import { loadGraph } from "./store.js";
import { updateGraphForFiles } from "./update.js";
import { validateGraph } from "./types.js";

describe("incremental graph update", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lucky-update-"));
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "a.ts"), `export function alpha() { return 1; }\n`);
    await writeFile(join(root, "src", "b.ts"), `export function beta() { return 2; }\n`);
    await buildAndSaveGraph(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("re-extracts only the changed file and reflects new symbols", async () => {
    await writeFile(join(root, "src", "a.ts"), `export function renamed() { return 1; }\n`);
    const summary = await updateGraphForFiles(root, ["src/a.ts"]);

    expect(summary?.updated).toEqual(["src/a.ts"]);
    const graph = await loadGraph(root);
    const labels = graph.nodes.map((n) => n.label);
    expect(labels).toContain("renamed");
    expect(labels).not.toContain("alpha"); // old symbol gone
    expect(labels).toContain("beta"); // untouched file preserved
    expect(validateGraph(graph)).toEqual([]);
  });

  it("keeps external/internal import classification stable across an edit", async () => {
    // a.ts pulls in an external lib and a sibling file; both must survive a
    // re-extract without the graph re-dirtying (external flag, internal resolution).
    await writeFile(
      join(root, "src", "a.ts"),
      `import os from "os";\nimport { beta } from "./b.js";\nexport function alpha() { return beta(); }\n`,
    );
    await updateGraphForFiles(root, ["src/a.ts"]);
    // edit again and re-extract
    await writeFile(
      join(root, "src", "a.ts"),
      `import os from "os";\nimport { beta } from "./b.js";\nexport function alpha() { return beta() + 1; }\n`,
    );
    await updateGraphForFiles(root, ["src/a.ts"]);

    const graph = await loadGraph(root);
    // External library stays a flagged module.
    expect(graph.nodes.find((n) => n.label === "os")?.external).toBe(true);
    // Internal relative import resolves to the real file node — no stub left.
    expect(graph.nodes.some((n) => n.kind === "module" && n.label === "./b.js")).toBe(false);
    const aFile = graph.nodes.find((n) => n.sourceFile === "src/a.ts" && n.kind === "file")!;
    const bFile = graph.nodes.find((n) => n.sourceFile === "src/b.ts" && n.kind === "file")!;
    expect(
      graph.edges.some(
        (e) => e.relation === "imports" && e.source === aFile.id && e.target === bFile.id,
      ),
    ).toBe(true);
    expect(validateGraph(graph)).toEqual([]);
  });

  it("adds a brand-new file to the graph", async () => {
    await writeFile(join(root, "src", "c.ts"), `export function gamma() {}\n`);
    await updateGraphForFiles(root, ["src/c.ts"]);

    const graph = await loadGraph(root);
    expect(graph.nodes.map((n) => n.label)).toContain("gamma");
  });

  it("removes a deleted file's nodes", async () => {
    await rmFile(join(root, "src", "b.ts"));
    const summary = await updateGraphForFiles(root, ["src/b.ts"]);

    expect(summary?.removed).toContain("src/b.ts");
    const graph = await loadGraph(root);
    expect(graph.nodes.map((n) => n.label)).not.toContain("beta");
    expect(graph.nodes.some((n) => n.sourceFile === "src/b.ts")).toBe(false);
  });

  it("prunes a module that is no longer imported", async () => {
    await writeFile(join(root, "src", "a.ts"), `import { x } from "node:fs";\nexport const y = x;\n`);
    await updateGraphForFiles(root, ["src/a.ts"]);
    expect((await loadGraph(root)).nodes.some((n) => n.label === "node:fs")).toBe(true);

    await writeFile(join(root, "src", "a.ts"), `export const y = 1;\n`);
    await updateGraphForFiles(root, ["src/a.ts"]);
    expect((await loadGraph(root)).nodes.some((n) => n.label === "node:fs")).toBe(false);
  });

  it("ignores non-code files and returns null", async () => {
    await writeFile(join(root, "README.md"), "# hi\n");
    expect(await updateGraphForFiles(root, ["README.md"])).toBeNull();
  });

  it("returns null when no graph exists", async () => {
    const fresh = await mkdtemp(join(tmpdir(), "lucky-nograph-"));
    try {
      await writeFile(join(fresh, "a.ts"), "export const z = 1;\n");
      expect(await updateGraphForFiles(fresh, ["a.ts"])).toBeNull();
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });
});
