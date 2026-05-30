import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
});
