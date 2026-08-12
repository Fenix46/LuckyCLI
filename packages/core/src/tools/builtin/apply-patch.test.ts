import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolRegistry } from "../registry.js";
import { applyPatchTool, previewPatch } from "./apply-patch.js";

describe("apply_patch tool", () => {
  let root: string;
  let registry: ToolRegistry;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lucky-apply-patch-"));
    registry = new ToolRegistry().register(applyPatchTool);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("creates a new file via an add patch", async () => {
    const patch = [
      "--- /dev/null",
      "+++ b/nested/dir/f.txt",
      "@@ -0,0 +1 @@",
      "+hello",
    ].join("\n");

    const result = await registry.execute("apply_patch", { patch }, { cwd: root });

    expect(result.isError).toBeUndefined();
    await expect(readFile(join(root, "nested/dir/f.txt"), "utf8")).resolves.toBe("hello");
  });

  it("updates an existing file", async () => {
    await writeFile(join(root, "f.txt"), "old\n", "utf8");
    const patch = ["--- a/f.txt", "+++ b/f.txt", "@@ -1 +1 @@", "-old", "+new"].join("\n");

    const result = await registry.execute("apply_patch", { patch }, { cwd: root });

    expect(result.isError).toBeUndefined();
    await expect(readFile(join(root, "f.txt"), "utf8")).resolves.toBe("new\n");
  });

  describe("sandbox escape via a symlinked directory", () => {
    let outside: string;

    beforeEach(async () => {
      outside = await mkdtemp(join(tmpdir(), "lucky-apply-patch-outside-"));
      await symlink(outside, join(root, "evil_link"), "dir");
    });

    afterEach(async () => {
      await rm(outside, { recursive: true, force: true });
    });

    it("rejects an add-patch that traverses a symlink to outside cwd, without creating any directory there", async () => {
      const patch = [
        "--- /dev/null",
        "+++ b/evil_link/nested/pwned.txt",
        "@@ -0,0 +1 @@",
        "+pwned",
      ].join("\n");

      const result = await registry.execute("apply_patch", { patch }, { cwd: root });

      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/escapes/i);

      // The real bug: mkdir(dirname(target), {recursive:true}) used to run
      // BEFORE the escape check, so `outside/nested` would exist on disk
      // even though the final write was correctly refused.
      const outsideEntries = await readdir(outside);
      expect(outsideEntries).not.toContain("nested");
    });
  });
});

describe("previewPatch", () => {
  /** In-memory files, so a write would be visible as a mutation of the map. */
  const files: Record<string, string> = { "a.txt": "one\ntwo\nthree\n" };
  const read = async (path: string) => files[path];

  const updatePatch = [
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -1,3 +1,3 @@",
    " one",
    "-two",
    "+TWO",
    " three",
  ].join("\n");

  it("diffs an update without touching the file", async () => {
    const diffs = await previewPatch(updatePatch, read);

    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ path: "a.txt", additions: 1, deletions: 1 });
    expect(files["a.txt"]).toBe("one\ntwo\nthree\n");
  });

  it("marks an add patch as a creation and needs no file", async () => {
    const patch = ["--- /dev/null", "+++ b/new.txt", "@@ -0,0 +1 @@", "+hello"].join("\n");

    const diffs = await previewPatch(patch, async () => undefined);

    expect(diffs[0]).toMatchObject({ path: "new.txt", created: true, additions: 1 });
  });

  it("diffs a delete patch as the removal of every line", async () => {
    const patch = [
      "--- a/a.txt",
      "+++ /dev/null",
      "@@ -1,3 +0,0 @@",
      "-one",
      "-two",
      "-three",
    ].join("\n");

    const diffs = await previewPatch(patch, read);

    expect(diffs[0]).toMatchObject({ path: "a.txt", additions: 0, deletions: 3 });
  });

  it("previews every file of a multi-file patch", async () => {
    const patch = [
      updatePatch,
      "--- /dev/null",
      "+++ b/b.txt",
      "@@ -0,0 +1 @@",
      "+brand new",
    ].join("\n");

    const diffs = await previewPatch(patch, read);

    expect(diffs.map((d) => d.path)).toEqual(["a.txt", "b.txt"]);
  });

  it("throws when the patched file does not exist", async () => {
    await expect(previewPatch(updatePatch, async () => undefined)).rejects.toThrow(
      /File not found: a\.txt/,
    );
  });

  it("throws when the context does not match, like the real apply would", async () => {
    await expect(previewPatch(updatePatch, async () => "totally\ndifferent\n")).rejects.toThrow(
      /mismatch/i,
    );
  });

  it("throws on a patch with no file headers", async () => {
    await expect(previewPatch("not a patch", read)).rejects.toThrow(/No file patches found/);
  });
});
