import { execFile, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  findSkillDirs,
  installSkillFromSource,
  parseSkillSource,
  type SkillSourceCloner,
} from "./source.js";

const exec = promisify(execFile);
const temps: string[] = [];

afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function temp(prefix = "lucky-source-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

async function writeSkill(dir: string, name: string, description = name): Promise<string> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\nbody\n`,
    "utf8",
  );
  return dir;
}

function fakeCloner(tree: string): SkillSourceCloner & { dest?: string } {
  const cloner = (async (_url: string, dest: string) => {
    cloner.dest = dest;
    await cp(tree, dest, { recursive: true });
  }) as SkillSourceCloner & { dest?: string };
  return cloner;
}

describe("parseSkillSource", () => {
  it("maps owner/repo to its GitHub URL", () => {
    expect(parseSkillSource("owner/repo", { exists: () => false })).toEqual({
      kind: "git",
      url: "https://github.com/owner/repo.git",
    });
  });

  it("keeps an existing relative path local", () => {
    const cwd = "/repo";
    expect(parseSkillSource("owner/repo", { cwd, exists: (path) => path === "/repo/owner/repo" })).toEqual({
      kind: "local",
      path: "/repo/owner/repo",
    });
  });

  it("expands ~ against the injected home", () => {
    expect(parseSkillSource("~/.agents/skills/x", { home: "/home/u" })).toEqual({
      kind: "local",
      path: "/home/u/.agents/skills/x",
    });
  });

  it("accepts https and git@ URLs", () => {
    expect(parseSkillSource("https://github.com/a/b.git")).toEqual({
      kind: "git",
      url: "https://github.com/a/b.git",
    });
    expect(parseSkillSource("git@github.com:a/b.git")).toEqual({
      kind: "git",
      url: "git@github.com:a/b.git",
    });
  });

  it("rejects an empty spec", () => {
    expect(() => parseSkillSource("  ")).toThrow(/empty/);
  });
});

describe("findSkillDirs", () => {
  it("finds nested skills and skips ignored directories", async () => {
    const root = await temp();
    await writeSkill(join(root, "a"), "a");
    await writeSkill(join(root, "b", "c"), "c");
    await writeSkill(join(root, "node_modules", "x"), "x");
    await mkdir(join(root, "empty"), { recursive: true });

    expect((await findSkillDirs(root)).map((s) => s.relativePath)).toEqual(["a", join("b", "c")]);
  });
});

describe("installSkillFromSource", () => {
  it("requires a selection when the source contains several skills", async () => {
    const src = await temp();
    await writeSkill(join(src, "one"), "one");
    await writeSkill(join(src, "two"), "two");
    const root = await temp();

    await expect(installSkillFromSource(src, { root })).rejects.toThrow(/Found 2 skills/);
  });

  it("installs one selected skill", async () => {
    const src = await temp();
    await writeSkill(join(src, "one"), "one");
    await writeSkill(join(src, "two"), "two");
    const root = await temp();

    const results = await installSkillFromSource(src, { root, skill: "TWO" });
    expect(results.map((r) => r.name)).toEqual(["two"]);
    expect((await stat(join(root, "two"))).isDirectory()).toBe(true);
    await expect(stat(join(root, "one"))).rejects.toThrow();
  });

  it("installs every skill with all", async () => {
    const src = await temp();
    await writeSkill(join(src, "one"), "one");
    await writeSkill(join(src, "two"), "two");
    const root = await temp();

    const results = await installSkillFromSource(src, { root, all: true });
    expect(results.map((r) => r.name)).toEqual(["one", "two"]);
  });

  it("installs from a single skill file", async () => {
    const src = await temp();
    await writeSkill(join(src, "one"), "one");
    const root = await temp();

    const results = await installSkillFromSource(join(src, "one", "SKILL.md"), { root });
    expect(results.map((r) => r.name)).toEqual(["one"]);
  });

  it("honors a subpath and rejects one that escapes the source", async () => {
    const src = await temp();
    await writeSkill(join(src, "skills", "one"), "one");
    const root = await temp();

    const results = await installSkillFromSource(src, { root, subpath: "skills", all: true });
    expect(results.map((r) => r.name)).toEqual(["one"]);
    await expect(installSkillFromSource(src, { root, subpath: "../outside" })).rejects.toThrow(
      /escapes the source root/,
    );
  });

  it("clones a git source, installs, and cleans the temporary checkout", async () => {
    const tree = await temp();
    await writeSkill(join(tree, "skills", "alpha"), "alpha");
    const root = await temp();
    const clone = fakeCloner(tree);

    const results = await installSkillFromSource("owner/repo", { root, all: true, clone });
    expect(results.map((r) => r.name)).toEqual(["alpha"]);
    expect(clone.dest).toBeDefined();
    await expect(stat(clone.dest!)).rejects.toThrow();
  });

  it("cleans the temporary checkout when the clone fails", async () => {
    const root = await temp();
    let dest = "";
    const clone: SkillSourceCloner = async (_url, target) => {
      dest = target;
      await mkdir(target, { recursive: true });
      throw new Error("boom");
    };

    await expect(installSkillFromSource("owner/repo", { root, clone })).rejects.toThrow(/boom/);
    expect(dest).not.toBe("");
    await expect(stat(dest)).rejects.toThrow();
  });

  const hasGit = spawnSync("git", ["--version"]).status === 0;
  it.skipIf(!hasGit)("clones a real local repository with git", async () => {
    const repo = await temp("lucky-git-repo-");
    await writeSkill(join(repo, "skills", "alpha"), "alpha");
    const git = (...args: string[]) => exec("git", args, { cwd: repo });
    await git("init", "-q");
    await git("add", ".");
    await git("-c", "user.name=Lucky", "-c", "user.email=lucky@example.com", "commit", "-qm", "init");

    const root = await temp();
    const results = await installSkillFromSource(`file://${repo}`, { root, all: true });
    expect(results.map((r) => r.name)).toEqual(["alpha"]);
  });
});
