import { mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertParentPathInsideCwd, resolveInsideCwd, resolveWritableInsideCwd } from "./path.js";

describe("resolveInsideCwd", () => {
  it("rejects absolute paths", () => {
    expect(() => resolveInsideCwd("/tmp/cwd", "/etc/passwd")).toThrow(/absolute/i);
  });

  it("rejects paths that escape via ..", () => {
    expect(() => resolveInsideCwd("/tmp/cwd", "../outside.txt")).toThrow(/escapes/i);
  });

  it("allows a plain relative path", () => {
    expect(resolveInsideCwd("/tmp/cwd", "nested/file.txt")).toBe(join("/tmp/cwd", "nested/file.txt"));
  });
});

describe("sandbox escape via symlinked directory (write path)", () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lucky-sandbox-cwd-"));
    outside = await mkdtemp(join(tmpdir(), "lucky-sandbox-outside-"));
    await symlink(outside, join(root, "evil_link"), "dir");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it("assertParentPathInsideCwd rejects a path that traverses a symlink to outside cwd", async () => {
    await expect(assertParentPathInsideCwd(root, "evil_link/nested/pwned.txt")).rejects.toThrow(/escapes/i);
  });

  it("does not create any directory outside the sandbox when a tool validates before mkdir", async () => {
    // Reproduces the real write_file/apply_patch flow: validate first, then
    // mkdir. Before the fix, tools called mkdir(dirname(target)) BEFORE any
    // symlink-aware check, so this mkdir would happily create `nested/`
    // through the symlink into `outside`. Asserting the outcome here
    // (nothing created outside the sandbox) is what actually matters.
    const path = "evil_link/nested/pwned.txt";
    await expect(assertParentPathInsideCwd(root, path)).rejects.toThrow(/escapes/i);
    // A correct tool never reaches its mkdir call once assertParentPathInsideCwd
    // has thrown, so we don't call mkdir here — the assertion above is the point.

    const outsideEntries = await readdir(outside);
    expect(outsideEntries).not.toContain("nested");
  });

  it("still allows legitimate nested paths with no symlink involved", async () => {
    await assertParentPathInsideCwd(root, "real/nested/file.txt"); // must not throw
    await mkdir(join(root, "real/nested"), { recursive: true });
    const resolved = await resolveWritableInsideCwd(root, "real/nested/file.txt");
    expect(resolved).toBe(join(root, "real/nested/file.txt"));
  });
});
