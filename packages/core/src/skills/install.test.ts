import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverSkills, loadDisabledSet } from "./graph.js";
import {
  installSkillFromPath,
  setSkillEnabled,
  toggleSkillEnabled,
  uninstallSkill,
} from "./install.js";

let root: string;
let srcRoot: string;

const RELEASE = `---
name: Release-Flow
description: cut a release
keywords: [release]
---
release body`;

async function makeSource(dir: string, body = RELEASE, extra?: { file: string; content: string }) {
  const d = join(srcRoot, dir);
  await mkdir(d, { recursive: true });
  await writeFile(join(d, "skill.md"), body, "utf8");
  if (extra) await writeFile(join(d, extra.file), extra.content, "utf8");
  return d;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "skills-inst-"));
  srcRoot = await mkdtemp(join(tmpdir(), "skills-src-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(srcRoot, { recursive: true, force: true });
});

describe("installSkillFromPath", () => {
  it("installs from a directory under the normalized name and builds the graph", async () => {
    const src = await makeSource("whatever-dir");
    const res = await installSkillFromPath(src, { root });
    expect(res.name).toBe("release-flow");
    expect(res.dir).toBe(join(root, "release-flow"));
    const skills = await discoverSkills(root);
    expect(skills.map((s) => s.name)).toEqual(["release-flow"]);
  });

  it("installs from a bare skill.md file path", async () => {
    const src = await makeSource("d");
    const res = await installSkillFromPath(join(src, "skill.md"), { root });
    expect(res.name).toBe("release-flow");
  });

  it("copies sibling assets when installing a directory", async () => {
    const src = await makeSource("d", RELEASE, { file: "extra.txt", content: "hi" });
    await installSkillFromPath(src, { root });
    expect((await stat(join(root, "release-flow", "extra.txt"))).isFile()).toBe(true);
  });

  it("rejects a name collision unless overwrite is set", async () => {
    const src = await makeSource("d");
    await installSkillFromPath(src, { root });
    await expect(installSkillFromPath(src, { root })).rejects.toThrow(/already installed/);
    await expect(installSkillFromPath(src, { root, overwrite: true })).resolves.toMatchObject({
      name: "release-flow",
    });
  });

  it("throws on a missing source", async () => {
    await expect(installSkillFromPath(join(srcRoot, "nope"), { root })).rejects.toThrow(/No such path/);
  });
});

describe("uninstallSkill", () => {
  it("removes the dir and rebuilds the graph", async () => {
    await installSkillFromPath(await makeSource("d"), { root });
    expect(await uninstallSkill("release-flow", root)).toBe(true);
    expect(await stat(join(root, "release-flow")).catch(() => null)).toBeNull();
    expect(await discoverSkills(root)).toEqual([]);
  });

  it("returns false for an unknown skill", async () => {
    expect(await uninstallSkill("ghost", root)).toBe(false);
  });

  it("clears a disabled entry on uninstall", async () => {
    await installSkillFromPath(await makeSource("d"), { root });
    await setSkillEnabled("release-flow", false, root);
    await uninstallSkill("release-flow", root);
    expect([...(await loadDisabledSet(root))]).toEqual([]);
  });
});

describe("setSkillEnabled / toggleSkillEnabled", () => {
  it("disables and re-enables, reflected in discovery and disabled.json", async () => {
    await installSkillFromPath(await makeSource("d"), { root });
    expect(await setSkillEnabled("release-flow", false, root)).toBe(true);
    expect((await discoverSkills(root))[0]?.enabled).toBe(false);
    expect([...(await loadDisabledSet(root))]).toEqual(["release-flow"]);

    await setSkillEnabled("release-flow", true, root);
    expect((await discoverSkills(root))[0]?.enabled).toBe(true);
    expect([...(await loadDisabledSet(root))]).toEqual([]);
  });

  it("accepts a non-normalized name", async () => {
    await installSkillFromPath(await makeSource("d"), { root });
    expect(await setSkillEnabled("Release-Flow", false, root)).toBe(true);
    expect((await discoverSkills(root))[0]?.enabled).toBe(false);
  });

  it("returns false for an unknown skill", async () => {
    expect(await setSkillEnabled("ghost", false, root)).toBe(false);
  });

  it("toggle flips the state and returns it", async () => {
    await installSkillFromPath(await makeSource("d"), { root });
    expect(await toggleSkillEnabled("release-flow", root)).toBe(false);
    expect(await toggleSkillEnabled("release-flow", root)).toBe(true);
    expect(await toggleSkillEnabled("ghost", root)).toBeNull();
  });
});
