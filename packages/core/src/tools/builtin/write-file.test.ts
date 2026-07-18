import { mkdtemp, readdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolRegistry } from "../registry.js";
import { writeFileTool } from "./write-file.js";

describe("write_file tool", () => {
  let root: string;
  let registry: ToolRegistry;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lucky-write-file-"));
    registry = new ToolRegistry().register(writeFileTool);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes a new file, creating parent directories", async () => {
    const result = await registry.execute(
      "write_file",
      { path: "nested/dir/f.txt", content: "hello\n" },
      { cwd: root },
    );

    expect(result.isError).toBeUndefined();
    await expect(readFile(join(root, "nested/dir/f.txt"), "utf8")).resolves.toBe("hello\n");
  });

  it("overwrites an existing file by default", async () => {
    await registry.execute("write_file", { path: "f.txt", content: "old\n" }, { cwd: root });
    const result = await registry.execute("write_file", { path: "f.txt", content: "new\n" }, { cwd: root });

    expect(result.isError).toBeUndefined();
    await expect(readFile(join(root, "f.txt"), "utf8")).resolves.toBe("new\n");
  });

  it("refuses to overwrite when overwrite=false", async () => {
    await registry.execute("write_file", { path: "f.txt", content: "old\n" }, { cwd: root });
    const result = await registry.execute(
      "write_file",
      { path: "f.txt", content: "new\n", overwrite: false },
      { cwd: root },
    );

    expect(result.isError).toBe(true);
    await expect(readFile(join(root, "f.txt"), "utf8")).resolves.toBe("old\n");
  });

  describe("sandbox escape via a symlinked directory", () => {
    let outside: string;

    beforeEach(async () => {
      outside = await mkdtemp(join(tmpdir(), "lucky-write-file-outside-"));
      await symlink(outside, join(root, "evil_link"), "dir");
    });

    afterEach(async () => {
      await rm(outside, { recursive: true, force: true });
    });

    it("rejects a write that traverses a symlink to outside cwd, without creating any directory there", async () => {
      const result = await registry.execute(
        "write_file",
        { path: "evil_link/nested/pwned.txt", content: "pwned" },
        { cwd: root },
      );

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
