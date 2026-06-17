import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolRegistry } from "../registry.js";
import { listDirTool } from "./list-dir.js";
import { readFileTool } from "./read-file.js";
import { writeFileTool } from "./write-file.js";

describe("filesystem tools", () => {
  let root: string;
  let outside: string;
  let registry: ToolRegistry;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lucky-tools-root-"));
    outside = await mkdtemp(join(tmpdir(), "lucky-tools-outside-"));
    registry = new ToolRegistry()
      .register(readFileTool)
      .register(writeFileTool)
      .register(listDirTool);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it("allows relative paths inside cwd", async () => {
    await writeFile(join(root, "note.txt"), "hello", "utf8");

    const read = await registry.execute(
      "read_file",
      { path: "note.txt" },
      { cwd: root },
    );
    const listed = await registry.execute("list_dir", { path: "." }, { cwd: root });
    const write = await registry.execute(
      "write_file",
      { path: "nested/out.txt", content: "ok" },
      { cwd: root },
    );

    await expect(readFile(join(root, "nested/out.txt"), "utf8")).resolves.toBe(
      "ok",
    );
    expect(read).toEqual({ content: "hello" });
    expect(listed.content).toContain("note.txt (file)");
    expect(write.isError).toBeUndefined();
  });

  it("can read a numbered line range", async () => {
    await writeFile(
      join(root, "lines.txt"),
      ["one", "two", "three", "four", "five"].join("\n"),
      "utf8",
    );

    const result = await registry.execute(
      "read_file",
      { path: "lines.txt", offset: 2, limit: 3 },
      { cwd: root },
    );

    expect(result).toEqual({
      content: "     2: two\n     3: three\n     4: four\n\n[showing 3 of 5 lines]",
    });
  });

  it("nudges toward a range when reading a large file whole", async () => {
    const big = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join("\n");
    await writeFile(join(root, "big.txt"), big, "utf8");

    const result = await registry.execute("read_file", { path: "big.txt" }, { cwd: root });
    expect(result.content).toContain("line 1");
    expect(result.content).toContain("[read 500 lines;");
    expect(result.content).toContain("offset/limit");
  });

  it("does not nudge a small whole-file read", async () => {
    await writeFile(join(root, "small.txt"), "a\nb\nc", "utf8");
    const result = await registry.execute("read_file", { path: "small.txt" }, { cwd: root });
    expect(result).toEqual({ content: "a\nb\nc" });
  });

  it("does not nudge when a range was requested, however large the file", async () => {
    const big = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join("\n");
    await writeFile(join(root, "big2.txt"), big, "utf8");
    const result = await registry.execute(
      "read_file",
      { path: "big2.txt", offset: 1, limit: 2 },
      { cwd: root },
    );
    expect(result.content).not.toContain("prefer read_file with offset/limit");
  });

  it("lists directories before files and supports a limit", async () => {
    await mkdir(join(root, "z-dir"));
    await mkdir(join(root, "a-dir"));
    await writeFile(join(root, "b.txt"), "b", "utf8");
    await writeFile(join(root, "a.txt"), "a", "utf8");

    const result = await registry.execute(
      "list_dir",
      { path: ".", limit: 3 },
      { cwd: root },
    );

    expect(result.content).toBe(
      "a-dir (dir)\nz-dir (dir)\na.txt (file)\n\n[showing first 3 of 4 entries]",
    );
  });

  it("can refuse to overwrite an existing file", async () => {
    await writeFile(join(root, "exists.txt"), "old", "utf8");

    const result = await registry.execute(
      "write_file",
      { path: "exists.txt", content: "new", overwrite: false },
      { cwd: root },
    );

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/refusing to overwrite/i);
    await expect(readFile(join(root, "exists.txt"), "utf8")).resolves.toBe("old");
  });

  it("reports when a line range starts past end of file", async () => {
    await writeFile(join(root, "short.txt"), "one\ntwo", "utf8");

    const result = await registry.execute(
      "read_file",
      { path: "short.txt", offset: 10, limit: 5 },
      { cwd: root },
    );

    expect(result).toEqual({ content: "[no lines at offset 10]" });
  });

  it("rejects absolute paths", async () => {
    const absolute = join(outside, "secret.txt");

    await expect(
      registry.execute("read_file", { path: absolute }, { cwd: root }),
    ).resolves.toMatchObject({ isError: true });
    await expect(
      registry.execute(
        "write_file",
        { path: absolute, content: "bad" },
        { cwd: root },
      ),
    ).resolves.toMatchObject({ isError: true });
    await expect(
      registry.execute("list_dir", { path: outside }, { cwd: root }),
    ).resolves.toMatchObject({ isError: true });
  });

  it("rejects traversal outside cwd", async () => {
    const traversal = "../outside.txt";

    await expect(
      registry.execute("read_file", { path: traversal }, { cwd: root }),
    ).resolves.toMatchObject({ isError: true });
    await expect(
      registry.execute(
        "write_file",
        { path: traversal, content: "bad" },
        { cwd: root },
      ),
    ).resolves.toMatchObject({ isError: true });
    await expect(
      registry.execute("list_dir", { path: ".." }, { cwd: root }),
    ).resolves.toMatchObject({ isError: true });
  });

  it("rejects symlinks that resolve outside cwd", async () => {
    await writeFile(join(outside, "secret.txt"), "secret", "utf8");
    await symlink(join(outside, "secret.txt"), join(root, "secret-link.txt"));

    await expect(
      registry.execute("read_file", { path: "secret-link.txt" }, { cwd: root }),
    ).resolves.toMatchObject({ isError: true });
    await expect(
      registry.execute(
        "write_file",
        { path: "secret-link.txt", content: "bad" },
        { cwd: root },
      ),
    ).resolves.toMatchObject({ isError: true });
  });
});
