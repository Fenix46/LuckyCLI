import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolRegistry } from "../registry.js";
import { applyPatchTool } from "./apply-patch.js";

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
