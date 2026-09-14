import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSnapshot, loadSnapshot, readSnapshotFile } from "./snapshot.js";

describe("workflow snapshots", () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lucky-workflow-"));
    outside = await mkdtemp(join(tmpdir(), "lucky-outside-"));
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "index.ts"), "export const value = 1;\n");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it("snapshots existing, empty and missing files and reads them back", async () => {
    await writeFile(join(root, "empty.txt"), "");
    const checkpoint = await createSnapshot(
      root,
      ["src/index.ts", "empty.txt", "new.txt"],
      { id: "checkpoint-1", sessionId: "session-1", title: "Before edit" },
    );

    expect(checkpoint.files.map((file) => file.path)).toEqual([
      "empty.txt",
      "new.txt",
      "src/index.ts",
    ]);
    expect(checkpoint.files.find((file) => file.path === "new.txt")?.existed).toBe(false);
    await expect(readSnapshotFile(root, checkpoint, "empty.txt")).resolves.toEqual(Buffer.from(""));
    await expect(readSnapshotFile(root, checkpoint, "new.txt")).resolves.toBeUndefined();
    await expect(readSnapshotFile(root, checkpoint, "src/index.ts")).resolves.toEqual(
      Buffer.from("export const value = 1;\n"),
    );
  });

  it("persists an atomically readable manifest", async () => {
    const created = await createSnapshot(root, ["src/index.ts"], {
      id: "checkpoint-2",
      sessionId: "session-1",
      reason: "before refactor",
      createdAt: 42,
    });

    const loaded = await loadSnapshot(root, "checkpoint-2");

    expect(loaded).toEqual(created);
    expect(await readFile(join(root, ".lucky/checkpoints/checkpoint-2/manifest.json"), "utf8"))
      .toContain('"version": 1');
  });

  it("rejects traversal, excluded paths and directories", async () => {
    await expect(createSnapshot(root, ["../outside.txt"], { id: "bad-1", sessionId: "session-1" })).rejects.toThrow();
    await expect(createSnapshot(root, [".lucky/state.json"], { id: "bad-2", sessionId: "session-1" })).rejects.toThrow(
      "excluded",
    );
    await expect(createSnapshot(root, ["src"], { id: "bad-3", sessionId: "session-1" })).rejects.toThrow("directory");
  });

  it("rejects a symlink that resolves outside the root", async () => {
    await writeFile(join(outside, "secret.txt"), "secret");
    await symlink(join(outside, "secret.txt"), join(root, "secret.txt"));

    await expect(createSnapshot(root, ["secret.txt"], { id: "bad-link", sessionId: "session-1" })).rejects.toThrow(
      "escapes",
    );
  });

  it("detects corrupted saved content", async () => {
    const checkpoint = await createSnapshot(root, ["src/index.ts"], {
      id: "checkpoint-3",
      sessionId: "session-1",
    });
    await writeFile(join(root, ".lucky/checkpoints/checkpoint-3/files/src/index.ts"), "changed");

    await expect(readSnapshotFile(root, checkpoint, "src/index.ts")).rejects.toThrow("corrupt");
  });
});
