import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAndSaveGraph } from "./build.js";
import { findStaleGraphFiles, refreshGraph } from "./refresh.js";
import { loadGraph } from "./store.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

describe("graph refresh after external changes", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lucky-refresh-"));
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "a.ts"), "export function alpha() { return 1; }\n");
    await writeFile(join(root, "src", "b.ts"), "export function beta() { return 2; }\n");
    await buildAndSaveGraph(root);
    await tick();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("is a no-op when nothing changed since the graph was written", async () => {
    expect(await findStaleGraphFiles(root)).toEqual([]);
    expect(await refreshGraph(root)).toBeNull();
  });

  it("finds modified, deleted and new code files, and refreshes them", async () => {
    await writeFile(join(root, "src", "a.ts"), "export function renamed() { return 1; }\n");
    await rm(join(root, "src", "b.ts"));
    await writeFile(join(root, "src", "c.ts"), "export function gamma() { return 3; }\n");
    await writeFile(join(root, "notes.txt"), "not code");

    expect((await findStaleGraphFiles(root)).sort()).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);

    const summary = await refreshGraph(root);
    expect(summary?.updated.sort()).toEqual(["src/a.ts", "src/c.ts"]);
    expect(summary?.removed).toEqual(["src/b.ts"]);
    const labels = (await loadGraph(root)).nodes.map((n) => n.label);
    expect(labels).toEqual(expect.arrayContaining(["renamed", "gamma"]));
    expect(labels).not.toContain("alpha");
    expect(labels).not.toContain("beta");

    expect(await findStaleGraphFiles(root)).toEqual([]);
  });

  it("returns nothing for a project without a graph", async () => {
    const bare = await mkdtemp(join(tmpdir(), "lucky-refresh-bare-"));
    await writeFile(join(bare, "x.ts"), "export const x = 1;\n");
    expect(await findStaleGraphFiles(bare)).toEqual([]);
    await rm(bare, { recursive: true, force: true });
  });
});
