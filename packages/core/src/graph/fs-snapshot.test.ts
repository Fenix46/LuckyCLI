import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAndSaveGraph } from "./build.js";
import { diffSnapshots, snapshotFiles, trackedGraphFiles } from "./fs-snapshot.js";

describe("filesystem snapshots for graph upkeep", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lucky-snapshot-"));
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "a.ts"), `export function alpha() { return 1; }\n`);
    await writeFile(join(root, "src", "b.ts"), `export function beta() { return 2; }\n`);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reports a modified file and leaves untouched files out", async () => {
    const paths = ["src/a.ts", "src/b.ts"];
    const before = snapshotFiles(root, paths);
    await writeFile(join(root, "src", "a.ts"), `export function alpha() { return 99; }\n`);
    const after = snapshotFiles(root, paths);

    expect(diffSnapshots(before, after)).toEqual(["src/a.ts"]);
  });

  it("treats a deleted file as changed so the graph can prune it", async () => {
    const paths = ["src/a.ts"];
    const before = snapshotFiles(root, paths);
    await rm(join(root, "src", "a.ts"));
    const after = snapshotFiles(root, paths);

    expect(diffSnapshots(before, after)).toEqual(["src/a.ts"]);
  });

  it("reports nothing when no tracked file changed", async () => {
    const paths = ["src/a.ts", "src/b.ts"];
    const before = snapshotFiles(root, paths);
    const after = snapshotFiles(root, paths);

    expect(diffSnapshots(before, after)).toEqual([]);
  });

  it("returns an empty tracked set when no graph exists", async () => {
    expect(await trackedGraphFiles(root)).toEqual([]);
  });

  it("reads the stored graph's source files", async () => {
    await buildAndSaveGraph(root);
    const tracked = await trackedGraphFiles(root);

    expect(tracked).toEqual(expect.arrayContaining(["src/a.ts", "src/b.ts"]));
  });
});
